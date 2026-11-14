/**
 * Honest, reproducible NLP benchmark evaluating 3 distinct extractors:
 *   1. `legacy_regex` (`extractLegacyRegex`: original 10-drug, 7-reaction regex baseline, no negation)
 *   2. `rule_based` (`extractClinicalNarrativeSync`: deterministic drug dictionary + clinical phrase anchors + NegEx/ConText)
 *   3. `transformers_ner` (`extractWithLocalModel` with `pureNerOnly: true`: `onnx-community/biomedical-ner-all-ONNX`
 *      loaded and executed via `@xenova/transformers` + NegEx/ConText)
 *
 * Evaluated across two strictly separated datasets:
 *   - `development_set`: 60 synthetic narratives (`tests/narratives/gold_narratives.json`)
 *   - `independent_test_set`: 64 published open-access PubMed Central case reports (`tests/narratives/pmc_independent_test_set.json`)
 *     with PMID, PMCID, DOI, and Creative Commons licence, annotated per `tests/narratives/ANNOTATION_GUIDELINE.md`.
 *
 * Also evaluates Top-1 and Top-3 Preferred Term (PT) candidate mapping accuracy on the
 * verbatim clinical reaction mentions in the independent PubMed Central test set.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const nlpModulePath = fs.existsSync(path.join(repoRoot, "src", "lib", "nlp.ts"))
  ? "../src/lib/nlp.ts"
  : "../web/lib/nlp.ts";

const {
  extractLegacyRegex,
  extractClinicalNarrativeSync,
  extractWithLocalModel,
  rankReactionCandidates,
  computeTrigramLexicalVector,
  cosineSimilarity,
  DEFAULT_REAC_PTS,
  LOCAL_NER_MODEL_INFO,
  TERM_MATCHER_NAME,
} = await import(nlpModulePath);

const devGoldPath = path.join(repoRoot, "tests", "narratives", "gold_narratives.json");
const pmcTestPath = path.join(repoRoot, "tests", "narratives", "pmc_independent_test_set.json");

const devNarratives = JSON.parse(fs.readFileSync(devGoldPath, "utf8"));
const pmcNarratives = JSON.parse(fs.readFileSync(pmcTestPath, "utf8"));

function calcPrf(tp, fp, fn) {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    tp,
    fp,
    fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
  };
}

async function evaluateDataset(narratives, mode) {
  const counts = {
    suspect_drugs: { tp: 0, fp: 0, fn: 0 },
    concomitant_drugs: { tp: 0, fp: 0, fn: 0 },
    active_reactions: { tp: 0, fp: 0, fn: 0 },
    negated_or_historical_reactions: { tp: 0, fp: 0, fn: 0 },
    seriousness: { tp: 0, fp: 0, fn: 0 },
    demographics: { tp: 0, fp: 0, fn: 0 },
    clinical_course_and_reporter: { tp: 0, fp: 0, fn: 0 },
  };

  for (const item of narratives) {
    const gold = item.gold;
    if (mode === "legacy_regex") {
      const res = extractLegacyRegex(item.text);
      const predSuspect = new Set(res.drugs);
      const goldSuspect = new Set(gold.suspect_drugs || []);
      for (const d of predSuspect) {
        if (goldSuspect.has(d)) counts.suspect_drugs.tp++;
        else counts.suspect_drugs.fp++;
      }
      for (const d of goldSuspect) {
        if (!predSuspect.has(d)) counts.suspect_drugs.fn++;
      }

      const goldConcom = new Set(gold.concomitant_drugs || []);
      counts.concomitant_drugs.fn += goldConcom.size;

      const predActiveReac = new Set(res.reactions);
      const goldActiveReac = new Set(gold.active_reactions || []);
      for (const r of predActiveReac) {
        if (goldActiveReac.has(r)) counts.active_reactions.tp++;
        else counts.active_reactions.fp++;
      }
      for (const r of goldActiveReac) {
        if (!predActiveReac.has(r)) counts.active_reactions.fn++;
      }

      const goldNegReac = new Set(gold.negated_or_historical_reactions || []);
      counts.negated_or_historical_reactions.fn += goldNegReac.size;
      for (const r of predActiveReac) {
        if (goldNegReac.has(r)) counts.negated_or_historical_reactions.fp++;
      }

      if (gold.serious) counts.seriousness.fn++;
      if (gold.age !== null && gold.age !== undefined) counts.demographics.fn++;
      if (gold.sex) counts.demographics.fn++;
      if (gold.reporter) counts.clinical_course_and_reporter.fn++;
      if (gold.dechallenge) counts.clinical_course_and_reporter.fn++;
      if (gold.outcome) counts.clinical_course_and_reporter.fn++;
    } else {
      const res =
        mode === "transformers_ner"
          ? await extractWithLocalModel(item.text, DEFAULT_REAC_PTS, undefined, {
              pureNerOnly: true,
              allowRuleFallbackOnError: false,
            })
          : extractClinicalNarrativeSync(item.text, DEFAULT_REAC_PTS);

      const predSuspect = new Set(res.suspectDrugs.map((d) => d.canonical));
      const goldSuspect = new Set(gold.suspect_drugs || []);
      for (const d of predSuspect) {
        if (goldSuspect.has(d)) counts.suspect_drugs.tp++;
        else counts.suspect_drugs.fp++;
      }
      for (const d of goldSuspect) {
        if (!predSuspect.has(d)) counts.suspect_drugs.fn++;
      }

      const predConcom = new Set(res.concomitantDrugs.map((d) => d.canonical));
      const goldConcom = new Set(gold.concomitant_drugs || []);
      for (const d of predConcom) {
        if (goldConcom.has(d)) counts.concomitant_drugs.tp++;
        else counts.concomitant_drugs.fp++;
      }
      for (const d of goldConcom) {
        if (!predConcom.has(d)) counts.concomitant_drugs.fn++;
      }

      const predActiveReac = new Set(
        res.reactions
          .filter((r) => !r.negated && !r.historical && !r.uncertain)
          .map((r) => r.mappedTerm),
      );
      const goldActiveReac = new Set(gold.active_reactions || []);
      for (const r of predActiveReac) {
        if (goldActiveReac.has(r)) counts.active_reactions.tp++;
        else counts.active_reactions.fp++;
      }
      for (const r of goldActiveReac) {
        if (!predActiveReac.has(r)) counts.active_reactions.fn++;
      }

      const predNegReac = new Set(
        res.reactions
          .filter((r) => r.negated || r.historical || r.uncertain)
          .map((r) => r.mappedTerm),
      );
      const goldNegReac = new Set(gold.negated_or_historical_reactions || []);
      for (const r of predNegReac) {
        if (goldNegReac.has(r)) counts.negated_or_historical_reactions.tp++;
        else counts.negated_or_historical_reactions.fp++;
      }
      for (const r of goldNegReac) {
        if (!predNegReac.has(r)) counts.negated_or_historical_reactions.fn++;
      }

      const predSer = Object.values(res.seriousness).some((s) => s.present);
      if (predSer && gold.serious) counts.seriousness.tp++;
      else if (predSer && !gold.serious) counts.seriousness.fp++;
      else if (!predSer && gold.serious) counts.seriousness.fn++;

      const predAge = res.patientAge?.value?.value ?? null;
      if (predAge !== null && gold.age !== null) {
        if (predAge === gold.age) counts.demographics.tp++;
        else {
          counts.demographics.fp++;
          counts.demographics.fn++;
        }
      } else if (predAge !== null) counts.demographics.fp++;
      else if (gold.age !== null) counts.demographics.fn++;

      const predSex = res.patientSex?.value ?? null;
      if (predSex !== null && gold.sex !== null) {
        if (predSex === gold.sex) counts.demographics.tp++;
        else {
          counts.demographics.fp++;
          counts.demographics.fn++;
        }
      } else if (predSex !== null) counts.demographics.fp++;
      else if (gold.sex !== null) counts.demographics.fn++;

      const predRep = res.reporterType?.value ?? null;
      if (predRep !== null && gold.reporter !== null) {
        if (predRep === gold.reporter) counts.clinical_course_and_reporter.tp++;
        else {
          counts.clinical_course_and_reporter.fp++;
          counts.clinical_course_and_reporter.fn++;
        }
      } else if (predRep !== null) counts.clinical_course_and_reporter.fp++;
      else if (gold.reporter !== null) counts.clinical_course_and_reporter.fn++;

      const predDech = res.dechallenge?.value ?? null;
      if (predDech !== null && gold.dechallenge !== null) {
        if (predDech === gold.dechallenge) counts.clinical_course_and_reporter.tp++;
        else {
          counts.clinical_course_and_reporter.fp++;
          counts.clinical_course_and_reporter.fn++;
        }
      } else if (predDech !== null) counts.clinical_course_and_reporter.fp++;
      else if (gold.dechallenge !== null) counts.clinical_course_and_reporter.fn++;

      const predOutc = res.outcome?.value ?? null;
      if (predOutc !== null && gold.outcome !== null) {
        if (predOutc === gold.outcome) counts.clinical_course_and_reporter.tp++;
        else {
          counts.clinical_course_and_reporter.fp++;
          counts.clinical_course_and_reporter.fn++;
        }
      } else if (predOutc !== null) counts.clinical_course_and_reporter.fp++;
      else if (gold.outcome !== null) counts.clinical_course_and_reporter.fn++;
    }
  }

  const metrics = {};
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  for (const [k, c] of Object.entries(counts)) {
    metrics[k] = calcPrf(c.tp, c.fp, c.fn);
    totalTp += c.tp;
    totalFp += c.fp;
    totalFn += c.fn;
  }
  metrics.micro_overall = calcPrf(totalTp, totalFp, totalFn);
  return metrics;
}

function evaluateTermMappingOnIndependentSet(narratives) {
  let totalMentions = 0;
  let trigramPlusLexicalTop1 = 0;
  let trigramPlusLexicalTop3 = 0;
  let pureTrigramTop1 = 0;
  let pureTrigramTop3 = 0;

  for (const item of narratives) {
    for (const m of item.gold.reaction_mentions || []) {
      totalMentions++;
      const verbatim = m.verbatim;
      const goldPt = m.gold_pt;

      // 1. Character-trigram + lexical synonym table (`rankReactionCandidates`)
      const cands = rankReactionCandidates(verbatim, null, DEFAULT_REAC_PTS);
      if (cands[0]?.pt === goldPt) trigramPlusLexicalTop1++;
      if (cands.slice(0, 3).some((c) => c.pt === goldPt)) trigramPlusLexicalTop3++;

      // 2. Pure character-trigram + concept projection without regex synonym hint
      const qVec = computeTrigramLexicalVector(verbatim);
      const rawScored = DEFAULT_REAC_PTS.map((pt) => ({
        pt,
        score: cosineSimilarity(qVec, computeTrigramLexicalVector(pt)),
      })).sort((a, b) => b.score - a.score || a.pt.localeCompare(b.pt));
      if (rawScored[0]?.pt === goldPt) pureTrigramTop1++;
      if (rawScored.slice(0, 3).some((c) => c.pt === goldPt)) pureTrigramTop3++;
    }
  }

  return {
    matcher_name: TERM_MATCHER_NAME,
    candidate_pool_size: DEFAULT_REAC_PTS.length,
    independent_test_mentions: totalMentions,
    trigram_plus_lexical_synonym: {
      top1_correct: trigramPlusLexicalTop1,
      top1_accuracy: Number((trigramPlusLexicalTop1 / Math.max(1, totalMentions)).toFixed(4)),
      top3_correct: trigramPlusLexicalTop3,
      top3_accuracy: Number((trigramPlusLexicalTop3 / Math.max(1, totalMentions)).toFixed(4)),
    },
    trigram_and_concept_hash_only: {
      top1_correct: pureTrigramTop1,
      top1_accuracy: Number((pureTrigramTop1 / Math.max(1, totalMentions)).toFixed(4)),
      top3_correct: pureTrigramTop3,
      top3_accuracy: Number((pureTrigramTop3 / Math.max(1, totalMentions)).toFixed(4)),
    },
  };
}

const devLegacy = await evaluateDataset(devNarratives, "legacy_regex");
const devRuleBased = await evaluateDataset(devNarratives, "rule_based");
const devTransformersNer = await evaluateDataset(devNarratives, "transformers_ner");

const pmcLegacy = await evaluateDataset(pmcNarratives, "legacy_regex");
const pmcRuleBased = await evaluateDataset(pmcNarratives, "rule_based");
const pmcTransformersNer = await evaluateDataset(pmcNarratives, "transformers_ner");

const termMappingEval = evaluateTermMappingOnIndependentSet(pmcNarratives);

const output = {
  evaluated_at: new Date().toISOString().slice(0, 10),
  dataset_summary: {
    total_narratives: devNarratives.length,
    negated_or_historical_or_uncertain_narratives: devNarratives.filter(
      (n) => (n.gold.negated_or_historical_reactions || []).length > 0,
    ).length,
    positive_only_narratives: devNarratives.filter(
      (n) => (n.gold.negated_or_historical_reactions || []).length === 0,
    ).length,
    disclaimer:
      "Development set (60 synthetic narratives) was used during rule construction. See `independent_test_set` (64 published open-access PubMed Central case reports) for out-of-sample evaluation.",
  },
  independent_test_set_summary: {
    total_narratives: pmcNarratives.length,
    source: "PubMed Central Open Access Case Reports retrieved via NCBI E-utilities",
    annotation_guideline: "tests/narratives/ANNOTATION_GUIDELINE.md",
    negated_or_historical_narratives: pmcNarratives.filter(
      (n) => (n.gold.negated_or_historical_reactions || []).length > 0,
    ).length,
    total_reaction_mentions: termMappingEval.independent_test_mentions,
    disclaimer:
      "Verbatim clinical case report excerpts from open-access PMC articles (with PMID, PMCID, and Creative Commons licence). Rules were not tuned on this set.",
  },
  term_mapping_evaluation: termMappingEval,
  extractors: {
    legacy_regex: {
      name: "Legacy Regex Baseline (10 drugs, 7 reactions, no negation)",
      metrics: devLegacy,
      independent_test_metrics: pmcLegacy,
    },
    rule_based: {
      name: "Rule-Based Dictionary + NegEx/ConText + Trigram/Lexical Synonym Matcher",
      metrics: devRuleBased,
      independent_test_metrics: pmcRuleBased,
    },
    transformers_ner: {
      name: "Biomedical NER (onnx-community/biomedical-ner-all-ONNX via @xenova/transformers) + NegEx/ConText",
      model_id: `${LOCAL_NER_MODEL_INFO.name} (${LOCAL_NER_MODEL_INFO.license}, ~${LOCAL_NER_MODEL_INFO.downloadSizeMb} MB quantized ONNX)`,
      metrics: devTransformersNer,
      independent_test_metrics: pmcTransformersNer,
    },
    // Preserved key for backwards compatibility with existing schema checks
    local_extractor: {
      name: "Rule-Based Dictionary + NegEx/ConText + Trigram/Lexical Synonym Matcher",
      model_id: "Deterministic local dictionary + NegEx/ConText (see transformers_ner for ONNX NER)",
      metrics: devRuleBased,
      independent_test_metrics: pmcRuleBased,
    },
    llm_extractor: {
      name: "Optional Server LLM Extractor (Structured JSON + Verbatim Span Validation)",
      status: process.env.NLP_LLM_API_KEY ? "configured" : "not_run_no_api_key",
      metrics: null,
      independent_test_metrics: null,
    },
  },
};

const outPaths = [
  path.join(repoRoot, "tests", "narratives", "benchmark_results.json"),
  path.join(repoRoot, "src", "lib", "nlpBenchmarkResults.json"),
  path.join(repoRoot, "web", "lib", "nlpBenchmarkResults.json"),
];

for (const p of outPaths) {
  if (fs.existsSync(path.dirname(p))) {
    fs.writeFileSync(p, JSON.stringify(output, null, 2) + "\n", "utf8");
  }
}

console.log(
  `NLP Benchmark Complete:\n` +
    `  Development Set (N=${devNarratives.length} synthetic):\n` +
    `    legacy_regex     Micro-F1 = ${devLegacy.micro_overall.f1} (Suspect Drug F1=${devLegacy.suspect_drugs.f1}, Active Reac F1=${devLegacy.active_reactions.f1})\n` +
    `    rule_based       Micro-F1 = ${devRuleBased.micro_overall.f1} (Suspect Drug F1=${devRuleBased.suspect_drugs.f1}, Active Reac F1=${devRuleBased.active_reactions.f1})\n` +
    `    transformers_ner Micro-F1 = ${devTransformersNer.micro_overall.f1} (Suspect Drug F1=${devTransformersNer.suspect_drugs.f1}, Active Reac F1=${devTransformersNer.active_reactions.f1})\n` +
    `  Independent Test Set (N=${pmcNarratives.length} Open-Access PMC Case Reports):\n` +
    `    legacy_regex     Micro-F1 = ${pmcLegacy.micro_overall.f1} (Suspect Drug F1=${pmcLegacy.suspect_drugs.f1}, Active Reac F1=${pmcLegacy.active_reactions.f1})\n` +
    `    rule_based       Micro-F1 = ${pmcRuleBased.micro_overall.f1} (Suspect Drug F1=${pmcRuleBased.suspect_drugs.f1}, Active Reac F1=${pmcRuleBased.active_reactions.f1})\n` +
    `    transformers_ner Micro-F1 = ${pmcTransformersNer.micro_overall.f1} (Suspect Drug F1=${pmcTransformersNer.suspect_drugs.f1}, Active Reac F1=${pmcTransformersNer.active_reactions.f1})\n` +
    `  PT Candidate Mapping (${termMappingEval.independent_test_mentions} verbatim PMC mentions, 41 PTs):\n` +
    `    Trigram + Lexical Synonym: Top-1 = ${(termMappingEval.trigram_plus_lexical_synonym.top1_accuracy * 100).toFixed(1)}%, Top-3 = ${(termMappingEval.trigram_plus_lexical_synonym.top3_accuracy * 100).toFixed(1)}%\n` +
    `    Trigram & Concept Hash Only: Top-1 = ${(termMappingEval.trigram_and_concept_hash_only.top1_accuracy * 100).toFixed(1)}%, Top-3 = ${(termMappingEval.trigram_and_concept_hash_only.top3_accuracy * 100).toFixed(1)}%`,
);
