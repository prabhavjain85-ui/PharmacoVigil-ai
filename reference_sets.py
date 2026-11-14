"""
Published reference sets used as ground truth for ML prioritisation.

Labels come from the OMOP (Ryan et al. 2013) and EU-ADR (Coloma et al. 2013)
reference sets: drug-outcome pairs classified as positive controls (the drug
is believed to cause the outcome) or negative controls (believed not to).
Pairs outside the reference sets are *unlabelled* and are never used as
negatives.

Outcomes in the reference sets are health outcomes of interest (HOI) such as
"acute liver injury", not single MedDRA preferred terms.  ``outcome_pt_map.json``
lists the PTs that are folded into each HOI.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import pandas as pd

from drug_mapping import canonicalize_drug

REFERENCE_DIR = Path(__file__).resolve().parent / "reference_data"
HOI_PREFIX = "HOI: "

REFERENCE_FILES = {
    "OMOP": "omop_reference_set.csv",
    "EU-ADR": "euadr_reference_set.csv",
}

# FAERS ingredient spelling -> reference-set ingredient (both canonical upper case).
# Covers the reference drugs whose FAERS name differs from the RxNorm name used by
# the reference sets. Partial by design; extend as you find unmatched controls
# in the coverage report printed by train_prioritizer.py.
FAERS_TO_REFERENCE_DRUG: dict[str, str] = {
    "PARACETAMOL": "ACETAMINOPHEN",
    "ACICLOVIR": "ACYCLOVIR",
    "VALACICLOVIR": "VALACYCLOVIR",
    "ACETYLSALICYLIC ACID": "ASPIRIN",
    "CICLOSPORIN": "CYCLOSPORINE",
    "VALPROIC ACID": "VALPROATE",
    "VALPROATE SEMISODIUM": "VALPROATE",
    "DIVALPROEX": "VALPROATE",
    "LEVOTHYROXINE": "THYROXINE",
    "RIFAMPICIN": "RIFAMPIN",
    "MEFENAMIC ACID": "MEFENAMATE",
    "OLMESARTAN": "OLMESARTAN MEDOXOMIL",
    "LITHIUM": "LITHIUM CARBONATE",
    "TENOFOVIR DISOPROXIL FUMARATE": "TENOFOVIR",
    "TENOFOVIR DISOPROXIL": "TENOFOVIR",
    "DRONABINOL": "TETRAHYDROCANNABINOL",
    "GLYCERYL TRINITRATE": "NITROGLYCERIN",
    "ISOSORBIDE MONONITRATE": "ISOSORBIDE",
    "ISOSORBIDE DINITRATE": "ISOSORBIDE",
    "INSULIN HUMAN": "REGULAR INSULIN, HUMAN",
    "ESTROGENS, CONJUGATED": "ESTROGENS, CONJUGATED (USP)",
    "PENICILLIN V POTASSIUM": "PENICILLIN V",
    "PHENOXYMETHYLPENICILLIN": "PENICILLIN V",
    "FLUTICASONE PROPIONATE": "FLUTICASONE",
    "FLUTICASONE FUROATE": "FLUTICASONE",
    "MOMETASONE FUROATE": "MOMETASONE",
    "SALMETEROL XINAFOATE": "SALMETEROL",
    "FORMOTEROL FUMARATE": "FORMOTEROL",
    "TIOTROPIUM BROMIDE": "TIOTROPIUM",
    "IPRATROPIUM BROMIDE": "IPRATROPIUM",
    "CANDESARTAN CILEXETIL": "CANDESARTAN",
    "ABACAVIR SULFATE": "ABACAVIR",
    "CLORAZEPATE": "CHLORAZEPATE",
    "CLORAZEPATE DIPOTASSIUM": "CHLORAZEPATE",
    "CLORAZEPATE MONOPOTASSIUM": "CHLORAZEPATE",
    "PANCRELIPASE": "LIPASE",
    "PANCRELIPASE LIPASE": "LIPASE",
    "PANCRELIPASE AMYLASE": "AMYLASES",
    "PANCRELIPASE PROTEASE": "ENDOPEPTIDASES",
    "EPOETIN ALFA-EPBX": "EPOETIN ALFA",
    "ESCITALOPRAM OXALATE": "ESCITALOPRAM",
    "KETOROLAC TROMETHAMINE": "KETOROLAC",
    "COAGULATION FACTOR VIIA RECOMBINANT HUMAN": "FACTOR VIIA",
    "COAGULATION FACTOR VIIA RECOMBINANT HUMAN-JNCW": "FACTOR VIIA",
    "COAGULATION FACTOR VIIA": "FACTOR VIIA",
    "EPTACOG ALFA": "FACTOR VIIA",
    "EPTACOG ALFA (ACTIVATED)": "FACTOR VIIA",
    "SULFISOXAZOLE ACETYL": "SULFISOXAZOLE",
    "ALMOTRIPTAN MALATE": "ALMOTRIPTAN",
    "AMLODIPINE BENZOATE": "AMLODIPINE",
    "ATORVASTATIN CALCIUM TRIHYDRATE": "ATORVASTATIN",
    "CIPROFLOXACIN LACTATE": "CIPROFLOXACIN",
    "CLINDAMYCIN PALMITATE": "CLINDAMYCIN",
    "CLOPIDOGREL BESILATE": "CLOPIDOGREL",
    "CLOPIDOGREL BISULFATE": "CLOPIDOGREL",
    "COSYNTROPIN HEXAACETATE": "COSYNTROPIN",
    "DARUNAVIR ETHANOLATE": "DARUNAVIR",
    "DICLOFENAC DIETHYLAMINE": "DICLOFENAC",
    "DICLOFENAC EPOLAMINE": "DICLOFENAC",
    "ERYTHROMYCIN ESTOLATE": "ERYTHROMYCIN",
    "ERYTHROMYCIN ETHYLSUCCINATE": "ERYTHROMYCIN",
    "ERYTHROMYCIN LACTOBIONATE": "ERYTHROMYCIN",
    "ERYTHROMYCIN PROPIONATE": "ERYTHROMYCIN",
    "ERYTHROMYCIN STEARATE": "ERYTHROMYCIN",
    "ESTRADIOL BENZOATE": "ESTRADIOL",
    "ESTRADIOL CYPIONATE": "ESTRADIOL",
    "ESTRADIOL HEMIHYDRATE": "ESTRADIOL",
    "ESTRADIOL VALERATE": "ESTRADIOL",
    "FERROUS SULFATE ANHYDROUS": "FERROUS",
    "FLURBIPROFEN AXETIL": "FLURBIPROFEN",
    "IBUPROFEN ARGININE": "IBUPROFEN",
    "IBUPROFEN LYSINE": "IBUPROFEN",
    "IMIPRAMINE PAMOATE": "IMIPRAMINE",
    "IPRATROPIUM BROMIDE ANHYDROUS": "IPRATROPIUM",
    "KETOPROFEN LYSINE": "KETOPROFEN",
    "METHENAMINE HIPPURATE": "METHENAMINE",
    "METHENAMINE MANDELATE": "METHENAMINE",
    "MICONAZOLE NITRATE": "MICONAZOLE",
    "NEOSTIGMINE BROMIDE": "NEOSTIGMINE",
    "NEOSTIGMINE METHYLSULFATE": "NEOSTIGMINE",
    "OXAZEPAM HEMISUCCINATE": "OXAZEPAM",
    "OXYBUTYNIN CHLORIDE": "OXYBUTYNIN",
    "PENICILLIN V BENZATHINE": "PENICILLIN V",
    "PIROXICAM BETADEX": "PIROXICAM",
    "PROCHLORPERAZINE DIMETHANESULFONATE": "PROCHLORPERAZINE",
    "PROCHLORPERAZINE EDISYLATE": "PROCHLORPERAZINE",
    "PROPANTHELINE BROMIDE": "PROPANTHELINE",
    "RIZATRIPTAN BENZOATE": "RIZATRIPTAN",
    "ROSUVASTATIN ZINC": "ROSUVASTATIN",
    "SUMATRIPTAN HEMISULFATE": "SUMATRIPTAN",
    "TENOFOVIR ALAFENAMIDE": "TENOFOVIR",
    "THIOGUANINE ANHYDROUS": "THIOGUANINE",
    "VALPROATE MAGNESIUM": "VALPROATE",
    "VITAMIN A PALMITATE": "VITAMIN A",
}


def reference_drug_name(name: str) -> str:
    """Canonical drug name on the reference-set vocabulary."""
    canonical = canonicalize_drug(name)
    return FAERS_TO_REFERENCE_DRUG.get(canonical, canonical)


@lru_cache(maxsize=1)
def load_outcome_map() -> dict[str, dict]:
    """HOI name -> {"reference_names": [...], "pts": [...]}."""
    raw = json.loads((REFERENCE_DIR / "outcome_pt_map.json").read_text(encoding="utf-8"))
    return raw["outcomes"]


@lru_cache(maxsize=1)
def pt_to_hoi() -> dict[str, str]:
    """MedDRA PT (upper case) -> prefixed HOI event label."""
    mapping: dict[str, str] = {}
    for hoi, spec in load_outcome_map().items():
        for pt in spec["pts"]:
            mapping[" ".join(pt.upper().split())] = HOI_PREFIX + hoi
    return mapping


def map_event_to_hoi(pt: str) -> str:
    """Fold a PT into its HOI label; PTs outside every HOI are returned unchanged."""
    key = " ".join(str(pt).strip().upper().split())
    return pt_to_hoi().get(key, key)


@lru_cache(maxsize=1)
def load_reference_controls() -> pd.DataFrame:
    """
    One row per labelled drug-outcome control.

    Columns: ``drug`` (canonical), ``adverse_event`` (HOI label), ``label`` (1/0),
    ``source``, ``indication``. A control listed in both sets is kept once; controls
    whose label differs between the two sets are dropped.
    """
    name_to_hoi = {
        ref_name: HOI_PREFIX + hoi
        for hoi, spec in load_outcome_map().items()
        for ref_name in spec["reference_names"]
    }
    frames = []
    for source, filename in REFERENCE_FILES.items():
        frame = pd.read_csv(REFERENCE_DIR / filename)
        unknown = set(frame["outcome_name"]) - set(name_to_hoi)
        if unknown:
            raise ValueError(f"{filename}: outcomes missing from outcome_pt_map.json: {sorted(unknown)}")
        frames.append(pd.DataFrame({
            "drug": frame["exposure_name"].map(reference_drug_name),
            "adverse_event": frame["outcome_name"].map(name_to_hoi),
            "label": frame["ground_truth"].astype(int),
            "source": source,
            "indication": frame["indication_name"],
        }))
    controls = pd.concat(frames, ignore_index=True)
    key = ["drug", "adverse_event"]
    conflicting = controls.groupby(key)["label"].transform("nunique") > 1
    controls = controls[~conflicting]
    merged_source = controls.groupby(key)["source"].transform(lambda s: " + ".join(sorted(set(s))))
    controls = controls.assign(source=merged_source).drop_duplicates(subset=key)
    return controls.reset_index(drop=True)
