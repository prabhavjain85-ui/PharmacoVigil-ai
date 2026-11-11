import {
  CANONICAL_GENERICS,
  DRUG_ALIAS_TO_CANONICAL,
  canonicalizeDrug,
  isKnownDrugTerm,
  normalizePt,
} from "./pipeline/drugMap";

export type TextSpan = {
  start: number;
  end: number;
  text: string;
};

export type ReviewStatus = "pending" | "accepted" | "edited" | "rejected";

export type ExtractedItem<T> = {
  value: T;
  span: TextSpan;
  confidence: number;
  status: ReviewStatus;
};

export type TermCandidate = {
  pt: string;
  score: number;
};

export type ExtractedDrug = {
  id: string;
  role: "PS" | "SS" | "C";
  verbatim: string;
  canonical: string;
  rxnormCui?: string | null;
  dose: string | null;
  route: string | null;
  startDate: string | null;
  stopDate: string | null;
  indication: string | null;
  negated: boolean;
  uncertain: boolean;
  historical: boolean;
  span: TextSpan;
  confidence: number;
  status: ReviewStatus;
};

export type ExtractedReaction = {
  id: string;
  verbatim: string;
  mappedTerm: string;
  candidates: TermCandidate[];
  negated: boolean;
  uncertain: boolean;
  historical: boolean;
  contextCue: string | null;
  onset: string | null;
  span: TextSpan;
  confidence: number;
  status: ReviewStatus;
};

export type ExtractedCriterion = {
  present: boolean;
  span: TextSpan | null;
  confidence: number;
  status: ReviewStatus;
};

export type SeriousnessCriteria = {
  death: ExtractedCriterion;
  lifeThreatening: ExtractedCriterion;
  hospitalisation: ExtractedCriterion;
  disability: ExtractedCriterion;
  congenitalAnomaly: ExtractedCriterion;
  otherMedicallyImportant: ExtractedCriterion;
};

export type DechallengeResult = "positive" | "negative" | "not_applicable" | "unknown";
export type RechallengeResult = "positive" | "negative" | "not_done" | "unknown";
export type OutcomeResult = "recovered" | "recovering" | "not_recovered" | "fatal" | "unknown";
export type PatientAge = { value: number; unit: "YR" | "MON" | "WK" | "DY" };
export type PatientSex = "F" | "M" | "UNK";
export type ReporterType = "MD" | "PH" | "HP" | "CN" | "LW" | "OT";

export type ExtractorKind =
  | "transformers-local"
  | "rule-fallback"
  | "llm-server"
  | "legacy-regex";

export type NarrativeExtraction = {
  suspectDrugs: ExtractedDrug[];
  concomitantDrugs: ExtractedDrug[];
  reactions: ExtractedReaction[];
  dechallenge: ExtractedItem<DechallengeResult> | null;
  rechallenge: ExtractedItem<RechallengeResult> | null;
  outcome: ExtractedItem<OutcomeResult> | null;
  seriousness: SeriousnessCriteria;
  patientAge: ExtractedItem<PatientAge> | null;
  patientSex: ExtractedItem<PatientSex> | null;
  reporterType: ExtractedItem<ReporterType> | null;
  extractorUsed: ExtractorKind;
  modelInfo: {
    name: string;
    license: string;
    downloadSizeMb: number;
  } | null;
  redactedPreview?: string;
  requiresHumanReview: true;
  regulatoryDisclaimer: string;
};

export const LOCAL_NER_MODEL_INFO = {
  name: "onnx-community/biomedical-ner-all-ONNX (d4data/biomedical-ner-all)",
  license: "Apache-2.0",
  downloadSizeMb: 63.9,
} as const;

export const REGULATORY_DISCLAIMER =
  "Human review required — automated extraction is a research/triage aid and is NOT validated for regulatory ICSR submission.";

export const DEFAULT_REAC_PTS: string[] = [
  "GASTROINTESTINAL HAEMORRHAGE",
  "RHABDOMYOLYSIS",
  "ANAPHYLACTIC REACTION",
  "ANGIOEDEMA",
  "HEPATIC FAILURE",
  "NAUSEA",
  "HEADACHE",
  "RASH",
  "DIZZINESS",
  "FATIGUE",
  "VOMITING",
  "MYALGIA",
  "PRURITUS",
  "DYSPNOEA",
  "ACUTE KIDNEY INJURY",
  "NEUTROPENIA",
  "AGRANULOCYTOSIS",
  "STEVENS-JOHNSON SYNDROME",
  "TOXIC EPIDERMAL NECROLYSIS",
  "APLASTIC ANAEMIA",
  "PANCYTOPENIA",
  "THROMBOCYTOPENIA",
  "MYOCARDIAL INFARCTION",
  "QT PROLONGATION",
  "BRADYCARDIA",
  "HYPOTENSION",
  "HYPERTENSION",
  "HYPOGLYCAEMIA",
  "LACTIC ACIDOSIS",
  "PANCREATITIS",
  "COUGH",
  "DIARRHOEA",
  "HYPERKALAEMIA",
  "HYPONATRAEMIA",
  "CONFUSIONAL STATE",
  "SEIZURE",
  "PERIPHERAL NEUROPATHY",
  "TENDON RUPTURE",
  "EPISTAXIS",
  "HAEMATURIA",
  "INTERSTITIAL LUNG DISEASE",
];

// Clinical reaction phrase -> canonical PT hint for semantic embedding alignment
const CLINICAL_SYNONYM_ANCHORS: {
  pattern: RegExp;
  canonicalPt: string;
  seriousHint?: keyof SeriousnessCriteria;
}[] = [
  {
    pattern:
      /\b(?:upper\s+)?(?:gastrointestinal|gi)\s+(?:hemorrhage|haemorrhage|bleed(?:ing)?)\b|\bmelena\b|\bmelaena\b|\bhematemesis\b|\bhaematemesis\b|\bcoffee[- ]ground\s+emesis\b|\bpeptic\s+ulcer\s+bleed(?:ing)?\b|\bgastric\s+hemorrhage\b/gi,
    canonicalPt: "GASTROINTESTINAL HAEMORRHAGE",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern:
      /\brhabdomyolysis\b|\bmyoglobinuria\b|\bck\s+(?:markedly\s+)?elevated\b|\bcreatine\s+kinase\s+elevated\b/gi,
    canonicalPt: "RHABDOMYOLYSIS",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern:
      /\banaphylaxis\b|\banaphylactic\s+(?:shock|reaction)\b|\banaphylactoid\s+reaction\b|\bbronchospasm\s+and\s+hypotension\b/gi,
    canonicalPt: "ANAPHYLACTIC REACTION",
    seriousHint: "lifeThreatening",
  },
  {
    pattern:
      /\bangioedema\b|\bangioneurotic\s+o?edema\b|\blip\s+swelling\b|\btongue\s+swelling\b|\blaryngeal\s+o?edema\b|\bfacial\s+swelling\b/gi,
    canonicalPt: "ANGIOEDEMA",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern:
      /\b(?:acute\s+)?hepatic\s+failure\b|\bfulminant\s+hepatitis\b|\bdrug[- ]induced\s+liver\s+injury\b|\bhepatotoxicity\b|\bacute\s+liver\s+(?:injury|failure)\b|\bhepatic\s+necrosis\b|\bjaundice\b/gi,
    canonicalPt: "HEPATIC FAILURE",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern:
      /\bacute\s+kidney\s+injury\b|\bacute\s+renal\s+failure\b|\brenal\s+failure\b|\bacute\s+tubular\s+necrosis\b|\bcreatinine\s+doubled\b|\banuria\b|\boliguria\b/gi,
    canonicalPt: "ACUTE KIDNEY INJURY",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern:
      /\bstevens[- ]johnson\s+syndrome\b|\bsjs\b|\btoxic\s+epidermal\s+necrolysis\b|\bmucocutaneous\s+blistering\b/gi,
    canonicalPt: "STEVENS-JOHNSON SYNDROME",
    seriousHint: "lifeThreatening",
  },
  {
    pattern:
      /\bagranulocytosis\b|\bfebrile\s+neutropenia\b|\bsevere\s+neutropenia\b|\bneutropenia\b|\bleukopenia\b|\banc\s*<\s*500\b/gi,
    canonicalPt: "NEUTROPENIA",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern: /\baplastic\s+an(?:a)?emia\b|\bpancytopenia\b|\bbone\s+marrow\s+failure\b/gi,
    canonicalPt: "APLASTIC ANAEMIA",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern: /\bthrombocytopenia\b|\bplatelet\s+count\s+dropped\b|\blow\s+platelets\b/gi,
    canonicalPt: "THROMBOCYTOPENIA",
  },
  {
    pattern:
      /\b(?:acute\s+)?myocardial\s+infarction\b|\bstemi\b|\bnstemi\b|\bacute\s+coronary\s+syndrome\b/gi,
    canonicalPt: "MYOCARDIAL INFARCTION",
    seriousHint: "lifeThreatening",
  },
  {
    pattern: /\bqt\s+prolongation\b|\bprolonged\s+qtc\b|\btorsades\s+de\s+pointes\b/gi,
    canonicalPt: "QT PROLONGATION",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern: /\blactic\s+acidosis\b/gi,
    canonicalPt: "LACTIC ACIDOSIS",
    seriousHint: "lifeThreatening",
  },
  {
    pattern: /\bhypoglyc(?:a)?emia\b|\bsevere\s+low\s+blood\s+glucose\b/gi,
    canonicalPt: "HYPOGLYCAEMIA",
  },
  {
    pattern: /\bacute\s+pancreatitis\b|\bpancreatitis\b/gi,
    canonicalPt: "PANCREATITIS",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern: /\bseizure(?:s)?\b|\bgeneralized\s+tonic[- ]clonic\b|\bconvulsion(?:s)?\b/gi,
    canonicalPt: "SEIZURE",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern: /\binterstitial\s+lung\s+disease\b|\bpulmonary\s+fibrosis\b|\bpneumonitis\b/gi,
    canonicalPt: "INTERSTITIAL LUNG DISEASE",
    seriousHint: "otherMedicallyImportant",
  },
  {
    pattern: /\btendon\s+rupture\b|\bachilles\s+tendinitis\b|\btendinopathy\b/gi,
    canonicalPt: "TENDON RUPTURE",
  },
  {
    pattern: /\bepistaxis\b|\bnosebleed(?:s)?\b/gi,
    canonicalPt: "EPISTAXIS",
  },
  {
    pattern: /\bhaematuria\b|\bhematuria\b|\bgross\s+hematuria\b/gi,
    canonicalPt: "HAEMATURIA",
  },
  {
    pattern: /\bhyperkal(?:a)?emia\b|\bpotassium\s+6\.\d\b/gi,
    canonicalPt: "HYPERKALAEMIA",
  },
  {
    pattern: /\bhyponatr(?:a)?emia\b/gi,
    canonicalPt: "HYPONATRAEMIA",
  },
  {
    pattern: /\bbradycardia\b|\bsinus\s+bradycardia\b/gi,
    canonicalPt: "BRADYCARDIA",
  },
  {
    pattern: /\bhypotension\b|\borthostatic\s+hypotension\b/gi,
    canonicalPt: "HYPOTENSION",
  },
  {
    pattern: /\bhypertension\b|\belevated\s+blood\s+pressure\b/gi,
    canonicalPt: "HYPERTENSION",
  },
  {
    pattern: /\bdyspn(?:o)?ea\b|\bshortness\s+of\s+breath\b|\bdifficulty\s+breathing\b|\brespiratory\s+distress\b/gi,
    canonicalPt: "DYSPNOEA",
  },
  {
    pattern: /\bmyalgia(?:s)?\b|\bmuscle\s+pain(?:s)?\b|\bproximal\s+muscle\s+weakness\b|\bmuscle\s+aches?\b/gi,
    canonicalPt: "MYALGIA",
  },
  {
    pattern: /\bmaculopapular\s+rash\b|\burticaria\b|\bhives\b|\berythematous\s+rash\b|\brash\b/gi,
    canonicalPt: "RASH",
  },
  {
    pattern: /\bpruritus\b|\bgeneralized\s+itching\b|\bitching\b/gi,
    canonicalPt: "PRURITUS",
  },
  {
    pattern: /\bnausea\b|\bqueasiness\b/gi,
    canonicalPt: "NAUSEA",
  },
  {
    pattern: /\bvomiting\b|\bemesis\b/gi,
    canonicalPt: "VOMITING",
  },
  {
    pattern: /\bdiarrh(?:o)?ea\b|\bloose\s+stools\b|\bwatery\s+diarrhea\b/gi,
    canonicalPt: "DIARRHOEA",
  },
  {
    pattern: /\bdizziness\b|\blightheadedness\b|\bvertigo\b/gi,
    canonicalPt: "DIZZINESS",
  },
  {
    pattern: /\bheadache(?:s)?\b|\bmigraine\b|\bcephalalgia\b/gi,
    canonicalPt: "HEADACHE",
  },
  {
    pattern: /\bfatigue\b|\basthenia\b|\blethargy\b|\bexhaustion\b/gi,
    canonicalPt: "FATIGUE",
  },
  {
    pattern: /\bdry\s+cough\b|\bpersistent\s+cough\b|\bcough\b/gi,
    canonicalPt: "COUGH",
  },
  {
    pattern: /\bconfusion(?:al\s+state)?\b|\bdelirium\b|\bdisorientation\b/gi,
    canonicalPt: "CONFUSIONAL STATE",
  },
  {
    pattern: /\bperipheral\s+neuropathy\b|\bparaesthesia\b|\bparesthesia\b|\bnumbness\s+and\s+tingling\b/gi,
    canonicalPt: "PERIPHERAL NEUROPATHY",
  },
];

// Semantic concept clusters for high-recall embedding similarity to loaded REAC PTs
const SEMANTIC_CONCEPT_CLUSTERS: string[][] = [
  ["gastrointestinal", "haemorrhage", "hemorrhage", "gi", "bleed", "bleeding", "melena", "melaena", "hematemesis", "haematemesis", "ulcer", "gastric"],
  ["rhabdomyolysis", "myoglobinuria", "ck", "creatine", "kinase", "myopathy"],
  ["anaphylactic", "anaphylaxis", "anaphylactoid", "shock", "allergic", "hypersensitivity", "bronchospasm"],
  ["angioedema", "angioneurotic", "swelling", "lip", "tongue", "facial", "laryngeal", "oedema", "edema"],
  ["hepatic", "liver", "hepatitis", "hepatotoxicity", "jaundice", "dili", "transaminases", "alt", "ast", "bilirubin", "failure"],
  ["renal", "kidney", "nephropathy", "creatinine", "anuria", "oliguria", "azotaemia", "acute"],
  ["myalgia", "muscle", "pain", "ache", "weakness", "cramps"],
  ["dyspnoea", "dyspnea", "breath", "breathing", "shortness", "respiratory", "wheezing"],
  ["rash", "urticaria", "hives", "erythema", "erythematous", "maculopapular", "exanthem", "skin"],
  ["pruritus", "itching", "itchy", "pruritic"],
  ["nausea", "queasy", "stomach"],
  ["vomiting", "emesis", "retching"],
  ["diarrhoea", "diarrhea", "stools", "loose", "bowel"],
  ["dizziness", "vertigo", "lightheadedness", "syncope", "presyncope"],
  ["headache", "cephalalgia", "migraine"],
  ["fatigue", "asthenia", "lethargy", "tiredness", "malaise"],
  ["neutropenia", "agranulocytosis", "leukopenia", "granulocytopenia", "neutrophil", "wbc"],
  ["stevens", "johnson", "ten", "epidermal", "necrolysis", "blistering", "mucocutaneous"],
  ["aplastic", "anaemia", "anemia", "pancytopenia", "marrow"],
  ["thrombocytopenia", "platelets", "platelet"],
  ["myocardial", "infarction", "coronary", "stemi", "nstemi", "troponin"],
  ["cough", "tussis"],
  ["hypotension", "low", "pressure"],
  ["hypertension", "elevated", "high", "pressure"],
  ["hypoglycaemia", "hypoglycemia", "glucose"],
];

const EMBED_DIM = 128;

function hashToken(str: string, seed = 0): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Computes a normalized 128-dim clinical semantic + character 3-gram embedding
 * for fast cosine-similarity matching against loaded REAC preferred terms.
 */
export function computeClinicalEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBED_DIM);
  const norm = text
    .toLowerCase()
    .replace(/haem/g, "hem")
    .replace(/oedem/g, "edem")
    .replace(/anaem/g, "anem")
    .replace(/diarrhoe/g, "diarrhe")
    .replace(/dyspnoe/g, "dyspne")
    .replace(/glycaem/g, "glycem")
    .replace(/kalaem/g, "kalem")
    .replace(/natraem/g, "natrem")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!norm) return vec;

  const words = norm.split(" ");

  // 1. Concept cluster dimensions (0..31)
  for (let c = 0; c < SEMANTIC_CONCEPT_CLUSTERS.length; c++) {
    const cluster = SEMANTIC_CONCEPT_CLUSTERS[c];
    for (const w of words) {
      if (cluster.includes(w)) {
        vec[c % 32] += 3.5;
      }
    }
  }

  // 2. Word token hashed projections (32..79)
  for (const w of words) {
    if (w.length < 2) continue;
    const idx1 = 32 + (hashToken(w, 1) % 48);
    const idx2 = 32 + (hashToken(w, 2) % 48);
    vec[idx1] += 2.0;
    vec[idx2] += 1.5;
  }

  // 3. Character 3-grams (80..127)
  const padded = ` ${norm} `;
  for (let i = 0; i <= padded.length - 3; i++) {
    const trigram = padded.slice(i, i + 3);
    const idx = 80 + (hashToken(trigram, 3) % 48);
    vec[idx] += 0.6;
  }

  let mag = 0;
  for (let i = 0; i < EMBED_DIM; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < EMBED_DIM; i++) vec[i] /= mag;
  }
  return vec;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

/**
 * Maps a reaction phrase to the top 3 Preferred Term candidates in `availableReacPts`
 * by embedding cosine similarity.
 */
export function rankReactionCandidates(
  verbatim: string,
  canonicalHint: string | null,
  availableReacPts: string[] = DEFAULT_REAC_PTS,
): TermCandidate[] {
  const uniquePts = Array.from(
    new Set(
      (availableReacPts.length > 0 ? availableReacPts : DEFAULT_REAC_PTS)
        .map((p) => normalizePt(p))
        .filter(Boolean),
    ),
  );

  const queryText = canonicalHint ? `${verbatim} ${canonicalHint}` : verbatim;
  const queryVec = computeClinicalEmbedding(queryText);
  const verbatimUpper = normalizePt(verbatim);

  const scored = uniquePts.map((pt) => {
    const ptVec = computeClinicalEmbedding(pt);
    let sim = cosineSimilarity(queryVec, ptVec);
    if (canonicalHint && pt === normalizePt(canonicalHint)) {
      sim = Math.max(sim, 0.96);
    }
    if (pt === verbatimUpper) {
      sim = 0.99;
    }
    return {
      pt,
      score: Math.round(sim * 1000) / 1000,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.pt.localeCompare(b.pt));
  return scored.slice(0, 3);
}

/**
 * NegEx / ConText negation, uncertainty, and historical context detector.
 */
export type ContextFlags = {
  negated: boolean;
  uncertain: boolean;
  historical: boolean;
  cue: string | null;
};

const NEGATION_PRE_CUES = [
  "no evidence of",
  "no sign of",
  "no signs of",
  "no symptoms of",
  "no history of",
  "no complaints of",
  "negative for",
  "ruled out for",
  "ruled out",
  "rules out",
  "free of",
  "absence of",
  "without any",
  "without",
  "denies any",
  "denies",
  "denied any",
  "denied",
  "never had",
  "not experiencing",
  "no new",
  "no",
  "not",
];

const NEGATION_POST_CUES = [
  "was ruled out",
  "were ruled out",
  "is ruled out",
  "ruled out",
  "was excluded",
  "were excluded",
  "absent",
  "not present",
  "not seen",
  "not detected",
];

const HISTORY_PRE_CUES = [
  "family history of",
  "mother had",
  "father had",
  "sister had",
  "brother had",
  "past medical history of",
  "past history of",
  "pmh of",
  "pmh:",
  "prior history of",
  "history of",
  "hx of",
  "known history of",
  "pre-existing",
  "preexisting",
  "chronic baseline",
  "baseline",
];

const UNCERTAINTY_PRE_CUES = [
  "cannot rule out",
  "can not rule out",
  "unable to rule out",
  "to rule out",
  "r/o",
  "rule out",
  "differential includes",
  "differential diagnosis includes",
  "suspected",
  "suspicion of",
  "possible",
  "possibly",
  "probable",
  "probably",
  "questionable",
  "equivocal for",
  "may represent",
  "might be",
  "unlikely",
];

const CLAUSE_BREAKERS = /(\.|;|\bbut\b|\bhowever\b|\balthough\b|\bthough\b|\bexcept\b|\byet\b|\bnow presents\b|\bdeveloped\b|\bpresented with\b)/i;

export function detectContextModifiers(
  fullText: string,
  spanStart: number,
  spanEnd: number,
): ContextFlags {
  // Find sentence boundaries around [spanStart, spanEnd)
  let sentStart = spanStart;
  while (sentStart > 0 && !/[.!?\n]/.test(fullText[sentStart - 1])) {
    sentStart--;
  }
  let sentEnd = spanEnd;
  while (sentEnd < fullText.length && !/[.!?\n]/.test(fullText[sentEnd])) {
    sentEnd++;
  }

  let preWindow = fullText.slice(Math.max(sentStart, spanStart - 95), spanStart).toLowerCase();
  // Trim preWindow after the last clause breaker before the entity
  const breakerParts = preWindow.split(CLAUSE_BREAKERS);
  if (breakerParts.length > 1) {
    preWindow = breakerParts[breakerParts.length - 1];
  }

  let postWindow = fullText.slice(spanEnd, Math.min(sentEnd, spanEnd + 65)).toLowerCase();
  const postBreakerIdx = postWindow.search(CLAUSE_BREAKERS);
  if (postBreakerIdx >= 0) {
    postWindow = postWindow.slice(0, postBreakerIdx);
  }

  // Check uncertainty first when "rule out" / "cannot rule out" is used (distinct from "ruled out")
  for (const cue of UNCERTAINTY_PRE_CUES) {
    const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z])${escaped}\\s+[^.;]{0,50}$`, "i");
    if (re.test(preWindow)) {
      return { negated: false, uncertain: true, historical: false, cue };
    }
  }

  // Check negation pre-cues
  for (const cue of NEGATION_PRE_CUES) {
    const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z])${escaped}(?:\\s+|\\s*[:,]\\s*)[^.;]{0,55}$`, "i");
    if (re.test(preWindow)) {
      return { negated: true, uncertain: false, historical: false, cue };
    }
  }

  // Check negation post-cues
  for (const cue of NEGATION_POST_CUES) {
    const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^[^.;]{0,30}\\b${escaped}\\b`, "i");
    if (re.test(postWindow)) {
      return { negated: true, uncertain: false, historical: false, cue };
    }
  }

  // Check historical / family history pre-cues
  for (const cue of HISTORY_PRE_CUES) {
    const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z])${escaped}\\s+[^.;]{0,60}$`, "i");
    if (re.test(preWindow)) {
      return { negated: false, uncertain: false, historical: true, cue };
    }
  }

  if (/^\s*(?:in\s+the\s+past|years?\s+ago|prior\s+to\s+starting)/i.test(postWindow)) {
    return { negated: false, uncertain: false, historical: true, cue: "past history" };
  }

  return { negated: false, uncertain: false, historical: false, cue: null };
}

export type SeriousnessCriterionKey = keyof SeriousnessCriteria;
export type NarrativeExtractionResult = NarrativeExtraction;
export type ModelLoadProgress = {
  status: string;
  progress: number;
  message: string;
};

export interface RedactedPiiSpan {
  type: string;
  text: string;
  start: number;
  end: number;
}

export function redactNarrativePiiDetailed(text: string): {
  redactedText: string;
  redactedSpans: RedactedPiiSpan[];
} {
  const rules: { type: string; re: RegExp; replacement: string }[] = [
    {
      type: "Email",
      re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      replacement: "[REDACTED_EMAIL]",
    },
    {
      type: "Phone",
      re: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
      replacement: "[REDACTED_PHONE]",
    },
    {
      type: "SSN",
      re: /\b\d{3}-\d{2}-\d{4}\b/g,
      replacement: "[REDACTED_SSN]",
    },
    {
      type: "MRN/Record#",
      re: /\b(?:MRN|Medical\s+Record(?:\s+Number)?|Record\s*#|Chart\s*#|Patient\s+ID)\s*[:#]?\s*[A-Za-z0-9-]{4,}\b/gi,
      replacement: "[REDACTED_MRN]",
    },
    {
      type: "DOB",
      re: /\b(?:DOB|Date\s+of\s+Birth|born\s+on)\s*[:#]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi,
      replacement: "DOB: [REDACTED_DOB]",
    },
    {
      type: "Name",
      re: /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
      replacement: "[REDACTED_NAME]",
    },
    {
      type: "Patient Name",
      re: /\bPatient\s+(?:Name\s*:\s*)?[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
      replacement: "Patient [REDACTED_NAME]",
    },
  ];

  const redactedSpans: RedactedPiiSpan[] = [];
  for (const r of rules) {
    const copy = new RegExp(r.re.source, r.re.flags);
    let m: RegExpExecArray | null;
    while ((m = copy.exec(text)) !== null) {
      redactedSpans.push({
        type: r.type,
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  redactedSpans.sort((a, b) => a.start - b.start);

  let redactedText = text;
  for (const r of rules) {
    redactedText = redactedText.replace(r.re, r.replacement);
  }
  return { redactedText, redactedSpans };
}

/**
 * Strips obvious PII identifiers before sending narrative text to an external LLM.
 */
export function redactNarrativePii(text: string): string {
  return redactNarrativePiiDetailed(text).redactedText;
}

// Build sorted drug surface list from local dictionary
const ALL_DRUG_SURFACES = Array.from(
  new Set([
    ...Object.keys(DRUG_ALIAS_TO_CANONICAL),
    ...Array.from(CANONICAL_GENERICS),
  ]),
).sort((a, b) => b.length - a.length);

function extractDrugContextAttributes(fullText: string, spanStart: number, spanEnd: number): {
  role: "PS" | "SS" | "C";
  dose: string | null;
  route: string | null;
  startDate: string | null;
  stopDate: string | null;
  indication: string | null;
} {
  let sentStart = spanStart;
  while (sentStart > 0 && !/[.!?\n]/.test(fullText[sentStart - 1])) sentStart--;
  let sentEnd = spanEnd;
  while (sentEnd < fullText.length && !/[.!?\n]/.test(fullText[sentEnd])) sentEnd++;

  const pre = fullText.slice(Math.max(sentStart, spanStart - 75), spanStart);
  const post = fullText.slice(spanEnd, Math.min(sentEnd, spanEnd + 95));
  const sentence = fullText.slice(sentStart, sentEnd);

  // Determine suspect vs concomitant role
  let role: "PS" | "SS" | "C" = "PS";
  if (
    /\b(?:concomitant(?:ly)?|co-?medications?\s+included|also\s+taking|background\s+therapy|home\s+medications?\s+include|chronic\s+meds?\s+include|maintained\s+on\s+chronic)\b/i.test(
      pre,
    ) ||
    /\(\s*concomitant\s*\)/i.test(post)
  ) {
    role = "C";
  } else if (/\b(?:secondary\s+suspect|co-?suspect)\b/i.test(pre + " " + post)) {
    role = "SS";
  }

  // Dose extraction (e.g., "40 mg daily", "500mg BID", "5 mg")
  const doseMatch = post.match(
    /^\s*(?:at\s+|dose\s+of\s+)?(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|mL|units?|IU)(?:\s*(?:\/|\s+per\s+)\s*(?:day|d|kg|dose))?(?:\s*(?:daily|once\s+daily|twice\s+daily|QD|BID|TID|QID|QHS|PRN|weekly))?)/i,
  );
  const dose = doseMatch ? doseMatch[1].trim() : null;

  // Route extraction
  const routeMatch = (post + " " + pre).match(
    /\b(PO|IV|IM|SC|SQ|subcutaneous(?:ly)?|intravenous(?:ly)?|intramuscular(?:ly)?|oral(?:ly)?|topical(?:ly)?|inhaled|sublingual)\b/i,
  );
  const route = routeMatch ? routeMatch[1].toUpperCase() : null;

  // Start / Stop dates
  const startMatch = sentence.match(
    /\b(?:started|initiated|begun|commenced)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d+\s*(?:days?|weeks?|months?)\s+ago)/i,
  );
  const stopMatch = sentence.match(
    /\b(?:stopped|discontinued|withdrawn|held)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  );

  // Indication extraction ("on X for AF", "started X for hypertension")
  const indMatch = post.match(
    /\bfor\s+([A-Za-z][A-Za-z0-9\s-]{1,32}?)(?=\s*(?:[.,;()]|\band\b|\bwith\b|\bafter\b|\bonset\b|\bdeveloped\b|\bpresented\b|$))/i,
  );
  const indication = indMatch ? indMatch[1].trim().toUpperCase() : null;

  return {
    role,
    dose,
    route,
    startDate: startMatch ? startMatch[1] : null,
    stopDate: stopMatch ? stopMatch[1] : null,
    indication,
  };
}

function extractOnsetNearReaction(fullText: string, spanStart: number, spanEnd: number): string | null {
  let sentStart = spanStart;
  while (sentStart > 0 && !/[.!?\n]/.test(fullText[sentStart - 1])) sentStart--;
  let sentEnd = spanEnd;
  while (sentEnd < fullText.length && !/[.!?\n]/.test(fullText[sentEnd])) sentEnd++;
  const windowText = fullText.slice(sentStart, sentEnd);

  const patterns = [
    /\b(?:within|after|onset\s*(?:of|in)?\s*[~≈]?)\s*(\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?))/i,
    /\b(\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?))\s+(?:after|following|post|into\s+therapy|later)\b/i,
    /\bon\s+(day\s+\d+)\b/i,
  ];
  for (const p of patterns) {
    const m = windowText.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractPatientAge(text: string): ExtractedItem<PatientAge> | null {
  const patterns: { re: RegExp; unit: PatientAge["unit"] }[] = [
    {
      re: /\b(\d{1,3})\s*(?:-|\s)?\s*(?:year|yr|y\/o|yo)[-\s]*(?:old)?\b/i,
      unit: "YR",
    },
    {
      re: /\bage(?:d)?\s*[:=]?\s*(\d{1,3})\s*(?:years?|yrs?)?\b/i,
      unit: "YR",
    },
    {
      re: /\b(\d{1,2})\s*(?:-|\s)?\s*month[-\s]*old\b/i,
      unit: "MON",
    },
  ];
  for (const { re, unit } of patterns) {
    const m = re.exec(text);
    if (m && m.index !== undefined) {
      const val = Number(m[1]);
      if (val > 0 && val <= 120) {
        return {
          value: { value: val, unit },
          span: { start: m.index, end: m.index + m[0].length, text: m[0] },
          confidence: 0.96,
          status: "pending",
        };
      }
    }
  }
  return null;
}

function extractPatientSex(text: string): ExtractedItem<PatientSex> | null {
  const patterns: { re: RegExp; sex: PatientSex }[] = [
    { re: /\b(?:female|woman|girl|gentlewoman)\b/i, sex: "F" },
    { re: /\b(?:male|man|boy|gentleman)\b/i, sex: "M" },
    { re: /\b\d{1,3}\s*(?:yo|y\/o|yr|year[-\s]*old)?\s*(F|M)\b/, sex: "F" },
  ];
  for (const { re, sex } of patterns) {
    const m = re.exec(text);
    if (m && m.index !== undefined) {
      const resolvedSex: PatientSex =
        m[1] === "M" ? "M" : m[1] === "F" ? "F" : sex;
      return {
        value: resolvedSex,
        span: { start: m.index, end: m.index + m[0].length, text: m[0] },
        confidence: 0.95,
        status: "pending",
      };
    }
  }
  return null;
}

function extractReporterType(text: string): ExtractedItem<ReporterType> | null {
  const rules: { re: RegExp; code: ReporterType }[] = [
    {
      re: /\b(?:reported\s+by\s+(?:a\s+|the\s+)?(?:physician|doctor|cardiologist|hepatologist|nephrologist|neurologist|oncologist|prescriber|clinician|md)|physician\s+report)\b/i,
      code: "MD",
    },
    {
      re: /\b(?:reported\s+by\s+(?:a\s+|the\s+)?(?:pharmacist|clinical\s+pharmacist|pharmd)|pharmacist\s+report)\b/i,
      code: "PH",
    },
    {
      re: /\b(?:reported\s+by\s+(?:a\s+|the\s+)?(?:nurse|rn|np|pa|health(?:care)?\s+professional))\b/i,
      code: "HP",
    },
    {
      re: /\b(?:reported\s+by\s+(?:a\s+|the\s+)?(?:patient|consumer|family\s+member|spouse|daughter|son)|patient\s+self-report|consumer\s+report)\b/i,
      code: "CN",
    },
    {
      re: /\b(?:reported\s+by\s+(?:an?\s+)?attorney|lawyer|legal\s+representative)\b/i,
      code: "LW",
    },
  ];
  for (const { re, code } of rules) {
    const m = re.exec(text);
    if (m && m.index !== undefined) {
      return {
        value: code,
        span: { start: m.index, end: m.index + m[0].length, text: m[0] },
        confidence: 0.92,
        status: "pending",
      };
    }
  }
  return null;
}

function extractDechallenge(text: string): ExtractedItem<DechallengeResult> | null {
  const posRe =
    /\b(?:resolved|improved|subsided|abated|normalized|cleared)\s+(?:after|following|upon)\s+(?:stopping|discontinuing|discontinuation\s+of|cessation\s+of|withdrawing|holding)\b|\b(?:drug|medication|therapy)\s+was\s+(?:stopped|discontinued|held|withdrawn)\s+and\s+(?:symptoms?|reaction|bleeding|rash|pain|myalgia|levels?)\s+(?:resolved|improved|subsided)\b|\bpositive\s+dechallenge\b/i;
  const negRe =
    /\b(?:persisted|continued|did\s+not\s+resolve|unchanged|worsened)\s+despite\s+(?:stopping|discontinuing|discontinuation|withdrawal)\b|\bnegative\s+dechallenge\b/i;

  const posM = posRe.exec(text);
  if (posM && posM.index !== undefined) {
    return {
      value: "positive",
      span: { start: posM.index, end: posM.index + posM[0].length, text: posM[0] },
      confidence: 0.91,
      status: "pending",
    };
  }
  const negM = negRe.exec(text);
  if (negM && negM.index !== undefined) {
    return {
      value: "negative",
      span: { start: negM.index, end: negM.index + negM[0].length, text: negM[0] },
      confidence: 0.9,
      status: "pending",
    };
  }
  return null;
}

function extractRechallenge(text: string): ExtractedItem<RechallengeResult> | null {
  const posRe =
    /\b(?:recurred|returned|reappeared)\s+(?:upon|after|on)\s+(?:rechallenge|restarting|re-exposure|reintroducing|resuming)\b|\bpositive\s+rechallenge\b/i;
  const negRe =
    /\b(?:no\s+recurrence|did\s+not\s+recur|tolerated)\s+(?:upon|after|on)\s+(?:rechallenge|restarting|reintroduction)\b|\bnegative\s+rechallenge\b/i;
  const notDoneRe = /\brechallenge\s+was\s+not\s+(?:performed|done|attempted)\b/i;

  const posM = posRe.exec(text);
  if (posM && posM.index !== undefined) {
    return {
      value: "positive",
      span: { start: posM.index, end: posM.index + posM[0].length, text: posM[0] },
      confidence: 0.92,
      status: "pending",
    };
  }
  const negM = negRe.exec(text);
  if (negM && negM.index !== undefined) {
    return {
      value: "negative",
      span: { start: negM.index, end: negM.index + negM[0].length, text: negM[0] },
      confidence: 0.9,
      status: "pending",
    };
  }
  const ndM = notDoneRe.exec(text);
  if (ndM && ndM.index !== undefined) {
    return {
      value: "not_done",
      span: { start: ndM.index, end: ndM.index + ndM[0].length, text: ndM[0] },
      confidence: 0.9,
      status: "pending",
    };
  }
  return null;
}

function extractOutcome(text: string): ExtractedItem<OutcomeResult> | null {
  const rules: { re: RegExp; val: OutcomeResult }[] = [
    {
      re: /\b(?:patient\s+died|fatal\s+outcome|expired|resulted\s+in\s+death|succumbed)\b/i,
      val: "fatal",
    },
    {
      re: /\b(?:fully\s+recovered|completely\s+resolved|symptoms\s+resolved|recovered\s+without\s+sequelae|resolved)\b/i,
      val: "recovered",
    },
    {
      re: /\b(?:recovering|improving|gradually\s+improving|stabilizing)\b/i,
      val: "recovering",
    },
    {
      re: /\b(?:not\s+recovered|ongoing|had\s+not\s+resolved|persisted)\b/i,
      val: "not_recovered",
    },
  ];
  for (const { re, val } of rules) {
    const m = re.exec(text);
    if (m && m.index !== undefined) {
      const ctx = detectContextModifiers(text, m.index, m.index + m[0].length);
      if (ctx.negated) continue;
      return {
        value: val,
        span: { start: m.index, end: m.index + m[0].length, text: m[0] },
        confidence: 0.9,
        status: "pending",
      };
    }
  }
  return null;
}

function extractSeriousnessCriteria(
  text: string,
  reactions: ExtractedReaction[],
): SeriousnessCriteria {
  const emptyCrit = (): ExtractedCriterion => ({
    present: false,
    span: null,
    confidence: 0.95,
    status: "pending",
  });

  const criteria: SeriousnessCriteria = {
    death: emptyCrit(),
    lifeThreatening: emptyCrit(),
    hospitalisation: emptyCrit(),
    disability: emptyCrit(),
    congenitalAnomaly: emptyCrit(),
    otherMedicallyImportant: emptyCrit(),
  };

  const matchNonNegated = (re: RegExp): TextSpan | null => {
    const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = globalRe.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const ctx = detectContextModifiers(text, start, end);
      if (!ctx.negated && !ctx.historical && !ctx.uncertain) {
        return { start, end, text: m[0] };
      }
    }
    return null;
  };

  const deathSpan = matchNonNegated(
    /\b(?:died|fatal|death|expired|succumbed|autopsy)\b/i,
  );
  if (deathSpan) {
    criteria.death = { present: true, span: deathSpan, confidence: 0.96, status: "pending" };
  }

  const ltSpan = matchNonNegated(
    /\b(?:life[- ]threatening|intubated|mechanical\s+ventilation|cardiac\s+arrest|anaphylactic\s+shock|circulatory\s+collapse|icu\s+admission|intensive\s+care)\b/i,
  );
  if (ltSpan) {
    criteria.lifeThreatening = { present: true, span: ltSpan, confidence: 0.94, status: "pending" };
  }

  const hospSpan = matchNonNegated(
    /\b(?:hospitali[sz]ed|hospitali[sz]ation|admitted\s+to\s+(?:the\s+)?(?:hospital|ward|inpatient|medical\s+service)|inpatient\s+admission)\b/i,
  );
  if (hospSpan) {
    criteria.hospitalisation = { present: true, span: hospSpan, confidence: 0.95, status: "pending" };
  }

  const disSpan = matchNonNegated(
    /\b(?:permanent\s+disability|persistent\s+disability|incapacitating|permanently\s+disabled)\b/i,
  );
  if (disSpan) {
    criteria.disability = { present: true, span: disSpan, confidence: 0.92, status: "pending" };
  }

  const congSpan = matchNonNegated(
    /\b(?:congenital\s+anomaly|birth\s+defect|teratogenic|fetal\s+malformation)\b/i,
  );
  if (congSpan) {
    criteria.congenitalAnomaly = { present: true, span: congSpan, confidence: 0.94, status: "pending" };
  }

  // Check active (non-negated, non-historical, non-uncertain) medically important reactions
  const activeSeriousReaction = reactions.find(
    (r) =>
      !r.negated &&
      !r.historical &&
      !r.uncertain &&
      [
        "GASTROINTESTINAL HAEMORRHAGE",
        "RHABDOMYOLYSIS",
        "ANAPHYLACTIC REACTION",
        "ANGIOEDEMA",
        "HEPATIC FAILURE",
        "ACUTE KIDNEY INJURY",
        "STEVENS-JOHNSON SYNDROME",
        "NEUTROPENIA",
        "APLASTIC ANAEMIA",
        "MYOCARDIAL INFARCTION",
        "LACTIC ACIDOSIS",
        "PANCREATITIS",
        "SEIZURE",
      ].includes(r.mappedTerm),
  );

  if (activeSeriousReaction) {
    criteria.otherMedicallyImportant = {
      present: true,
      span: activeSeriousReaction.span,
      confidence: 0.9,
      status: "pending",
    };
  }

  return criteria;
}

/**
 * Rule-based + NegEx/ConText + Embedding similarity local extractor.
 * Also used as fallback if transformers.js fails to load or in offline environments,
 * and merges with transformers.js NER spans when the ONNX model is active.
 */
export function extractClinicalNarrativeSync(
  text: string,
  availableReacPts: string[] = DEFAULT_REAC_PTS,
  extraNerSpans: { word: string; entity_group: string; start: number; end: number; score: number }[] = [],
  extractorUsed: ExtractorKind = "rule-fallback",
): NarrativeExtraction {
  const drugSpans: {
    start: number;
    end: number;
    verbatim: string;
    canonical: string;
    confidence: number;
  }[] = [];

  // 1. Dictionary scan for known drugs/brands
  for (const surface of ALL_DRUG_SURFACES) {
    const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (drugSpans.some((d) => start < d.end && end > d.start)) continue;
      drugSpans.push({
        start,
        end,
        verbatim: m[0],
        canonical: canonicalizeDrug(m[0]),
        confidence: 0.95,
      });
    }
  }

  // 2. Merge any additional Medication spans from transformers.js biomedical NER
  for (const ner of extraNerSpans) {
    if (!/Medication/i.test(ner.entity_group)) continue;
    const start = ner.start;
    const end = ner.end;
    const verbatim = text.slice(start, end).trim();
    if (verbatim.length < 3) continue;
    if (drugSpans.some((d) => start < d.end && end > d.start)) continue;
    if (isKnownDrugTerm(verbatim) || ner.score >= 0.75) {
      drugSpans.push({
        start,
        end,
        verbatim,
        canonical: canonicalizeDrug(verbatim),
        confidence: Math.round(ner.score * 100) / 100,
      });
    }
  }

  drugSpans.sort((a, b) => a.start - b.start);

  const suspectDrugs: ExtractedDrug[] = [];
  const concomitantDrugs: ExtractedDrug[] = [];

  drugSpans.forEach((d, idx) => {
    const ctx = detectContextModifiers(text, d.start, d.end);
    const attrs = extractDrugContextAttributes(text, d.start, d.end);
    const item: ExtractedDrug = {
      id: `drug-${idx + 1}`,
      role: attrs.role,
      verbatim: d.verbatim,
      canonical: d.canonical,
      dose: attrs.dose,
      route: attrs.route,
      startDate: attrs.startDate,
      stopDate: attrs.stopDate,
      indication: attrs.indication,
      negated: ctx.negated,
      uncertain: ctx.uncertain,
      historical: ctx.historical,
      span: { start: d.start, end: d.end, text: d.verbatim },
      confidence: d.confidence,
      status: "pending",
    };
    if (item.role === "C") {
      concomitantDrugs.push(item);
    } else {
      suspectDrugs.push(item);
    }
  });

  // 3. Extract reactions via clinical patterns + transformers.js Sign_symptom / Disease_disorder spans
  const rawReactions: {
    start: number;
    end: number;
    verbatim: string;
    canonicalHint: string | null;
    confidence: number;
  }[] = [];

  for (const anchor of CLINICAL_SYNONYM_ANCHORS) {
    const re = new RegExp(anchor.pattern.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (rawReactions.some((r) => start < r.end && end > r.start)) continue;
      if (drugSpans.some((d) => start < d.end && end > d.start)) continue;
      rawReactions.push({
        start,
        end,
        verbatim: m[0],
        canonicalHint: anchor.canonicalPt,
        confidence: 0.93,
      });
    }
  }

  for (const ner of extraNerSpans) {
    if (!/Sign_symptom|Disease_disorder/i.test(ner.entity_group)) continue;
    const start = ner.start;
    const end = ner.end;
    const verbatim = text.slice(start, end).trim();
    if (verbatim.length < 3 || ner.score < 0.7) continue;
    if (rawReactions.some((r) => start < r.end && end > r.start)) continue;
    if (drugSpans.some((d) => start < d.end && end > d.start)) continue;
    rawReactions.push({
      start,
      end,
      verbatim,
      canonicalHint: null,
      confidence: Math.round(ner.score * 100) / 100,
    });
  }

  rawReactions.sort((a, b) => a.start - b.start);

  // Filter out spans that match a drug's stated indication ("on warfarin for AF")
  const reactions: ExtractedReaction[] = [];
  rawReactions.forEach((r, idx) => {
    const pre = text.slice(Math.max(0, r.start - 20), r.start);
    if (/\b(?:on\s+\w+\s+for|started\s+for|treated\s+for|prescribed\s+for)\s*$/i.test(pre)) {
      return;
    }
    const ctx = detectContextModifiers(text, r.start, r.end);
    const candidates = rankReactionCandidates(r.verbatim, r.canonicalHint, availableReacPts);
    const mappedTerm = candidates[0]?.pt ?? normalizePt(r.canonicalHint ?? r.verbatim);
    const onset = extractOnsetNearReaction(text, r.start, r.end);

    reactions.push({
      id: `reac-${idx + 1}`,
      verbatim: r.verbatim,
      mappedTerm,
      candidates,
      negated: ctx.negated,
      uncertain: ctx.uncertain,
      historical: ctx.historical,
      contextCue: ctx.cue,
      onset,
      span: { start: r.start, end: r.end, text: r.verbatim },
      confidence: r.confidence,
      status: "pending",
    });
  });

  const seriousness = extractSeriousnessCriteria(text, reactions);

  return {
    suspectDrugs,
    concomitantDrugs,
    reactions,
    dechallenge: extractDechallenge(text),
    rechallenge: extractRechallenge(text),
    outcome: extractOutcome(text),
    seriousness,
    patientAge: extractPatientAge(text),
    patientSex: extractPatientSex(text),
    reporterType: extractReporterType(text),
    extractorUsed,
    modelInfo: extractorUsed === "transformers-local" ? LOCAL_NER_MODEL_INFO : null,
    requiresHumanReview: true,
    regulatoryDisclaimer: REGULATORY_DISCLAIMER,
  };
}

// Lazy singleton for in-browser transformers.js pipeline
let nerPipelinePromise: Promise<unknown> | null = null;

export type ModelProgressCallback = (info: {
  status: string;
  file?: string;
  progress?: number;
}) => void;

/**
 * Runs the in-browser biomedical NER pipeline (`onnx-community/biomedical-ner-all-ONNX`,
 * Apache-2.0, ~63.9 MB quantized ONNX) via `@xenova/transformers`, lazy-loaded only on /nlp.
 * Automatically falls back to `rule-fallback` if offline or WebAssembly/ONNX fails.
 */
export async function extractWithLocalModel(
  text: string,
  availableReacPts: string[] = DEFAULT_REAC_PTS,
  onProgress?: ModelProgressCallback,
): Promise<NarrativeExtraction> {
  try {
    if (!nerPipelinePromise) {
      nerPipelinePromise = (async () => {
        const transformers = await import("@xenova/transformers");
        transformers.env.allowLocalModels = false;
        return transformers.pipeline(
          "token-classification",
          "onnx-community/biomedical-ner-all-ONNX",
          {
            quantized: true,
            progress_callback: (p: { status: string; file?: string; progress?: number }) => {
              onProgress?.(p);
            },
          },
        );
      })();
    }

    const classifier = (await nerPipelinePromise) as (
      input: string,
      opts?: { aggregation_strategy?: string },
    ) => Promise<
      {
        entity_group?: string;
        entity?: string;
        word: string;
        score: number;
        start?: number;
        end?: number;
      }[]
    >;

    onProgress?.({ status: "ready", progress: 100 });
    const rawEntities = await classifier(text, { aggregation_strategy: "simple" });

    const nerSpans: {
      word: string;
      entity_group: string;
      start: number;
      end: number;
      score: number;
    }[] = [];

    for (const ent of rawEntities ?? []) {
      const cleanWord = ent.word.replace(/^##/, "").trim();
      if (!cleanWord) continue;
      let start = ent.start;
      let end = ent.end;
      if (start === undefined || end === undefined) {
        const found = text.toLowerCase().indexOf(cleanWord.toLowerCase());
        if (found >= 0) {
          start = found;
          end = found + cleanWord.length;
        }
      }
      if (start !== undefined && end !== undefined) {
        nerSpans.push({
          word: cleanWord,
          entity_group: ent.entity_group ?? ent.entity ?? "",
          start,
          end,
          score: ent.score,
        });
      }
    }

    return extractClinicalNarrativeSync(text, availableReacPts, nerSpans, "transformers-local");
  } catch {
    nerPipelinePromise = null;
    onProgress?.({ status: "fallback", progress: 100 });
    return extractClinicalNarrativeSync(text, availableReacPts, [], "rule-fallback");
  }
}

/**
 * Validates an LLM extraction payload and rejects any entity span whose verbatim text
 * does not occur verbatim in the original narrative.
 */
export function validateAndAnchorLlmExtraction(
  narrative: string,
  rawPayload: Partial<NarrativeExtraction>,
  availableReacPts: string[] = DEFAULT_REAC_PTS,
  redactedPreview?: string,
): NarrativeExtraction {
  const findVerbatimSpan = (sub: string | undefined | null): TextSpan | null => {
    if (!sub || !sub.trim()) return null;
    const trimmed = sub.trim();
    const exactIdx = narrative.indexOf(trimmed);
    if (exactIdx >= 0) {
      return { start: exactIdx, end: exactIdx + trimmed.length, text: trimmed };
    }
    const lowerIdx = narrative.toLowerCase().indexOf(trimmed.toLowerCase());
    if (lowerIdx >= 0) {
      const actual = narrative.slice(lowerIdx, lowerIdx + trimmed.length);
      return { start: lowerIdx, end: lowerIdx + actual.length, text: actual };
    }
    return null;
  };

  const validateDrugList = (
    list: Partial<ExtractedDrug>[] | undefined,
    defaultRole: "PS" | "C",
  ): ExtractedDrug[] => {
    const out: ExtractedDrug[] = [];
    (list ?? []).forEach((d, idx) => {
      const verbatim = d.verbatim ?? d.span?.text;
      const span = findVerbatimSpan(verbatim);
      if (!span) return; // Reject hallucinated spans not present verbatim in narrative
      out.push({
        id: `${defaultRole.toLowerCase()}-${idx + 1}`,
        role: d.role ?? defaultRole,
        verbatim: span.text,
        canonical: canonicalizeDrug(d.canonical || span.text),
        dose: d.dose ?? null,
        route: d.route ?? null,
        startDate: d.startDate ?? null,
        stopDate: d.stopDate ?? null,
        indication: d.indication ?? null,
        negated: Boolean(d.negated),
        uncertain: Boolean(d.uncertain),
        historical: Boolean(d.historical),
        span,
        confidence: typeof d.confidence === "number" ? d.confidence : 0.9,
        status: "pending",
      });
    });
    return out;
  };

  const reactions: ExtractedReaction[] = [];
  (rawPayload.reactions ?? []).forEach((r, idx) => {
    const verbatim = r.verbatim ?? r.span?.text;
    const span = findVerbatimSpan(verbatim);
    if (!span) return; // Reject spans not verbatim in narrative
    const candidates = rankReactionCandidates(span.text, r.mappedTerm ?? null, availableReacPts);
    reactions.push({
      id: `reac-llm-${idx + 1}`,
      verbatim: span.text,
      mappedTerm: candidates[0]?.pt ?? normalizePt(r.mappedTerm ?? span.text),
      candidates,
      negated: Boolean(r.negated),
      uncertain: Boolean(r.uncertain),
      historical: Boolean(r.historical),
      contextCue: r.contextCue ?? null,
      onset: r.onset ?? null,
      span,
      confidence: typeof r.confidence === "number" ? r.confidence : 0.9,
      status: "pending",
    });
  });

  const fallback = extractClinicalNarrativeSync(narrative, availableReacPts, [], "llm-server");

  return {
    suspectDrugs: validateDrugList(rawPayload.suspectDrugs, "PS"),
    concomitantDrugs: validateDrugList(rawPayload.concomitantDrugs, "C"),
    reactions,
    dechallenge: rawPayload.dechallenge?.span
      ? (() => {
          const s = findVerbatimSpan(rawPayload.dechallenge.span.text);
          return s
            ? {
                value: rawPayload.dechallenge.value,
                span: s,
                confidence: rawPayload.dechallenge.confidence ?? 0.9,
                status: "pending",
              }
            : fallback.dechallenge;
        })()
      : fallback.dechallenge,
    rechallenge: rawPayload.rechallenge?.span
      ? (() => {
          const s = findVerbatimSpan(rawPayload.rechallenge.span.text);
          return s
            ? {
                value: rawPayload.rechallenge.value,
                span: s,
                confidence: rawPayload.rechallenge.confidence ?? 0.9,
                status: "pending",
              }
            : fallback.rechallenge;
        })()
      : fallback.rechallenge,
    outcome: rawPayload.outcome?.span
      ? (() => {
          const s = findVerbatimSpan(rawPayload.outcome.span.text);
          return s
            ? {
                value: rawPayload.outcome.value,
                span: s,
                confidence: rawPayload.outcome.confidence ?? 0.9,
                status: "pending",
              }
            : fallback.outcome;
        })()
      : fallback.outcome,
    seriousness: extractSeriousnessCriteria(narrative, reactions),
    patientAge: fallback.patientAge,
    patientSex: fallback.patientSex,
    reporterType: fallback.reporterType,
    extractorUsed: "llm-server",
    modelInfo: null,
    redactedPreview,
    requiresHumanReview: true,
    regulatoryDisclaimer: REGULATORY_DISCLAIMER,
  };
}

/**
 * Calls the optional server-side LLM extraction endpoint (`POST /api/nlp/extract`).
 * Requires explicit user consent (`consentGranted === true`) and scrubs obvious PII before sending.
 */
export async function extractWithServerLlm(
  text: string,
  consentGranted: boolean,
  availableReacPts: string[] = DEFAULT_REAC_PTS,
  endpointUrl?: string,
): Promise<NarrativeExtraction> {
  if (!consentGranted) {
    throw new Error(
      "Explicit consent is required before sending narrative text to the external LLM service.",
    );
  }
  const redacted = redactNarrativePii(text);
  const base =
    endpointUrl ||
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_NLP_API_URL) ||
    "/api/nlp/extract";

  const resp = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ narrative: redacted }),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.detail || errBody.error || `LLM endpoint returned HTTP ${resp.status}`);
  }

  const raw = (await resp.json()) as Partial<NarrativeExtraction>;
  return validateAndAnchorLlmExtraction(text, raw, availableReacPts, redacted);
}

/**
 * Original 10-drug, 7-reaction regex baseline (preserved solely for benchmark comparison).
 */
export type LegacyNlpExtraction = {
  drugs: string[];
  reactions: string[];
  onset: string | null;
  serious: boolean;
  method: "rule-based demo";
};

const LEGACY_DRUG_PATTERNS: [RegExp, string][] = [
  [/\bwarfarin\b|\bcoumadin\b/i, "WARFARIN"],
  [/\blipitor\b|\batorvastatin\b/i, "ATORVASTATIN"],
  [/\bsimvastatin\b|\bzocor\b/i, "SIMVASTATIN"],
  [/\bamoxicillin\b|\bamoxil\b/i, "AMOXICILLIN"],
  [/\bclopidogrel\b|\bplavix\b/i, "CLOPIDOGREL"],
  [/\bmetformin\b|\bglucophage\b/i, "METFORMIN"],
  [/\blisinopril\b/i, "LISINOPRIL"],
  [/\bprednisone\b/i, "PREDNISONE"],
  [/\bomeprazole\b|\bprilosec\b/i, "OMEPRAZOLE"],
  [/\bibuprofen\b/i, "IBUPROFEN"],
];

const LEGACY_REACTION_PATTERNS: [RegExp, string][] = [
  [/gastrointestinal hemorrhage|gi bleed|melena|hemorrhage|haemorrhage/i, "GASTROINTESTINAL HAEMORRHAGE"],
  [/rhabdomyolysis|ck markedly elevated|muscle pain and weakness/i, "RHABDOMYOLYSIS"],
  [/anaphylactic|difficulty breathing|lip swelling/i, "ANAPHYLACTIC REACTION"],
  [/angioedema/i, "ANGIOEDEMA"],
  [/hepatic failure/i, "HEPATIC FAILURE"],
  [/nausea/i, "NAUSEA"],
  [/headache/i, "HEADACHE"],
];

const LEGACY_SERIOUS =
  /hemorrhage|haemorrhage|anaphylact|rhabdomyolysis|hepatic failure|angioedema|death|fatal/i;

export function extractLegacyRegex(text: string): LegacyNlpExtraction {
  const drugs = new Set<string>();
  const reactions = new Set<string>();
  for (const [pattern, canonical] of LEGACY_DRUG_PATTERNS) {
    if (pattern.test(text)) drugs.add(canonical);
  }
  for (const [pattern, canonical] of LEGACY_REACTION_PATTERNS) {
    if (pattern.test(text)) reactions.add(canonical);
  }
  return {
    drugs: Array.from(drugs),
    reactions: Array.from(reactions),
    onset: null,
    serious: LEGACY_SERIOUS.test(text),
    method: "rule-based demo",
  };
}

export function extractFromNarrative(
  text: string,
  availableReacPts: string[] = DEFAULT_REAC_PTS,
): NarrativeExtraction {
  return extractClinicalNarrativeSync(text, availableReacPts, [], "rule-fallback");
}
