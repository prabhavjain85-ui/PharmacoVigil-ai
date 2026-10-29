const ALIAS: Record<string, string> = {
  COUMADIN: "WARFARIN",
  JANTOVEN: "WARFARIN",
  PLAVIX: "CLOPIDOGREL",
  LIPITOR: "ATORVASTATIN",
  ZOCOR: "SIMVASTATIN",
  GLUCOPHAGE: "METFORMIN",
  PRILOSEC: "OMEPRAZOLE",
  LOSEC: "OMEPRAZOLE",
  AMOXIL: "AMOXICILLIN",
};

const SUFFIXES = [
  "EXTENDED RELEASE", "HYDROCHLORIDE", "HYDROBROMIDE", "MONOHYDRATE", "POTASSIUM",
  "PHOSPHATE", "SUCCINATE", "TARTRATE", "MESYLATE", "BESYLATE", "MALEATE", "ACETATE",
  "CALCIUM", "SODIUM", "SULFATE", "CAPSULES", "CAPSULE", "TABLETS", "TABLET", "HCL",
].sort((a, b) => b.length - a.length);

export function canonicalizeDrug(name: string): string {
  let cleaned = name.trim().toUpperCase().replace(/\s+/g, " ");
  let changed = true;
  while (cleaned && changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      const marker = ` ${suffix}`;
      if (cleaned.endsWith(marker)) {
        cleaned = cleaned.slice(0, -marker.length).trim();
        changed = true;
        break;
      }
    }
  }
  return ALIAS[cleaned] ?? cleaned;
}

export function normalizePt(term: string): string {
  return term.trim().toUpperCase().replace(/\s+/g, " ");
}
