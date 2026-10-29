export type NlpExtraction = {
  drugs: string[];
  reactions: string[];
  onset: string | null;
  serious: boolean;
  method: "rule-based demo";
};

const DRUG_PATTERNS: [RegExp, string][] = [
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

const REACTION_PATTERNS: [RegExp, string][] = [
  [/gastrointestinal hemorrhage|gi bleed|melena|hemorrhage/i, "GASTROINTESTINAL HAEMORRHAGE"],
  [/rhabdomyolysis|ck markedly elevated|muscle pain and weakness/i, "RHABDOMYOLYSIS"],
  [/anaphylactic|difficulty breathing|lip swelling/i, "ANAPHYLACTIC REACTION"],
  [/angioedema/i, "ANGIOEDEMA"],
  [/hepatic failure/i, "HEPATIC FAILURE"],
  [/nausea/i, "NAUSEA"],
  [/headache/i, "HEADACHE"],
];

const ONSET_PATTERNS = [
  /within\s+(\d+\s*(?:hours?|days?|weeks?))/i,
  /onset\s*[~≈]?\s*(\d+\s*(?:hours?|days?|weeks?))/i,
  /(\d+\s*(?:hours?|days?|weeks?))\s+after/i,
];

const SERIOUS = /hemorrhage|haemorrhage|anaphylact|rhabdomyolysis|hepatic failure|angioedema|death|fatal/i;

export function extractFromNarrative(text: string): NlpExtraction {
  const drugs = new Set<string>();
  const reactions = new Set<string>();
  for (const [pattern, canonical] of DRUG_PATTERNS) {
    if (pattern.test(text)) drugs.add(canonical);
  }
  for (const [pattern, canonical] of REACTION_PATTERNS) {
    if (pattern.test(text)) reactions.add(canonical);
  }
  let onset: string | null = null;
  for (const pattern of ONSET_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      onset = match[1] ?? match[0];
      break;
    }
  }
  return {
    drugs: Array.from(drugs),
    reactions: Array.from(reactions),
    onset,
    serious: SERIOUS.test(text),
    method: "rule-based demo",
  };
}
