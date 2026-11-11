/**
 * Expanded local brand/synonym -> canonical generic ingredient table
 * plus optional public NLM RxNav API lookup (gated behind explicit user consent).
 */

export const DRUG_ALIAS_TO_CANONICAL: Record<string, string> = {
  // Original core mappings (preserved for parity)
  COUMADIN: "WARFARIN",
  JANTOVEN: "WARFARIN",
  PLAVIX: "CLOPIDOGREL",
  LIPITOR: "ATORVASTATIN",
  ZOCOR: "SIMVASTATIN",
  GLUCOPHAGE: "METFORMIN",
  PRILOSEC: "OMEPRAZOLE",
  LOSEC: "OMEPRAZOLE",
  AMOXIL: "AMOXICILLIN",
  NORVASC: "AMLODIPINE",

  // Anticoagulants & Antiplatelets
  ELIQUIS: "APIXABAN",
  XARELTO: "RIVAROXABAN",
  PRADAXA: "DABIGATRAN",
  SAVAYSA: "EDOXABAN",
  LOVENOX: "ENOXAPARIN",
  BRILINTA: "TICAGRELOR",
  EFFIENT: "PRASUGREL",
  ECOTRIN: "ASPIRIN",
  BAYER: "ASPIRIN",
  "ACETYLSALICYLIC ACID": "ASPIRIN",
  PERSANTINE: "DIPYRIDAMOLE",

  // Statins & Lipid-lowering
  CRESTOR: "ROSUVASTATIN",
  PRAVACHOL: "PRAVASTATIN",
  LESCOL: "FLUVASTATIN",
  LIVALO: "PITAVASTATIN",
  MEVACOR: "LOVASTATIN",
  ZETIA: "EZETIMIBE",
  TRICOR: "FENOFIBRATE",
  LOPID: "GEMFIBROZIL",
  REPATHA: "EVOLOCUMAB",
  PRALUENT: "ALIROCUMAB",

  // Antidiabetics
  FORTAMET: "METFORMIN",
  GLUMETZA: "METFORMIN",
  JANUVIA: "SITAGLIPTIN",
  TRADJENTA: "LINAGLIPTIN",
  ONGLYZA: "SAXAGLIPTIN",
  JARDIANCE: "EMPAGLIFLOZIN",
  FARXIGA: "DAPAGLIFLOZIN",
  INVOKANA: "CANAGLIFLOZIN",
  OZEMPIC: "SEMAGLUTIDE",
  WEGOVY: "SEMAGLUTIDE",
  RYBELSUS: "SEMAGLUTIDE",
  VICTOZA: "LIRAGLUTIDE",
  TRULICITY: "DULAGLUTIDE",
  MOUNJARO: "TIRZEPATIDE",
  ACTOS: "PIOGLITAZONE",
  AVANDIA: "ROSIGLITAZONE",
  AMARYL: "GLIMEPIRIDE",
  GLUCOTROL: "GLIPIZIDE",
  DIABETA: "GLYBURIDE",
  GLIBENCLAMIDE: "GLYBURIDE",
  LANTUS: "INSULIN GLARGINE",
  HUMALOG: "INSULIN LISPRO",
  NOVOLOG: "INSULIN ASPART",

  // Cardiovascular & Antihypertensives
  PRINIVIL: "LISINOPRIL",
  ZESTRIL: "LISINOPRIL",
  VASOTEC: "ENALAPRIL",
  ALTACE: "RAMIPRIL",
  ACCUPRIL: "QUINAPRIL",
  LOTENSIN: "BENAZEPRIL",
  CAPOTEN: "CAPTOPRIL",
  COZAAR: "LOSARTAN",
  DIOVAN: "VALSARTAN",
  AVAPRO: "IRBESARTAN",
  ATACAND: "CANDESARTAN",
  MICARDIS: "TELMISARTAN",
  BENICAR: "OLMESARTAN",
  LOPRESSOR: "METOPROLOL",
  TOPROL: "METOPROLOL",
  "TOPROL XL": "METOPROLOL",
  TENORMIN: "ATENOLOL",
  COREG: "CARVEDILOL",
  INDERAL: "PROPRANOLOL",
  ZEBETA: "BISOPROLOL",
  CARDIZEM: "DILTIAZEM",
  CALAN: "VERAPAMIL",
  PROCARDIA: "NIFEDIPINE",
  ADALAT: "NIFEDIPINE",
  LASIX: "FUROSEMIDE",
  FRUSEMIDE: "FUROSEMIDE",
  BUMEX: "BUMETANIDE",
  DEMADEX: "TORSEMIDE",
  ALDACTONE: "SPIRONOLACTONE",
  MICROZIDE: "HYDROCHLOROTHIAZIDE",
  HCTZ: "HYDROCHLOROTHIAZIDE",
  LANOXIN: "DIGOXIN",
  CORDARONE: "AMIODARONE",
  PACERONE: "AMIODARONE",
  ENTRESTO: "SACUBITRIL/VALSARTAN",

  // Antibiotics, Antivirals & Antifungals
  AUGMENTIN: "AMOXICILLIN/CLAVULANATE",
  ZITHROMAX: "AZITHROMYCIN",
  BIAXIN: "CLARITHROMYCIN",
  CIPRO: "CIPROFLOXACIN",
  LEVAQUIN: "LEVOFLOXACIN",
  AVELOX: "MOXIFLOXACIN",
  BACTRIM: "TRIMETHOPRIM/SULFAMETHOXAZOLE",
  SEPTRA: "TRIMETHOPRIM/SULFAMETHOXAZOLE",
  "CO-TRIMOXAZOLE": "TRIMETHOPRIM/SULFAMETHOXAZOLE",
  CLEOCIN: "CLINDAMYCIN",
  FLAGYL: "METRONIDAZOLE",
  VIBRAMYCIN: "DOXYCYCLINE",
  KEFLEX: "CEPHALEXIN",
  ROCEPHIN: "CEFTRIAXONE",
  VANCOCIN: "VANCOMYCIN",
  ZYVOX: "LINEZOLID",
  MACROBID: "NITROFURANTOIN",
  MACRODANTIN: "NITROFURANTOIN",
  DIFLUCAN: "FLUCONAZOLE",
  VALTREX: "VALACYCLOVIR",
  VALACICLOVIR: "VALACYCLOVIR",
  ZOVIRAX: "ACYCLOVIR",
  ACICLOVIR: "ACYCLOVIR",
  TAMIFLU: "OSELTAMIVIR",
  PAXLOVID: "NIRMATRELVIR/RITONAVIR",
  RIFAMPICIN: "RIFAMPIN",
  RIFADIN: "RIFAMPIN",

  // Analgesics, NSAIDs & Rheumatology
  ADVIL: "IBUPROFEN",
  MOTRIN: "IBUPROFEN",
  NUROFEN: "IBUPROFEN",
  ALEVE: "NAPROXEN",
  NAPROSYN: "NAPROXEN",
  CELEBREX: "CELECOXIB",
  VOLTAREN: "DICLOFENAC",
  MOBIC: "MELOXICAM",
  TORADOL: "KETOROLAC",
  INDOCIN: "INDOMETHACIN",
  TYLENOL: "ACETAMINOPHEN",
  PANADOL: "ACETAMINOPHEN",
  PARACETAMOL: "ACETAMINOPHEN",
  APAP: "ACETAMINOPHEN",
  ULTRAM: "TRAMADOL",
  OXYCONTIN: "OXYCODONE",
  ROXICODONE: "OXYCODONE",
  MSCONTIN: "MORPHINE",
  DURAGESIC: "FENTANYL",
  SUBOXONE: "BUPRENORPHINE/NALOXONE",
  ZYLOPRIM: "ALLOPURINOL",
  ULORIC: "FEBUXOSTAT",
  COLCRYS: "COLCHICINE",

  // GI & Proton Pump Inhibitors
  NEXIUM: "ESOMEPRAZOLE",
  PROTONIX: "PANTOPRAZOLE",
  PREVACID: "LANSOPRAZOLE",
  ACIPHEX: "RABEPRAZOLE",
  DEXILANT: "DEXLANSOPRAZOLE",
  PEPCID: "FAMOTIDINE",
  ZANTAC: "RANITIDINE",
  ZOFRAN: "ONDANSETRON",
  REGLAN: "METOCLOPRAMIDE",
  IMODIUM: "LOPERAMIDE",

  // Corticosteroids, Immunosuppressants & Biologics
  DELTASONE: "PREDNISONE",
  RAYOS: "PREDNISONE",
  MEDROL: "METHYLPREDNISOLONE",
  "SOLU-MEDROL": "METHYLPREDNISOLONE",
  DECADRON: "DEXAMETHASONE",
  CORTEF: "HYDROCORTISONE",
  CELLCEPT: "MYCOPHENOLATE MOFETIL",
  PROGRAF: "TACROLIMUS",
  NEORAL: "CYCLOSPORINE",
  SANDIMMUNE: "CYCLOSPORINE",
  CICLOSPORIN: "CYCLOSPORINE",
  IMURAN: "AZATHIOPRINE",
  TREXALL: "METHOTREXATE",
  RHEUMATREX: "METHOTREXATE",
  PLAQUENIL: "HYDROXYCHLOROQUINE",
  HUMIRA: "ADALIMUMAB",
  ENBREL: "ETANERCEPT",
  REMICADE: "INFLIXIMAB",
  RITUXAN: "RITUXIMAB",
  KEYTRUDA: "PEMBROLIZUMAB",
  OPDIVO: "NIVOLUMAB",

  // CNS, Antiepileptics & Psychotropics
  NEURONTIN: "GABAPENTIN",
  LYRICA: "PREGABALIN",
  KEPPRA: "LEVETIRACETAM",
  LAMICTAL: "LAMOTRIGINE",
  DILANTIN: "PHENYTOIN",
  TEGRETOL: "CARBAMAZEPINE",
  DEPAKOTE: "VALPROATE",
  DEPAKENE: "VALPROATE",
  "VALPROIC ACID": "VALPROATE",
  DIVALPROEX: "VALPROATE",
  TOPAMAX: "TOPIRAMATE",
  ZOLOFT: "SERTRALINE",
  PROZAC: "FLUOXETINE",
  LEXAPRO: "ESCITALOPRAM",
  CELEXA: "CITALOPRAM",
  PAXIL: "PAROXETINE",
  CYMBALTA: "DULOXETINE",
  EFFEXOR: "VENLAFAXINE",
  WELLBUTRIN: "BUPROPION",
  REMERON: "MIRTAZAPINE",
  DESYREL: "TRAZODONE",
  XANAX: "ALPRAZOLAM",
  ATIVAN: "LORAZEPAM",
  VALIUM: "DIAZEPAM",
  KLONOPIN: "CLONAZEPAM",
  AMBIEN: "ZOLPIDEM",
  SEROQUEL: "QUETIAPINE",
  ZYPREXA: "OLANZAPINE",
  RISPERDAL: "RISPERIDONE",
  ABILIFY: "ARIPIPRAZOLE",
  CLOZARIL: "CLOZAPINE",
  HALDOL: "HALOPERIDOL",
  ESKALITH: "LITHIUM",
  LITHOBID: "LITHIUM",

  // Endocrine, Respiratory & Allergy
  SYNTHROID: "LEVOTHYROXINE",
  LEVOTHROID: "LEVOTHYROXINE",
  ELTROXIN: "LEVOTHYROXINE",
  VENTOLIN: "ALBUTEROL",
  PROAIR: "ALBUTEROL",
  SALBUTAMOL: "ALBUTEROL",
  SPIRIVA: "TIOTROPIUM",
  SINGULAIR: "MONTELUKAST",
  ADVAIR: "FLUTICASONE/SALMETEROL",
  SYMBICORT: "BUDESONIDE/FORMOTEROL",
  FLONASE: "FLUTICASONE",
  ZYRTEC: "CETIRIZINE",
  CLARITIN: "LORATADINE",
  ALLEGRA: "FEXOFENADINE",
  BENADRYL: "DIPHENHYDRAMINE",
  EPIPEN: "EPINEPHRINE",
  ADRENALINE: "EPINEPHRINE",
};

export const CANONICAL_GENERICS: Set<string> = new Set([
  ...Object.values(DRUG_ALIAS_TO_CANONICAL),
  "WARFARIN",
  "CLOPIDOGREL",
  "ATORVASTATIN",
  "SIMVASTATIN",
  "METFORMIN",
  "OMEPRAZOLE",
  "AMOXICILLIN",
  "AMLODIPINE",
  "IBUPROFEN",
  "LISINOPRIL",
  "PREDNISONE",
  "ASPIRIN",
  "ACETAMINOPHEN",
  "APIXABAN",
  "RIVAROXABAN",
  "DABIGATRAN",
  "ROSUVASTATIN",
  "PRAVASTATIN",
  "EMPAGLIFLOZIN",
  "SEMAGLUTIDE",
  "LOSARTAN",
  "VALSARTAN",
  "METOPROLOL",
  "FUROSEMIDE",
  "SPIRONOLACTONE",
  "HYDROCHLOROTHIAZIDE",
  "DIGOXIN",
  "AMIODARONE",
  "AZITHROMYCIN",
  "CIPROFLOXACIN",
  "LEVOFLOXACIN",
  "DOXYCYCLINE",
  "VANCOMYCIN",
  "FLUCONAZOLE",
  "ACYCLOVIR",
  "VALACYCLOVIR",
  "NAPROXEN",
  "CELECOXIB",
  "DICLOFENAC",
  "TRAMADOL",
  "OXYCODONE",
  "MORPHINE",
  "FENTANYL",
  "ALLOPURINOL",
  "COLCHICINE",
  "PANTOPRAZOLE",
  "ESOMEPRAZOLE",
  "FAMOTIDINE",
  "ONDANSETRON",
  "METHYLPREDNISOLONE",
  "DEXAMETHASONE",
  "METHOTREXATE",
  "HYDROXYCHLOROQUINE",
  "TACROLIMUS",
  "CYCLOSPORINE",
  "GABAPENTIN",
  "PREGABALIN",
  "LEVETIRACETAM",
  "LAMOTRIGINE",
  "PHENYTOIN",
  "CARBAMAZEPINE",
  "VALPROATE",
  "SERTRALINE",
  "FLUOXETINE",
  "ESCITALOPRAM",
  "CITALOPRAM",
  "DULOXETINE",
  "VENLAFAXINE",
  "BUPROPION",
  "QUETIAPINE",
  "OLANZAPINE",
  "RISPERIDONE",
  "CLOZAPINE",
  "LITHIUM",
  "LEVOTHYROXINE",
  "ALBUTEROL",
  "MONTELUKAST",
  "CETIRIZINE",
  "DIPHENHYDRAMINE",
  "EPINEPHRINE",
]);

const SUFFIXES = [
  "EXTENDED RELEASE",
  "DELAYED RELEASE",
  "SUSTAINED RELEASE",
  "HYDROCHLORIDE",
  "HYDROBROMIDE",
  "MONOHYDRATE",
  "DIHYDRATE",
  "POTASSIUM",
  "PHOSPHATE",
  "SUCCINATE",
  "TARTRATE",
  "MESYLATE",
  "BESYLATE",
  "MALEATE",
  "FUMARATE",
  "ACETATE",
  "CALCIUM",
  "SODIUM",
  "SULFATE",
  "CITRATE",
  "CAPSULES",
  "CAPSULE",
  "TABLETS",
  "TABLET",
  "INJECTION",
  "SOLUTION",
  "HCL",
].sort((a, b) => b.length - a.length);

export function stripDrugSuffixes(name: string): string {
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
  return cleaned;
}

export function canonicalizeDrug(name: string): string {
  const cleaned = stripDrugSuffixes(name);
  return DRUG_ALIAS_TO_CANONICAL[cleaned] ?? cleaned;
}

export function isKnownDrugTerm(name: string): boolean {
  const cleaned = stripDrugSuffixes(name);
  return (
    Object.prototype.hasOwnProperty.call(DRUG_ALIAS_TO_CANONICAL, cleaned) ||
    CANONICAL_GENERICS.has(cleaned)
  );
}

export function normalizePt(term: string): string {
  return term.trim().toUpperCase().replace(/\s+/g, " ");
}

export type RxNavLookupResult = {
  query: string;
  rxcui: string | null;
  canonicalName: string | null;
};

/**
 * Optional public NLM RxNav lookup for unknown drug names.
 * Requires explicit user consent before sending drug tokens to rxnav.nlm.nih.gov.
 */
export async function lookupRxNormOnline(
  drugName: string,
  consentGranted: boolean,
): Promise<RxNavLookupResult> {
  if (!consentGranted) {
    throw new Error("Explicit external-service consent is required before calling RxNav.");
  }
  const q = stripDrugSuffixes(drugName);
  if (!q) return { query: drugName, rxcui: null, canonicalName: null };

  const approxUrl = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(q)}&search=2`;
  const resp = await fetch(approxUrl);
  if (!resp.ok) return { query: q, rxcui: null, canonicalName: null };
  const data = (await resp.json()) as { idGroup?: { rxnormId?: string[] } };
  const rxcui = data?.idGroup?.rxnormId?.[0] ?? null;
  if (!rxcui) return { query: q, rxcui: null, canonicalName: null };

  const relUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=IN`;
  const relResp = await fetch(relUrl);
  if (relResp.ok) {
    const relData = (await relResp.json()) as {
      relatedGroup?: {
        conceptGroup?: { conceptProperties?: { rxcui?: string; name?: string }[] }[];
      };
    };
    const prop = relData?.relatedGroup?.conceptGroup?.[0]?.conceptProperties?.[0];
    if (prop?.name) {
      return {
        query: q,
        rxcui: prop.rxcui ?? rxcui,
        canonicalName: prop.name.trim().toUpperCase(),
      };
    }
  }

  const propUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/properties.json`;
  const propResp = await fetch(propUrl);
  if (propResp.ok) {
    const propData = (await propResp.json()) as {
      properties?: { name?: string };
    };
    if (propData?.properties?.name) {
      return {
        query: q,
        rxcui,
        canonicalName: propData.properties.name.trim().toUpperCase(),
      };
    }
  }

  return { query: q, rxcui, canonicalName: canonicalizeDrug(q) };
}
