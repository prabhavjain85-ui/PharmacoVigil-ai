"use client";

import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { PageHeader } from "@/components/AppShell";
import { useData } from "@/lib/context/DataContext";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-1.5 font-display text-base font-semibold tracking-tight text-[var(--fg)]">
      {children}
    </h2>
  );
}
import {
  extractClinicalNarrativeSync,
  extractWithLocalModel,
  redactNarrativePiiDetailed,
  validateAndAnchorLlmExtraction,
  rankReactionCandidates,
  LOCAL_NER_MODEL_INFO,
  type NarrativeExtractionResult,
  type ExtractedDrug,
  type ExtractedReaction,
  type ReviewStatus,
  type SeriousnessCriterionKey,
  type ModelLoadProgress,
} from "@/lib/nlp";
import { lookupRxNormOnline } from "@/lib/pipeline/drugMap";
import benchmarkData from "@/lib/nlpBenchmarkResults.json";
import goldNarrativesData from "@/lib/goldNarratives.json";

interface GoldNarrativeEntry {
  id: string;
  category: string;
  text: string;
  gold: {
    suspect_drugs: string[];
    concomitant_drugs: string[];
    active_reactions: string[];
    negated_or_historical_reactions: string[];
    serious: boolean;
    age: number | null;
    sex: string | null;
    reporter: string | null;
    dechallenge: string | null;
    outcome: string | null;
  };
}

const GOLD_NARRATIVES = goldNarrativesData as GoldNarrativeEntry[];

const CURATED_SAMPLE_NARRATIVES: {
  id: string;
  title: string;
  tag: string;
  text: string;
}[] = [
  {
    id: "sample-negation-bleed",
    title: "Negation & Rule-Out Demo (Warfarin)",
    tag: "Negation / Dechallenge",
    text: "68-year-old male started Coumadin 5 mg PO daily on 2025-01-10 for atrial fibrillation. Concomitant medication included metformin 500 mg BID. After 6 days, patient presented with mild epistaxis. Upper endoscopy showed no evidence of gastrointestinal haemorrhage and melena was ruled out. Patient denies headache or dizziness. Reported by physician. Coumadin was discontinued on 2025-01-16 and epistaxis resolved.",
  },
  {
    id: "sample-serious-statin",
    title: "Serious Hospitalisation & Rhabdomyolysis (Lipitor)",
    tag: "Serious / Concomitant",
    text: "71-year-old female initiated Lipitor 80 mg oral daily for hyperlipidaemia while taking concomitant lisinopril 10 mg daily. Past medical history of hypothyroidism; family history of myocardial infarction. Three weeks after initiation, she developed severe myalgia and rhabdomyolysis requiring hospitalisation. No evidence of hepatic failure. Lipitor was withdrawn and symptoms improved. Reported by hospital pharmacist.",
  },
  {
    id: "sample-rechallenge-isotretinoin",
    title: "Positive Rechallenge & Hepatotoxicity (Accutane)",
    tag: "Rechallenge / Lab",
    text: "24-year-old female started Accutane 40 mg PO daily on 2024-11-01 for severe nodular acne. After 3 weeks she developed jaundice and elevated transaminases (hepatic injury). Patient had no history of hepatitis and denies alcohol abuse. Accutane was stopped with resolution of transaminases, but symptoms recurred upon rechallenge at 20 mg daily. Reported by dermatologist.",
  },
  {
    id: "sample-pii-redaction",
    title: "PII Scrubbing & Consent Demo (Eliquis)",
    tag: "PII Scrubbing",
    text: "Patient Johnathan Smith (MRN: 8492014, DOB: 04/19/1952, Tel: 415-555-0198), a 72-year-old male, was prescribed Eliquis 5 mg PO BID for atrial fibrillation. After 10 days he was admitted for life-threatening gastrointestinal haemorrhage. CT head ruled out intracranial haemorrhage. Eliquis was held and patient is recovering. Submitted by physician.",
  },
];

const SERIOUSNESS_LABELS: Record<SeriousnessCriterionKey, string> = {
  death: "Death",
  lifeThreatening: "Life-Threatening",
  hospitalisation: "Hospitalisation (Initial or Prolonged)",
  disability: "Persistent or Significant Disability",
  congenitalAnomaly: "Congenital Anomaly / Birth Defect",
  otherMedicallyImportant: "Other Medically Important Condition",
};

interface HighlightSegment {
  start: number;
  end: number;
  text: string;
  kind:
    | "suspect_drug"
    | "concomitant_drug"
    | "active_reaction"
    | "negated_reaction"
    | "seriousness"
    | "demographics"
    | "plain";
  label?: string;
  sublabel?: string;
  confidence?: number;
}

function buildAnnotatedSegments(
  narrative: string,
  extraction: NarrativeExtractionResult | null,
): HighlightSegment[] {
  if (!extraction || !narrative) {
    return [{ start: 0, end: narrative.length, text: narrative, kind: "plain" }];
  }

  const rawSpans: Omit<HighlightSegment, "text">[] = [];

  for (const d of extraction.suspectDrugs) {
    if (d.status === "rejected") continue;
    rawSpans.push({
      start: d.span.start,
      end: d.span.end,
      kind: "suspect_drug",
      label: `Suspect: ${d.canonical}`,
      sublabel: [d.dose, d.route].filter(Boolean).join(" "),
      confidence: d.confidence,
    });
  }

  for (const d of extraction.concomitantDrugs) {
    if (d.status === "rejected") continue;
    rawSpans.push({
      start: d.span.start,
      end: d.span.end,
      kind: "concomitant_drug",
      label: `Concomitant: ${d.canonical}`,
      sublabel: [d.dose, d.route].filter(Boolean).join(" "),
      confidence: d.confidence,
    });
  }

  for (const r of extraction.reactions) {
    if (r.status === "rejected") continue;
    const isSuppressed = r.negated || r.historical || r.uncertain;
    const modTag = r.negated
      ? "NEGATED"
      : r.historical
        ? "HISTORY"
        : r.uncertain
          ? "UNCERTAIN"
          : "ACTIVE";
    rawSpans.push({
      start: r.span.start,
      end: r.span.end,
      kind: isSuppressed ? "negated_reaction" : "active_reaction",
      label: `${modTag}: ${r.mappedTerm}`,
      sublabel: r.onset ? `Onset: ${r.onset}` : undefined,
      confidence: r.confidence,
    });
  }

  for (const [key, crit] of Object.entries(extraction.seriousness) as [
    SeriousnessCriterionKey,
    NarrativeExtractionResult["seriousness"][SeriousnessCriterionKey],
  ][]) {
    if (crit.present && crit.span && crit.status !== "rejected") {
      rawSpans.push({
        start: crit.span.start,
        end: crit.span.end,
        kind: "seriousness",
        label: `Serious: ${SERIOUSNESS_LABELS[key]}`,
        confidence: crit.confidence,
      });
    }
  }

  if (extraction.patientAge && extraction.patientAge.status !== "rejected") {
    rawSpans.push({
      start: extraction.patientAge.span.start,
      end: extraction.patientAge.span.end,
      kind: "demographics",
      label: `Age: ${extraction.patientAge.value.value} ${extraction.patientAge.value.unit}`,
      confidence: extraction.patientAge.confidence,
    });
  }

  if (extraction.patientSex && extraction.patientSex.status !== "rejected") {
    rawSpans.push({
      start: extraction.patientSex.span.start,
      end: extraction.patientSex.span.end,
      kind: "demographics",
      label: `Sex: ${extraction.patientSex.value}`,
      confidence: extraction.patientSex.confidence,
    });
  }

  // Sort by start offset, prefer longer spans when starting at same position
  const validSpans = rawSpans
    .filter((s) => s.start >= 0 && s.end > s.start && s.end <= narrative.length)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const nonOverlapping: Omit<HighlightSegment, "text">[] = [];
  let cursor = 0;
  for (const s of validSpans) {
    if (s.start >= cursor) {
      nonOverlapping.push(s);
      cursor = s.end;
    }
  }

  const result: HighlightSegment[] = [];
  let pos = 0;
  for (const s of nonOverlapping) {
    if (s.start > pos) {
      result.push({
        start: pos,
        end: s.start,
        text: narrative.slice(pos, s.start),
        kind: "plain",
      });
    }
    result.push({
      ...s,
      text: narrative.slice(s.start, s.end),
    });
    pos = s.end;
  }
  if (pos < narrative.length) {
    result.push({
      start: pos,
      end: narrative.length,
      text: narrative.slice(pos),
      kind: "plain",
    });
  }

  return result;
}

function StatusBadge({
  status,
  onAccept,
  onReject,
}: {
  status: ReviewStatus;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onAccept}
        className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${
          status === "accepted" || status === "edited"
            ? "bg-emerald-600 text-white"
            : "border border-line bg-surface text-muted hover:border-emerald-600 hover:text-emerald-700"
        }`}
      >
        {status === "edited" ? "Edited ✓" : status === "accepted" ? "Accepted ✓" : "Accept"}
      </button>
      <button
        type="button"
        onClick={onReject}
        className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${
          status === "rejected"
            ? "bg-rose-600 text-white"
            : "border border-line bg-surface text-muted hover:border-rose-600 hover:text-rose-700"
        }`}
      >
        {status === "rejected" ? "Rejected ✕" : "Reject"}
      </button>
    </div>
  );
}

export function NlpView() {
  const { reacPts, addedCaseIds, addCaseToDataset } = useData();

  const [narrative, setNarrative] = useState<string>(CURATED_SAMPLE_NARRATIVES[0].text);
  const [extractorMode, setExtractorMode] = useState<"local-ner" | "local-rules" | "llm-server">(
    "local-ner",
  );
  const [extraction, setExtraction] = useState<NarrativeExtractionResult | null>(null);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [modelProgress, setModelProgress] = useState<ModelLoadProgress>({
    status: "idle",
    progress: 0,
    message: "Biomedical NER model ready to lazy-load in browser",
  });

  // External consent state (shared between optional LLM extractor and optional RxNav lookup)
  const [externalConsent, setExternalConsent] = useState<boolean>(false);
  const [showPiiPreview, setShowPiiPreview] = useState<boolean>(false);
  const [llmError, setLlmError] = useState<string | null>(null);

  // RxNav online lookup state per drug canonical name
  const [rxNavResults, setRxNavResults] = useState<
    Record<string, { loading: boolean; rxcui: string | null; normalizedName: string | null; error?: string }>
  >({});

  // Manual drug or reaction addition inputs
  const [newDrugName, setNewDrugName] = useState<string>("");
  const [newDrugRole, setNewDrugRole] = useState<"suspect" | "concomitant">("suspect");
  const [newReacTerm, setNewReacTerm] = useState<string>("");

  // Dataset addition confirmation
  const [lastAddedCaseId, setLastAddedCaseId] = useState<string | null>(null);

  // Selected gold narrative filter in evaluation section
  const [goldCategoryFilter, setGoldCategoryFilter] = useState<string>("all");

  // Compute PII redaction preview synchronously
  const piiPreview = useMemo(() => redactNarrativePiiDetailed(narrative), [narrative]);

  // Run extraction whenever triggered or initially with sync rules then upgrade to local NER
  const runExtraction = useCallback(
    async (textToProcess: string, mode: "local-ner" | "local-rules" | "llm-server") => {
      setLlmError(null);
      setLastAddedCaseId(null);

      if (!textToProcess.trim()) {
        setExtraction(null);
        return;
      }

      if (mode === "local-rules") {
        const res = extractClinicalNarrativeSync(textToProcess, reacPts);
        setExtraction(res);
        return;
      }

      if (mode === "local-ner") {
        setIsExtracting(true);
        // Immediate rule-based render while model warms up
        const immediate = extractClinicalNarrativeSync(textToProcess, reacPts);
        setExtraction(immediate);
        try {
          const nerResult = await extractWithLocalModel(textToProcess, reacPts, (prog) => {
            setModelProgress({
              status: prog.status,
              progress: Math.round(prog.progress ?? 50),
              message:
                prog.status === "ready"
                  ? "Biomedical NER model active in browser"
                  : prog.file
                    ? `Loading ${prog.file}...`
                    : `Model status: ${prog.status}`,
            });
          });
          setExtraction(nerResult);
        } catch {
          // Fallback already applied
        } finally {
          setIsExtracting(false);
        }
        return;
      }

      if (mode === "llm-server") {
        if (!externalConsent) {
          setLlmError(
            "Explicit user consent is required before sending narrative text to the server LLM endpoint.",
          );
          return;
        }
        setIsExtracting(true);
        try {
          const redacted = redactNarrativePiiDetailed(textToProcess);
          const resp = await fetch("/api/nlp/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              narrative: redacted.redactedText,
              consentConfirmed: true,
              loadedReacPts: reacPts.slice(0, 250),
            }),
          });
          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}));
            throw new Error(
              errBody.detail ||
                errBody.error ||
                `Server LLM endpoint returned HTTP ${resp.status}. Configure NLP_LLM_API_KEY or GEMINI_API_KEY on the server, or use the Local Biomedical NER extractor.`,
            );
          }
          const rawJson = await resp.json();
          const validated = validateAndAnchorLlmExtraction(
            textToProcess,
            rawJson.extraction ?? rawJson,
            reacPts,
            redacted.redactedText,
          );
          setExtraction(validated);
        } catch (err) {
          setLlmError(
            err instanceof Error
              ? err.message
              : "Server LLM extraction unavailable in static mode. Using local extractor.",
          );
          const fallback = extractClinicalNarrativeSync(textToProcess, reacPts);
          setExtraction(fallback);
        } finally {
          setIsExtracting(false);
        }
      }
    },
    [reacPts, externalConsent],
  );

  // Initial extraction on mount
  useEffect(() => {
    runExtraction(narrative, extractorMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const annotatedSegments = useMemo(
    () => buildAnnotatedSegments(narrative, extraction),
    [narrative, extraction],
  );

  // Handlers for editing extracted fields
  const updateDrug = (
    role: "suspect" | "concomitant",
    index: number,
    updater: (d: ExtractedDrug) => ExtractedDrug,
  ) => {
    setExtraction((prev) => {
      if (!prev) return prev;
      const listKey = role === "suspect" ? "suspectDrugs" : "concomitantDrugs";
      const updatedList = [...prev[listKey]];
      updatedList[index] = updater(updatedList[index]);
      return { ...prev, [listKey]: updatedList };
    });
  };

  const toggleDrugRole = (fromRole: "suspect" | "concomitant", index: number) => {
    setExtraction((prev) => {
      if (!prev) return prev;
      const fromKey = fromRole === "suspect" ? "suspectDrugs" : "concomitantDrugs";
      const toKey = fromRole === "suspect" ? "concomitantDrugs" : "suspectDrugs";
      const item = prev[fromKey][index];
      const nextRole: "PS" | "C" = fromRole === "suspect" ? "C" : "PS";
      const nextFrom = prev[fromKey].filter((_, i) => i !== index);
      const nextTo = [...prev[toKey], { ...item, role: nextRole, status: "edited" as ReviewStatus }];
      return { ...prev, [fromKey]: nextFrom, [toKey]: nextTo };
    });
  };

  const updateReaction = (index: number, updater: (r: ExtractedReaction) => ExtractedReaction) => {
    setExtraction((prev) => {
      if (!prev) return prev;
      const nextReacs = [...prev.reactions];
      nextReacs[index] = updater(nextReacs[index]);
      return { ...prev, reactions: nextReacs };
    });
  };

  const handleAddManualDrug = () => {
    const clean = newDrugName.trim().toUpperCase();
    if (!clean || !extraction) return;
    const newEntry: ExtractedDrug = {
      id: `manual-drug-${Date.now()}`,
      verbatim: clean,
      canonical: clean,
      role: newDrugRole === "suspect" ? "PS" : "C",
      dose: null,
      route: null,
      startDate: null,
      stopDate: null,
      indication: null,
      rxnormCui: null,
      negated: false,
      uncertain: false,
      historical: false,
      span: { start: 0, end: 0, text: clean },
      confidence: 1.0,
      status: "accepted",
    };
    const key = newDrugRole === "suspect" ? "suspectDrugs" : "concomitantDrugs";
    setExtraction({
      ...extraction,
      [key]: [...extraction[key], newEntry],
    });
    setNewDrugName("");
  };

  const handleAddManualReaction = () => {
    const clean = newReacTerm.trim().toUpperCase();
    if (!clean || !extraction) return;
    const candidates = rankReactionCandidates(clean, null, reacPts);
    const newReac: ExtractedReaction = {
      id: `manual-reac-${Date.now()}`,
      verbatim: clean,
      mappedTerm: candidates[0]?.pt || clean,
      candidates,
      negated: false,
      uncertain: false,
      historical: false,
      contextCue: null,
      onset: null,
      span: { start: 0, end: 0, text: clean },
      confidence: 1.0,
      status: "accepted",
    };
    setExtraction({
      ...extraction,
      reactions: [...extraction.reactions, newReac],
    });
    setNewReacTerm("");
  };

  const handleRxNavLookup = async (drugName: string) => {
    if (!externalConsent) {
      setRxNavResults((prev) => ({
        ...prev,
        [drugName]: {
          loading: false,
          rxcui: null,
          normalizedName: null,
          error: "Tick external service consent box above to query NLM RxNav API.",
        },
      }));
      return;
    }
    setRxNavResults((prev) => ({
      ...prev,
      [drugName]: { loading: true, rxcui: null, normalizedName: null },
    }));
    const res = await lookupRxNormOnline(drugName, externalConsent);
    setRxNavResults((prev) => ({
      ...prev,
      [drugName]: {
        loading: false,
        rxcui: res.rxcui,
        normalizedName: res.canonicalName,
        error: res.rxcui ? undefined : "No exact RxCUI found in RxNav",
      },
    }));
  };

  const handleAddReviewedCaseToDataset = () => {
    if (!extraction) return;

    const activeSuspects = extraction.suspectDrugs.filter((d) => d.status !== "rejected");
    const activeConcomitants = extraction.concomitantDrugs.filter((d) => d.status !== "rejected");
    const activeReactions = extraction.reactions.filter(
      (r) => r.status !== "rejected" && !r.negated && !r.historical && !r.uncertain,
    );

    if (activeSuspects.length === 0 || activeReactions.length === 0) {
      return;
    }

    const primaryId = `NLP${Date.now().toString().slice(-7)}`;
    const ageVal =
      extraction.patientAge && extraction.patientAge.status !== "rejected"
        ? String(extraction.patientAge.value.value)
        : "";
    const ageCod =
      extraction.patientAge && extraction.patientAge.status !== "rejected"
        ? extraction.patientAge.value.unit
        : "YR";
    const sexVal =
      extraction.patientSex && extraction.patientSex.status !== "rejected"
        ? extraction.patientSex.value
        : "UNK";
    const occpCod =
      extraction.reporterType && extraction.reporterType.status !== "rejected"
        ? extraction.reporterType.value
        : "MD";

    const demoRow = {
      primaryid: primaryId,
      caseid: primaryId,
      caseversion: "1",
      age: ageVal,
      age_cod: ageCod,
      sex: sexVal,
      occp_cod: occpCod,
      event_dt: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      reporter_country: "US",
    };

    const drugRows = [
      ...activeSuspects.map((d, idx) => ({
        primaryid: primaryId,
        caseid: primaryId,
        drug_seq: String(idx + 1),
        role_cod: idx === 0 ? "PS" : "SS",
        drugname: d.canonical,
        prod_ai: d.canonical,
        route: d.route || "",
        dose_vbm: d.dose || "",
        dechal:
          extraction.dechallenge?.status !== "rejected" &&
          extraction.dechallenge?.value === "positive"
            ? "Y"
            : extraction.dechallenge?.value === "negative"
              ? "N"
              : "U",
        rechal:
          extraction.rechallenge?.status !== "rejected" &&
          extraction.rechallenge?.value === "positive"
            ? "Y"
            : extraction.rechallenge?.value === "negative"
              ? "N"
              : "U",
      })),
      ...activeConcomitants.map((d, idx) => ({
        primaryid: primaryId,
        caseid: primaryId,
        drug_seq: String(activeSuspects.length + idx + 1),
        role_cod: "C",
        drugname: d.canonical,
        prod_ai: d.canonical,
        route: d.route || "",
        dose_vbm: d.dose || "",
        dechal: "U",
        rechal: "U",
      })),
    ];

    const reacRows = activeReactions.map((r) => ({
      primaryid: primaryId,
      caseid: primaryId,
      pt: r.mappedTerm,
    }));

    const outcRows: { primaryid: string; caseid: string; outc_cod: string }[] = [];
    if (extraction.seriousness.death.present && extraction.seriousness.death.status !== "rejected") {
      outcRows.push({ primaryid: primaryId, caseid: primaryId, outc_cod: "DE" });
    }
    if (
      extraction.seriousness.lifeThreatening.present &&
      extraction.seriousness.lifeThreatening.status !== "rejected"
    ) {
      outcRows.push({ primaryid: primaryId, caseid: primaryId, outc_cod: "LT" });
    }
    if (
      extraction.seriousness.hospitalisation.present &&
      extraction.seriousness.hospitalisation.status !== "rejected"
    ) {
      outcRows.push({ primaryid: primaryId, caseid: primaryId, outc_cod: "HO" });
    }
    if (
      extraction.seriousness.disability.present &&
      extraction.seriousness.disability.status !== "rejected"
    ) {
      outcRows.push({ primaryid: primaryId, caseid: primaryId, outc_cod: "DS" });
    }
    if (
      extraction.seriousness.congenitalAnomaly.present &&
      extraction.seriousness.congenitalAnomaly.status !== "rejected"
    ) {
      outcRows.push({ primaryid: primaryId, caseid: primaryId, outc_cod: "CA" });
    }
    if (
      extraction.seriousness.otherMedicallyImportant.present &&
      extraction.seriousness.otherMedicallyImportant.status !== "rejected"
    ) {
      outcRows.push({ primaryid: primaryId, caseid: primaryId, outc_cod: "OT" });
    }

    const indiRows = activeSuspects
      .filter((d) => d.indication)
      .map((d, idx) => ({
        primaryid: primaryId,
        caseid: primaryId,
        indi_drug_seq: String(idx + 1),
        indi_pt: (d.indication || "").toUpperCase(),
      }));

    const createdId = addCaseToDataset({
      demoRow,
      drugRows,
      reacRows,
      outcRows: outcRows.length ? outcRows : undefined,
      indiRows: indiRows.length ? indiRows : undefined,
    });
    setLastAddedCaseId(createdId);
  };

  const filteredGoldNarratives = useMemo(() => {
    if (goldCategoryFilter === "all") return GOLD_NARRATIVES;
    if (goldCategoryFilter === "negated_any") {
      return GOLD_NARRATIVES.filter(
        (n) => (n.gold.negated_or_historical_reactions || []).length > 0,
      );
    }
    return GOLD_NARRATIVES.filter((n) => n.category === goldCategoryFilter);
  }, [goldCategoryFilter]);

  const legacyMetrics = benchmarkData.extractors.legacy_regex.metrics;
  const localMetrics = benchmarkData.extractors.local_extractor.metrics;

  const benchmarkRows: {
    key: keyof typeof legacyMetrics;
    label: string;
    description: string;
  }[] = [
    {
      key: "suspect_drugs",
      label: "Suspect Drugs",
      description: "Primary/secondary suspect medication mapped to canonical generic ingredient",
    },
    {
      key: "concomitant_drugs",
      label: "Concomitant Drugs",
      description: "Co-administered medications distinguished from suspect drugs by context",
    },
    {
      key: "active_reactions",
      label: "Active Adverse Reactions",
      description: "Affirmed adverse events mapped to MedDRA-style PT (excluding negated/history)",
    },
    {
      key: "negated_or_historical_reactions",
      label: "Negated / Historical / Uncertain Mentions",
      description: '"no evidence of", "denies", "ruled out", "history of", "family history of"',
    },
    {
      key: "seriousness",
      label: "Seriousness Criteria (ICH E2A)",
      description: "Death, life-threatening, hospitalisation, disability, congenital anomaly, other",
    },
    {
      key: "demographics",
      label: "Patient Demographics (Age & Sex)",
      description: "Patient age with unit and biological sex extracted from narrative",
    },
    {
      key: "clinical_course_and_reporter",
      label: "Dechallenge, Outcome & Reporter",
      description: "Response to drug withdrawal, clinical outcome, and reporter occupation",
    },
    {
      key: "micro_overall",
      label: "Micro-Averaged Overall",
      description: "Aggregate performance across all entity mentions on the 60 gold narratives",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Adverse event narrative structured extraction"
        hint="In-browser biomedical NER + NegEx/ConText clinical narrative extractor. Extracts suspect & concomitant drugs (with dose, route, start/stop dates), reactions with top-3 loaded REAC PT embedding candidates, negation/history/uncertainty flags, seriousness criteria, dechallenge/rechallenge, outcome, and demographics. Every item carries its verbatim character span and confidence score."
      />

      {/* Mandatory Human Review & Non-Regulatory Banner */}
      <div className="mb-6 rounded border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-xs text-ink">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            ⚠ HUMAN REVIEW REQUIRED — NOT FOR REGULATORY SUBMISSION OR CLINICAL USE
          </p>
          <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-900 dark:text-amber-200">
            Privacy: No narrative text in URLs, logs, or analytics
          </span>
        </div>
        <p className="mt-1 text-muted">
          Automated narrative extraction is an exploratory triage aid. Every extracted drug,
          reaction, negation flag, and seriousness criterion must be reviewed and verified by a
          qualified pharmacovigilance specialist before inclusion in any safety analysis. Do not use
          for FDA MedWatch / EudraVigilance ICSR regulatory submissions.
        </p>
      </div>

      {/* Extractor Selection & Model Progress */}
      <Card className="mb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <SectionTitle>1. Select Extractor Engine</SectionTitle>
            <p className="text-xs text-muted">
              By default, extraction runs 100% locally in your browser using{" "}
              <code className="font-mono text-ink">{LOCAL_NER_MODEL_INFO.name}</code> (
              {LOCAL_NER_MODEL_INFO.license} license, {LOCAL_NER_MODEL_INFO.downloadSizeMb} MB
              quantized ONNX) combined with NegEx/ConText modifier rules.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setExtractorMode("local-ner");
                runExtraction(narrative, "local-ner");
              }}
              className={`rounded border px-3 py-1.5 text-xs font-medium transition ${
                extractorMode === "local-ner"
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-surface text-ink hover:border-ink"
              }`}
            >
              Local Biomedical NER (transformers.js)
            </button>
            <button
              type="button"
              onClick={() => {
                setExtractorMode("local-rules");
                runExtraction(narrative, "local-rules");
              }}
              className={`rounded border px-3 py-1.5 text-xs font-medium transition ${
                extractorMode === "local-rules"
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-surface text-ink hover:border-ink"
              }`}
            >
              Local Rule + NegEx Fallback
            </button>
            <button
              type="button"
              onClick={() => {
                setExtractorMode("llm-server");
              }}
              className={`rounded border px-3 py-1.5 text-xs font-medium transition ${
                extractorMode === "llm-server"
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-surface text-ink hover:border-ink"
              }`}
            >
              Optional Server LLM (Off by default)
            </button>
          </div>
        </div>

        {/* Transformers.js Download / Load Progress Bar */}
        {extractorMode === "local-ner" && (
          <div className="mt-4 rounded border border-line bg-bg/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
                  Browser NER Model:
                </span>
                <span className="font-mono font-medium text-ink">
                  {LOCAL_NER_MODEL_INFO.name}
                </span>
                <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {LOCAL_NER_MODEL_INFO.license} · ~{LOCAL_NER_MODEL_INFO.downloadSizeMb} MB
                </span>
              </div>
              <span className="font-mono text-[11px] text-muted">
                {modelProgress.message} ({modelProgress.progress}%)
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-line">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${Math.max(5, modelProgress.progress)}%` }}
              />
            </div>
          </div>
        )}

        {/* Consent Checkbox for Optional External Calls (Server LLM & Public RxNav API) */}
        <div className="mt-4 rounded border border-line bg-bg/40 p-3">
          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-ink">
            <input
              type="checkbox"
              checked={externalConsent}
              onChange={(e) => setExternalConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line"
            />
            <span>
              <strong>Explicit External Service Consent (Off by default):</strong> I consent to
              sending the PII-scrubbed narrative text to the configured server LLM endpoint (
              <code className="font-mono">/api/nlp/extract</code>) and/or querying drug names
              against the public NLM RxNav API (<code className="font-mono">rxnav.nlm.nih.gov</code>
              ). Obvious identifiers (names, phone numbers, medical record numbers, SSNs, exact
              dates of birth) are stripped before any external transmission.
            </span>
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-3 pl-6">
            <button
              type="button"
              onClick={() => setShowPiiPreview((v) => !v)}
              className="font-mono text-[11px] text-accent underline"
            >
              {showPiiPreview ? "Hide PII Redaction Preview" : "Preview PII-Scrubbed Text"} (
              {piiPreview.redactedSpans.length} identifier
              {piiPreview.redactedSpans.length === 1 ? "" : "s"} detected)
            </button>
            {extractorMode === "llm-server" && (
              <button
                type="button"
                disabled={!externalConsent || isExtracting}
                onClick={() => runExtraction(narrative, "llm-server")}
                className="rounded bg-ink px-3 py-1 font-mono text-[11px] text-bg disabled:opacity-40"
              >
                {isExtracting ? "Calling Server LLM..." : "Run Server LLM Extraction Now"}
              </button>
            )}
          </div>

          {showPiiPreview && (
            <div className="mt-2 rounded border border-line bg-surface p-2.5 font-mono text-xs text-muted">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-ink">
                Sanitized payload preview (sent when consent is ticked):
              </p>
              <p className="whitespace-pre-wrap text-ink">{piiPreview.redactedText}</p>
              {piiPreview.redactedSpans.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {piiPreview.redactedSpans.map((s, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-300"
                    >
                      Stripped {s.type}: &ldquo;{s.text}&rdquo; [{s.start}..{s.end}]
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {llmError && (
            <p className="mt-2 pl-6 font-mono text-xs text-rose-600 dark:text-rose-400">
              {llmError}
            </p>
          )}
        </div>
      </Card>

      {/* Narrative Input + Highlighted Span Viewer */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>2. Clinical Case Narrative Input</SectionTitle>
            <span className="font-mono text-[11px] text-muted">
              {narrative.length} chars · Loaded REAC dictionary: {reacPts.length} PTs
            </span>
          </div>

          {/* Preset Sample Switcher */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {CURATED_SAMPLE_NARRATIVES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => {
                  setNarrative(sample.text);
                  runExtraction(sample.text, extractorMode);
                }}
                className={`rounded border px-2.5 py-1 text-left text-[11px] transition ${
                  narrative === sample.text
                    ? "border-accent bg-accent/10 font-medium text-ink"
                    : "border-line bg-bg text-muted hover:border-ink hover:text-ink"
                }`}
              >
                <span className="font-mono text-[10px] uppercase text-accent">{sample.tag}: </span>
                {sample.title}
              </button>
            ))}
          </div>

          <textarea
            rows={7}
            value={narrative}
            onChange={(e) => {
              const nextText = e.target.value;
              setNarrative(nextText);
              // Immediate local sync update so spans stay aligned while typing
              setExtraction(extractClinicalNarrativeSync(nextText, reacPts));
            }}
            placeholder="Paste or type a de-identified adverse event narrative..."
            className="w-full rounded border border-line bg-bg p-3 font-sans text-sm leading-relaxed text-ink focus:border-accent focus:outline-none"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => runExtraction(narrative, extractorMode)}
              disabled={isExtracting}
              className="rounded bg-accent px-4 py-2 text-xs font-medium text-white hover:opacity-95 disabled:opacity-50"
            >
              {isExtracting ? "Extracting..." : "Re-run Full Extraction"}
            </button>

            {extraction && (
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                <span>
                  Active Extractor:{" "}
                  <strong className="text-ink">{extraction.extractorUsed}</strong>
                </span>
                {extraction.modelInfo && (
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px]">
                    {extraction.modelInfo.name}
                  </span>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Annotated Verbatim Span Viewer */}
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>3. Annotated Verbatim Character Spans</SectionTitle>
            <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-800 dark:text-emerald-300">
                Suspect Drug
              </span>
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-800 dark:text-sky-300">
                Concomitant
              </span>
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-800 dark:text-rose-300">
                Active Reaction
              </span>
              <span className="rounded border border-dashed border-slate-400 bg-slate-500/10 px-1.5 py-0.5 text-slate-600 line-through dark:text-slate-300">
                Negated / History / Uncertain
              </span>
              <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-violet-800 dark:text-violet-300">
                Serious / Demo
              </span>
            </div>
          </div>

          <div className="min-h-[180px] rounded border border-line bg-bg p-3.5 text-sm leading-8 text-ink">
            {annotatedSegments.map((seg, i) => {
              if (seg.kind === "plain") {
                return <span key={i}>{seg.text}</span>;
              }
              const styleMap: Record<Exclude<HighlightSegment["kind"], "plain">, string> = {
                suspect_drug:
                  "bg-emerald-500/20 border-b-2 border-emerald-600 text-ink px-1 py-0.5 rounded-t",
                concomitant_drug:
                  "bg-sky-500/20 border-b-2 border-sky-600 text-ink px-1 py-0.5 rounded-t",
                active_reaction:
                  "bg-rose-500/20 border-b-2 border-rose-600 text-ink px-1 py-0.5 rounded-t",
                negated_reaction:
                  "bg-slate-500/15 border border-dashed border-slate-500 text-muted line-through px-1 py-0.5 rounded",
                seriousness:
                  "bg-violet-500/20 border-b-2 border-violet-600 text-ink px-1 py-0.5 rounded-t",
                demographics:
                  "bg-amber-500/20 border-b-2 border-amber-600 text-ink px-1 py-0.5 rounded-t",
              };
              return (
                <span
                  key={i}
                  title={`${seg.label || ""} [${seg.start}..${seg.end}] conf=${Math.round(
                    (seg.confidence || 0.9) * 100,
                  )}%`}
                  className={`mx-0.5 inline-block cursor-help transition ${styleMap[seg.kind]}`}
                >
                  <span>{seg.text}</span>
                  <span className="ml-1 rounded bg-surface/90 px-1 font-mono text-[10px] font-normal no-underline">
                    {seg.label} · {Math.round((seg.confidence || 0.9) * 100)}%
                  </span>
                </span>
              );
            })}
          </div>

          <p className="mt-2 font-mono text-[11px] text-muted">
            Hover any highlighted span to inspect exact character offsets{" "}
            <code>[start..end]</code> and extractor confidence. Negated, ruled-out, or historical
            mentions are automatically suppressed from active FAERS reactions.
          </p>
        </Card>
      </div>

      {/* Editable Structured Form: Accept / Edit / Reject per field */}
      {extraction && (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div>
              <SectionTitle>
                4. Structured Clinical Review Form (Accept / Edit / Reject per Field)
              </SectionTitle>
              <p className="text-xs text-muted">
                Review, edit, or reject extracted fields below. Rejected items and negated/historical
                reactions are excluded when appending the case to the loaded FAERS tables.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {lastAddedCaseId && (
                <span className="rounded bg-emerald-500/15 px-3 py-1 font-mono text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  ✓ Appended Case {lastAddedCaseId} to DEMO/DRUG/REAC ({addedCaseIds.length} added
                  this session)
                </span>
              )}
              <button
                type="button"
                onClick={handleAddReviewedCaseToDataset}
                disabled={
                  extraction.suspectDrugs.filter((d) => d.status !== "rejected").length === 0 ||
                  extraction.reactions.filter(
                    (r) => r.status !== "rejected" && !r.negated && !r.historical && !r.uncertain,
                  ).length === 0
                }
                className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40"
              >
                + Add Reviewed Case to Loaded Dataset
              </button>
            </div>
          </div>

          {/* A. Drugs Table (Suspect & Concomitant) */}
          <div className="mb-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink">
                A. Extracted Medications (Suspect & Concomitant)
              </h3>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newDrugName}
                  onChange={(e) => setNewDrugName(e.target.value)}
                  placeholder="Add drug name..."
                  className="rounded border border-line bg-bg px-2 py-1 text-xs text-ink"
                />
                <select
                  value={newDrugRole}
                  onChange={(e) => setNewDrugRole(e.target.value as "suspect" | "concomitant")}
                  className="rounded border border-line bg-bg px-2 py-1 text-xs text-ink"
                >
                  <option value="suspect">Suspect (PS/SS)</option>
                  <option value="concomitant">Concomitant (C)</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddManualDrug}
                  className="rounded border border-line bg-surface px-2.5 py-1 font-mono text-xs text-ink hover:border-ink"
                >
                  + Add Drug
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] uppercase text-muted">
                    <th className="py-2 pr-2">Role</th>
                    <th className="px-2 py-2">Verbatim Span</th>
                    <th className="px-2 py-2">Canonical Generic (Editable)</th>
                    <th className="px-2 py-2">Dose</th>
                    <th className="px-2 py-2">Route</th>
                    <th className="px-2 py-2">Start / Stop Dates</th>
                    <th className="px-2 py-2">Indication</th>
                    <th className="px-2 py-2">RxNorm (RxNav)</th>
                    <th className="px-2 py-2">Conf</th>
                    <th className="py-2 pl-2 text-right">Review Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[
                    ...extraction.suspectDrugs.map((d, idx) => ({
                      drug: d,
                      role: "suspect" as const,
                      idx,
                    })),
                    ...extraction.concomitantDrugs.map((d, idx) => ({
                      drug: d,
                      role: "concomitant" as const,
                      idx,
                    })),
                  ].map(({ drug: d, role, idx }) => {
                    const rxInfo = rxNavResults[d.canonical];
                    return (
                      <tr
                        key={`${role}-${idx}-${d.span.start}`}
                        className={d.status === "rejected" ? "opacity-40" : ""}
                      >
                        <td className="py-2 pr-2">
                          <button
                            type="button"
                            onClick={() => toggleDrugRole(role, idx)}
                            title="Click to toggle between Suspect and Concomitant"
                            className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                              role === "suspect"
                                ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                                : "bg-sky-500/20 text-sky-800 dark:text-sky-300"
                            }`}
                          >
                            {role === "suspect" ? "Suspect (PS)" : "Concomitant (C)"} ⇄
                          </button>
                        </td>
                        <td className="px-2 py-2 font-mono text-[11px]">
                          &ldquo;{d.verbatim}&rdquo;{" "}
                          <span className="text-[10px] text-muted">
                            [{d.span.start}..{d.span.end}]
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={d.canonical}
                            onChange={(e) =>
                              updateDrug(role, idx, (prev) => ({
                                ...prev,
                                canonical: e.target.value.toUpperCase(),
                                status: "edited",
                              }))
                            }
                            className="w-36 rounded border border-line bg-bg px-2 py-1 font-mono text-xs text-ink"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={d.dose || ""}
                            placeholder="—"
                            onChange={(e) =>
                              updateDrug(role, idx, (prev) => ({
                                ...prev,
                                dose: e.target.value || null,
                                status: "edited",
                              }))
                            }
                            className="w-24 rounded border border-line bg-bg px-2 py-1 font-mono text-xs text-ink"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={d.route || ""}
                            placeholder="—"
                            onChange={(e) =>
                              updateDrug(role, idx, (prev) => ({
                                ...prev,
                                route: e.target.value || null,
                                status: "edited",
                              }))
                            }
                            className="w-20 rounded border border-line bg-bg px-2 py-1 font-mono text-xs text-ink"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={d.startDate || ""}
                              placeholder="Start"
                              onChange={(e) =>
                                updateDrug(role, idx, (prev) => ({
                                  ...prev,
                                  startDate: e.target.value || null,
                                  status: "edited",
                                }))
                              }
                              className="w-20 rounded border border-line bg-bg px-1.5 py-1 font-mono text-[11px] text-ink"
                            />
                            <span className="text-muted">→</span>
                            <input
                              type="text"
                              value={d.stopDate || ""}
                              placeholder="Stop"
                              onChange={(e) =>
                                updateDrug(role, idx, (prev) => ({
                                  ...prev,
                                  stopDate: e.target.value || null,
                                  status: "edited",
                                }))
                              }
                              className="w-20 rounded border border-line bg-bg px-1.5 py-1 font-mono text-[11px] text-ink"
                            />
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={d.indication || ""}
                            placeholder="Indication"
                            onChange={(e) =>
                              updateDrug(role, idx, (prev) => ({
                                ...prev,
                                indication: e.target.value || null,
                                status: "edited",
                              }))
                            }
                            className="w-28 rounded border border-line bg-bg px-2 py-1 text-xs text-ink"
                          />
                        </td>
                        <td className="px-2 py-2">
                          {rxInfo?.rxcui ? (
                            <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                              RxCUI: {rxInfo.rxcui}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRxNavLookup(d.canonical)}
                              className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-[10px] text-muted hover:border-ink hover:text-ink"
                            >
                              {rxInfo?.loading ? "..." : "RxNav Lookup"}
                            </button>
                          )}
                          {rxInfo?.error && (
                            <p className="mt-0.5 font-mono text-[9px] text-amber-700 dark:text-amber-300">
                              {rxInfo.error}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 font-mono text-[11px]">
                          {Math.round(d.confidence * 100)}%
                        </td>
                        <td className="py-2 pl-2 text-right">
                          <StatusBadge
                            status={d.status}
                            onAccept={() =>
                              updateDrug(role, idx, (prev) => ({ ...prev, status: "accepted" }))
                            }
                            onReject={() =>
                              updateDrug(role, idx, (prev) => ({ ...prev, status: "rejected" }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* B. Reactions Table with Top-3 REAC Embedding Candidates & Negation/History Flags */}
          <div className="mb-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink">
                  B. Extracted Reactions & Top-3 Loaded REAC Preferred Term (PT) Candidates
                </h3>
                <p className="text-[11px] text-muted">
                  MedDRA is licensed and not bundled. Terms are mapped against the currently loaded{" "}
                  <code>REAC</code> dataset ({reacPts.length} PTs) by clinical embedding cosine
                  similarity. Pick any of the top 3 candidates or edit directly.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newReacTerm}
                  onChange={(e) => setNewReacTerm(e.target.value)}
                  placeholder="Add reaction term..."
                  className="rounded border border-line bg-bg px-2 py-1 text-xs text-ink"
                />
                <button
                  type="button"
                  onClick={handleAddManualReaction}
                  className="rounded border border-line bg-surface px-2.5 py-1 font-mono text-xs text-ink hover:border-ink"
                >
                  + Add Reaction
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] uppercase text-muted">
                    <th className="py-2 pr-2">Verbatim Mention</th>
                    <th className="px-2 py-2">Context Modifiers (NegEx)</th>
                    <th className="px-2 py-2">Selected PT (Editable)</th>
                    <th className="px-2 py-2">Top-3 Loaded REAC Candidates (Click to Pick)</th>
                    <th className="px-2 py-2">Onset</th>
                    <th className="px-2 py-2">Conf</th>
                    <th className="py-2 pl-2 text-right">Review Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {extraction.reactions.map((r, idx) => {
                    const isSuppressed = r.negated || r.historical || r.uncertain;
                    return (
                      <tr
                        key={`${idx}-${r.span.start}`}
                        className={r.status === "rejected" ? "opacity-40" : ""}
                      >
                        <td className="py-2.5 pr-2 font-mono text-[11px]">
                          <span className={isSuppressed ? "line-through text-muted" : "text-ink"}>
                            &ldquo;{r.verbatim}&rdquo;
                          </span>{" "}
                          <span className="text-[10px] text-muted">
                            [{r.span.start}..{r.span.end}]
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[10px]">
                              <input
                                type="checkbox"
                                checked={r.negated}
                                onChange={(e) =>
                                  updateReaction(idx, (prev) => ({
                                    ...prev,
                                    negated: e.target.checked,
                                    status: "edited",
                                  }))
                                }
                              />
                              Negated
                            </label>
                            <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[10px]">
                              <input
                                type="checkbox"
                                checked={r.historical}
                                onChange={(e) =>
                                  updateReaction(idx, (prev) => ({
                                    ...prev,
                                    historical: e.target.checked,
                                    status: "edited",
                                  }))
                                }
                              />
                              History
                            </label>
                            <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[10px]">
                              <input
                                type="checkbox"
                                checked={r.uncertain}
                                onChange={(e) =>
                                  updateReaction(idx, (prev) => ({
                                    ...prev,
                                    uncertain: e.target.checked,
                                    status: "edited",
                                  }))
                                }
                              />
                              Uncertain
                            </label>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <input
                            type="text"
                            value={r.mappedTerm}
                            onChange={(e) =>
                              updateReaction(idx, (prev) => ({
                                ...prev,
                                mappedTerm: e.target.value.toUpperCase(),
                                status: "edited",
                              }))
                            }
                            className="w-44 rounded border border-line bg-bg px-2 py-1 font-mono text-xs text-ink"
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {r.candidates.map((cand) => (
                              <button
                                key={cand.pt}
                                type="button"
                                onClick={() =>
                                  updateReaction(idx, (prev) => ({
                                    ...prev,
                                    mappedTerm: cand.pt,
                                    status: "edited",
                                  }))
                                }
                                className={`rounded border px-2 py-0.5 font-mono text-[10px] transition ${
                                  r.mappedTerm === cand.pt
                                    ? "border-accent bg-accent text-white"
                                    : "border-line bg-surface text-muted hover:border-ink hover:text-ink"
                                }`}
                              >
                                {cand.pt} ({cand.score.toFixed(2)})
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <input
                            type="text"
                            value={r.onset || ""}
                            placeholder="—"
                            onChange={(e) =>
                              updateReaction(idx, (prev) => ({
                                ...prev,
                                onset: e.target.value || null,
                                status: "edited",
                              }))
                            }
                            className="w-24 rounded border border-line bg-bg px-2 py-1 font-mono text-xs text-ink"
                          />
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[11px]">
                          {Math.round(r.confidence * 100)}%
                        </td>
                        <td className="py-2.5 pl-2 text-right">
                          <StatusBadge
                            status={r.status}
                            onAccept={() =>
                              updateReaction(idx, (prev) => ({ ...prev, status: "accepted" }))
                            }
                            onReject={() =>
                              updateReaction(idx, (prev) => ({ ...prev, status: "rejected" }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* C. Demographics, Course (Dechallenge/Rechallenge/Outcome/Reporter) & Seriousness Criteria */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Demographics & Clinical Course */}
            <div className="rounded border border-line bg-bg/50 p-4">
              <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-ink">
                C. Demographics, Reporter & Dechallenge / Outcome
              </h3>
              <div className="space-y-3 text-xs">
                {/* Age */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                  <div>
                    <span className="font-mono uppercase text-muted">Patient Age: </span>
                    <input
                      type="number"
                      value={extraction.patientAge?.value.value ?? ""}
                      placeholder="—"
                      onChange={(e) => {
                        const num = parseInt(e.target.value, 10);
                        setExtraction((prev) =>
                          prev
                            ? {
                                ...prev,
                                patientAge: Number.isNaN(num)
                                  ? null
                                  : {
                                      value: {
                                        value: num,
                                        unit: prev.patientAge?.value.unit || "YR",
                                      },
                                      span: prev.patientAge?.span || {
                                        start: 0,
                                        end: 0,
                                        text: String(num),
                                      },
                                      confidence: prev.patientAge?.confidence || 1.0,
                                      status: "edited",
                                    },
                              }
                            : prev,
                        );
                      }}
                      className="ml-2 w-20 rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
                    />
                    <span className="ml-1 font-mono text-[11px] text-muted">
                      {extraction.patientAge?.value.unit || "YR"}
                    </span>
                    {extraction.patientAge?.span && (
                      <span className="ml-2 font-mono text-[10px] text-muted">
                        [{extraction.patientAge.span.start}..{extraction.patientAge.span.end}]
                      </span>
                    )}
                  </div>
                  {extraction.patientAge && (
                    <StatusBadge
                      status={extraction.patientAge.status}
                      onAccept={() =>
                        setExtraction((prev) =>
                          prev && prev.patientAge
                            ? {
                                ...prev,
                                patientAge: { ...prev.patientAge, status: "accepted" },
                              }
                            : prev,
                        )
                      }
                      onReject={() =>
                        setExtraction((prev) =>
                          prev && prev.patientAge
                            ? {
                                ...prev,
                                patientAge: { ...prev.patientAge, status: "rejected" },
                              }
                            : prev,
                        )
                      }
                    />
                  )}
                </div>

                {/* Sex */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                  <div>
                    <span className="font-mono uppercase text-muted">Patient Sex: </span>
                    <select
                      value={extraction.patientSex?.value ?? "UNK"}
                      onChange={(e) => {
                        const val = e.target.value as "M" | "F" | "UNK";
                        setExtraction((prev) =>
                          prev
                            ? {
                                ...prev,
                                patientSex: {
                                  value: val,
                                  span: prev.patientSex?.span || { start: 0, end: 0, text: val },
                                  confidence: prev.patientSex?.confidence || 1.0,
                                  status: "edited",
                                },
                              }
                            : prev,
                        );
                      }}
                      className="ml-2 rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
                    >
                      <option value="M">M (Male)</option>
                      <option value="F">F (Female)</option>
                      <option value="UNK">UNK (Unknown)</option>
                    </select>
                  </div>
                  {extraction.patientSex && (
                    <StatusBadge
                      status={extraction.patientSex.status}
                      onAccept={() =>
                        setExtraction((prev) =>
                          prev && prev.patientSex
                            ? {
                                ...prev,
                                patientSex: { ...prev.patientSex, status: "accepted" },
                              }
                            : prev,
                        )
                      }
                      onReject={() =>
                        setExtraction((prev) =>
                          prev && prev.patientSex
                            ? {
                                ...prev,
                                patientSex: { ...prev.patientSex, status: "rejected" },
                              }
                            : prev,
                        )
                      }
                    />
                  )}
                </div>

                {/* Reporter Type */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                  <div>
                    <span className="font-mono uppercase text-muted">Reporter Type: </span>
                    <select
                      value={extraction.reporterType?.value ?? "OT"}
                      onChange={(e) => {
                        const val = e.target.value as "MD" | "PH" | "HP" | "CN" | "LW" | "OT";
                        setExtraction((prev) =>
                          prev
                            ? {
                                ...prev,
                                reporterType: {
                                  value: val,
                                  span: prev.reporterType?.span || { start: 0, end: 0, text: val },
                                  confidence: prev.reporterType?.confidence || 1.0,
                                  status: "edited",
                                },
                              }
                            : prev,
                        );
                      }}
                      className="ml-2 rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
                    >
                      <option value="MD">MD (Physician)</option>
                      <option value="PH">PH (Pharmacist)</option>
                      <option value="HP">HP (Health Professional)</option>
                      <option value="OT">OT (Other Health Professional)</option>
                      <option value="CN">CN (Consumer / Patient)</option>
                      <option value="LW">LW (Attorney)</option>
                    </select>
                  </div>
                  {extraction.reporterType && (
                    <StatusBadge
                      status={extraction.reporterType.status}
                      onAccept={() =>
                        setExtraction((prev) =>
                          prev && prev.reporterType
                            ? {
                                ...prev,
                                reporterType: { ...prev.reporterType, status: "accepted" },
                              }
                            : prev,
                        )
                      }
                      onReject={() =>
                        setExtraction((prev) =>
                          prev && prev.reporterType
                            ? {
                                ...prev,
                                reporterType: { ...prev.reporterType, status: "rejected" },
                              }
                            : prev,
                        )
                      }
                    />
                  )}
                </div>

                {/* Dechallenge & Rechallenge */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <span className="font-mono uppercase text-muted">Dechallenge: </span>
                      <select
                        value={extraction.dechallenge?.value ?? "unknown"}
                        onChange={(e) => {
                          const val = e.target.value as
                            | "positive"
                            | "negative"
                            | "not_applicable"
                            | "unknown";
                          setExtraction((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  dechallenge: {
                                    value: val,
                                    span: prev.dechallenge?.span || {
                                      start: 0,
                                      end: 0,
                                      text: val,
                                    },
                                    confidence: prev.dechallenge?.confidence || 1.0,
                                    status: "edited",
                                  },
                                }
                              : prev,
                          );
                        }}
                        className="rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
                      >
                        <option value="positive">Positive (Abated on withdrawal)</option>
                        <option value="negative">Negative (Persisted)</option>
                        <option value="not_applicable">Not Applicable</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>

                    <div>
                      <span className="font-mono uppercase text-muted">Rechallenge: </span>
                      <select
                        value={extraction.rechallenge?.value ?? "unknown"}
                        onChange={(e) => {
                          const val = e.target.value as
                            | "positive"
                            | "negative"
                            | "not_done"
                            | "unknown";
                          setExtraction((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  rechallenge: {
                                    value: val,
                                    span: prev.rechallenge?.span || {
                                      start: 0,
                                      end: 0,
                                      text: val,
                                    },
                                    confidence: prev.rechallenge?.confidence || 1.0,
                                    status: "edited",
                                  },
                                }
                              : prev,
                          );
                        }}
                        className="rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
                      >
                        <option value="positive">Positive (Recurred on re-exposure)</option>
                        <option value="negative">Negative (Did not recur)</option>
                        <option value="not_done">Not Done</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Clinical Outcome */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono uppercase text-muted">Outcome: </span>
                    <select
                      value={extraction.outcome?.value ?? "unknown"}
                      onChange={(e) => {
                        const val = e.target.value as
                          | "recovered"
                          | "recovering"
                          | "not_recovered"
                          | "fatal"
                          | "unknown";
                        setExtraction((prev) =>
                          prev
                            ? {
                                ...prev,
                                outcome: {
                                  value: val,
                                  span: prev.outcome?.span || { start: 0, end: 0, text: val },
                                  confidence: prev.outcome?.confidence || 1.0,
                                  status: "edited",
                                },
                              }
                            : prev,
                        );
                      }}
                      className="ml-2 rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
                    >
                      <option value="recovered">Recovered / Resolved</option>
                      <option value="recovering">Recovering / Resolving</option>
                      <option value="not_recovered">Not Recovered</option>
                      <option value="fatal">Fatal</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                  {extraction.outcome && (
                    <StatusBadge
                      status={extraction.outcome.status}
                      onAccept={() =>
                        setExtraction((prev) =>
                          prev && prev.outcome
                            ? { ...prev, outcome: { ...prev.outcome, status: "accepted" } }
                            : prev,
                        )
                      }
                      onReject={() =>
                        setExtraction((prev) =>
                          prev && prev.outcome
                            ? { ...prev, outcome: { ...prev.outcome, status: "rejected" } }
                            : prev,
                        )
                      }
                    />
                  )}
                </div>
              </div>
            </div>

            {/* ICH E2A Seriousness Criteria */}
            <div className="rounded border border-line bg-bg/50 p-4">
              <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-ink">
                D. ICH E2A Seriousness Criteria
              </h3>
              <div className="space-y-2 text-xs">
                {(Object.keys(SERIOUSNESS_LABELS) as SeriousnessCriterionKey[]).map((key) => {
                  const crit = extraction.seriousness[key];
                  return (
                    <div
                      key={key}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 ${
                        crit.present && crit.status !== "rejected"
                          ? "border-violet-500/50 bg-violet-500/10"
                          : "border-line bg-surface"
                      }`}
                    >
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={crit.present && crit.status !== "rejected"}
                          onChange={(e) =>
                            setExtraction((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    seriousness: {
                                      ...prev.seriousness,
                                      [key]: {
                                        ...prev.seriousness[key],
                                        present: e.target.checked,
                                        status: "edited",
                                      },
                                    },
                                  }
                                : prev,
                            )
                          }
                        />
                        <span className="font-medium text-ink">{SERIOUSNESS_LABELS[key]}</span>
                        {crit.span && (
                          <span className="font-mono text-[10px] text-muted">
                            (&ldquo;{crit.span.text}&rdquo; [{crit.span.start}..{crit.span.end}])
                          </span>
                        )}
                      </label>
                      {crit.present && (
                        <StatusBadge
                          status={crit.status}
                          onAccept={() =>
                            setExtraction((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    seriousness: {
                                      ...prev.seriousness,
                                      [key]: { ...prev.seriousness[key], status: "accepted" },
                                    },
                                  }
                                : prev,
                            )
                          }
                          onReject={() =>
                            setExtraction((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    seriousness: {
                                      ...prev.seriousness,
                                      [key]: { ...prev.seriousness[key], status: "rejected" },
                                    },
                                  }
                                : prev,
                            )
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Evaluation Benchmark Section (60 Gold-Annotated Synthetic Narratives) */}
      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionTitle>
              5. Evaluation Benchmark (60 Synthetic Narratives with Gold Annotations)
            </SectionTitle>
            <p className="text-xs text-muted">
              Evaluated on{" "}
              <code className="font-mono text-ink">tests/narratives/gold_narratives.json</code> (
              {benchmarkData.dataset_summary.total_narratives} synthetic narratives:{" "}
              {benchmarkData.dataset_summary.negated_or_historical_or_uncertain_narratives}{" "}
              containing negated, historical, family-history, or uncertain mentions, and{" "}
              {benchmarkData.dataset_summary.positive_only_narratives} positive clinical cases).{" "}
              <strong>{benchmarkData.dataset_summary.disclaimer}</strong>
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase text-muted">
                <th className="py-2 pr-3">Entity / Extraction Task</th>
                <th className="border-l border-line px-3 py-2 text-center" colSpan={3}>
                  Old Regex (10 drugs, 7 reactions, no negation)
                </th>
                <th className="border-l border-line px-3 py-2 text-center" colSpan={3}>
                  Local Biomedical NER + NegEx Extractor
                </th>
                <th className="border-l border-line px-3 py-2 text-center">
                  Optional Server LLM Extractor
                </th>
              </tr>
              <tr className="border-b border-line font-mono text-[10px] text-muted">
                <th className="py-1.5 pr-3"></th>
                <th className="border-l border-line px-2 py-1.5 text-right">Precision</th>
                <th className="px-2 py-1.5 text-right">Recall</th>
                <th className="px-2 py-1.5 text-right">F1</th>
                <th className="border-l border-line px-2 py-1.5 text-right">Precision</th>
                <th className="px-2 py-1.5 text-right">Recall</th>
                <th className="px-2 py-1.5 text-right">F1</th>
                <th className="border-l border-line px-3 py-1.5 text-center">Status / Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {benchmarkRows.map((row) => {
                const leg = legacyMetrics[row.key];
                const loc = localMetrics[row.key];
                const isOverall = row.key === "micro_overall";
                return (
                  <tr
                    key={row.key}
                    className={isOverall ? "bg-surface/80 font-semibold text-ink" : ""}
                  >
                    <td className="py-2.5 pr-3">
                      <p className="font-medium text-ink">{row.label}</p>
                      <p className="text-[11px] font-normal text-muted">{row.description}</p>
                    </td>
                    <td className="border-l border-line px-2 py-2.5 text-right font-mono">
                      {(leg.precision * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono">
                      {(leg.recall * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-rose-700 dark:text-rose-300">
                      {(leg.f1 * 100).toFixed(1)}%
                    </td>
                    <td className="border-l border-line px-2 py-2.5 text-right font-mono">
                      {(loc.precision * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono">
                      {(loc.recall * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                      {(loc.f1 * 100).toFixed(1)}%
                    </td>
                    <td className="border-l border-line px-3 py-2.5 text-center font-mono text-[11px] text-muted">
                      Off by default (requires server{" "}
                      <code className="text-ink">NLP_LLM_API_KEY</code> &amp; consent)
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Interactive Gold Narrative Browser (All 60 Narratives) */}
        <div className="mt-6 border-t border-line pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink">
              Inspect Any of the 60 Gold-Annotated Benchmark Narratives (Click to Load Above)
            </h3>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
              {[
                { id: "all", label: "All (60)" },
                { id: "negated_any", label: "Negated / History / Uncertain (20)" },
                { id: "positive", label: "Positive Cases (40)" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setGoldCategoryFilter(tab.id)}
                  className={`rounded border px-2.5 py-1 transition ${
                    goldCategoryFilter === tab.id
                      ? "border-accent bg-accent text-white"
                      : "border-line bg-surface text-muted hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
            {filteredGoldNarratives.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setNarrative(item.text);
                  runExtraction(item.text, extractorMode);
                }}
                className="flex flex-col justify-between rounded border border-line bg-bg p-2.5 text-left text-xs transition hover:border-accent"
              >
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px]">
                    <span className="font-bold text-ink">{item.id}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 uppercase ${
                        item.category === "positive"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      {item.category}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[11px] text-muted">{item.text}</p>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[10px]">
                  {item.gold.suspect_drugs.map((d) => (
                    <span key={d} className="rounded bg-surface px-1 text-ink">
                      Drug: {d}
                    </span>
                  ))}
                  {item.gold.active_reactions.map((r) => (
                    <span key={r} className="rounded bg-rose-500/15 px-1 text-rose-700 dark:text-rose-300">
                      +{r}
                    </span>
                  ))}
                  {item.gold.negated_or_historical_reactions.map((r) => (
                    <span key={r} className="rounded bg-slate-500/15 px-1 line-through text-muted">
                      ¬{r}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
