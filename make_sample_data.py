"""
Generates small synthetic datasets that mimic the FDA FAERS file schema
(DEMO / DRUG / REAC tables joined on primaryid) so the pipeline can be
tested without downloading the real (multi-GB) FAERS quarterly files.

Real FAERS ASCII data: https://www.fda.gov/drugs/questions-and-answers-fdas-adverse-event-reporting-system-faers/fda-adverse-event-reporting-system-faers-latest-quarterly-data-files
Files are pipe-delimited ($ in older quarters), named e.g. DEMO24Q1.txt,
DRUG24Q1.txt, REAC24Q1.txt. Column names match what's used below.

Some rows intentionally use brand names (COUMADIN, LIPITOR, …) so the
RxNorm-style alias map in drug_mapping.py is demonstrable end-to-end.
"""
import os
import random

import numpy as np
import pandas as pd

N_CASES = 200

# Canonical generics used for signal baking
drugs = [
    "IBUPROFEN", "ATORVASTATIN", "METFORMIN", "LISINOPRIL", "OMEPRAZOLE",
    "WARFARIN", "SIMVASTATIN", "AMOXICILLIN", "CLOPIDOGREL", "PREDNISONE",
]

# When emitting DRUG rows, sometimes write a brand alias instead of the generic
BRAND_EMIT = {
    "WARFARIN": ["WARFARIN", "COUMADIN", "COUMADIN"],
    "ATORVASTATIN": ["ATORVASTATIN", "LIPITOR", "LIPITOR"],
    "METFORMIN": ["METFORMIN", "GLUCOPHAGE"],
    "OMEPRAZOLE": ["OMEPRAZOLE", "PRILOSEC", "LOSEC"],
    "CLOPIDOGREL": ["CLOPIDOGREL", "PLAVIX"],
    "SIMVASTATIN": ["SIMVASTATIN", "ZOCOR"],
    "AMOXICILLIN": ["AMOXICILLIN", "AMOXIL"],
}

reactions = [
    "NAUSEA", "HEADACHE", "RASH", "DIZZINESS", "FATIGUE", "VOMITING",
    "MYALGIA", "PRURITUS", "DYSPNOEA", "GASTROINTESTINAL HAEMORRHAGE",
    "ANGIOEDEMA", "ANAPHYLACTIC REACTION", "HEPATIC FAILURE", "RHABDOMYOLYSIS",
]

# Bake in a few "true" signals so PRR/ROR has something real to detect
# (keys are canonical generics — brands collapse via normalize_drug_name)
boosted_pairs = {
    ("WARFARIN", "GASTROINTESTINAL HAEMORRHAGE"): 0.35,
    ("CLOPIDOGREL", "GASTROINTESTINAL HAEMORRHAGE"): 0.30,
    ("SIMVASTATIN", "RHABDOMYOLYSIS"): 0.25,
    ("AMOXICILLIN", "ANAPHYLACTIC REACTION"): 0.20,
    ("PREDNISONE", "HEPATIC FAILURE"): 0.15,
}


def _emit_drug_name(canonical: str) -> str:
    choices = BRAND_EMIT.get(canonical, [canonical])
    return random.choice(choices)


def generate_sample_dataframes(n_cases: int = N_CASES, seed: int = 42):
    """Return (demo, drug, reac) DataFrames with deterministic synthetic FAERS data."""
    random.seed(seed)
    np.random.seed(seed)

    demo_rows, drug_rows, reac_rows = [], [], []

    for case_id in range(1, n_cases + 1):
        primaryid = 100000 + case_id
        age = np.random.randint(18, 90)
        sex = random.choice(["M", "F"])
        event_dt = f"2024{random.randint(1, 4):02d}{random.randint(1, 28):02d}"
        demo_rows.append({
            "primaryid": primaryid, "caseid": case_id, "age": age,
            "sex": sex, "event_dt": event_dt,
            "occr_country": "US",
        })

        case_drugs = random.sample(drugs, k=random.randint(1, 2))
        for d in case_drugs:
            drug_rows.append({
                "primaryid": primaryid, "caseid": case_id,
                "drugname": _emit_drug_name(d), "role_cod": "PS",
            })

        n_reac = random.randint(1, 3)
        case_reactions = set(random.sample(reactions, k=n_reac))

        for d in case_drugs:
            for (bd, br), p in boosted_pairs.items():
                if d == bd and random.random() < p:
                    case_reactions.add(br)

        for r in case_reactions:
            reac_rows.append({"primaryid": primaryid, "caseid": case_id, "pt": r})

    return pd.DataFrame(demo_rows), pd.DataFrame(drug_rows), pd.DataFrame(reac_rows)


SAMPLE_INDICATIONS = {
    "IBUPROFEN": "PAIN", "ATORVASTATIN": "HYPERCHOLESTEROLAEMIA", "METFORMIN": "TYPE 2 DIABETES MELLITUS",
    "LISINOPRIL": "HYPERTENSION", "OMEPRAZOLE": "GASTROOESOPHAGEAL REFLUX DISEASE",
    "WARFARIN": "ATRIAL FIBRILLATION", "SIMVASTATIN": "HYPERCHOLESTEROLAEMIA",
    "AMOXICILLIN": "INFECTION", "CLOPIDOGREL": "MYOCARDIAL INFARCTION", "PREDNISONE": "RHEUMATOID ARTHRITIS",
}
SAMPLE_SERIOUS_PTS = {
    "GASTROINTESTINAL HAEMORRHAGE", "ANAPHYLACTIC REACTION", "HEPATIC FAILURE", "RHABDOMYOLYSIS", "ANGIOEDEMA",
}


def add_optional_tables(demo: pd.DataFrame, drug: pd.DataFrame, reac: pd.DataFrame, seed: int = 1234):
    """
    Extend the sample with the optional FAERS fields the ML case features read:
    DEMO.occp_cod, DRUG.drug_seq, and OUTC / INDI / THER tables.

    Uses its own random stream so the original DEMO / DRUG / REAC values are
    unchanged.  Outcome codes depend only on how serious the reported terms are;
    reporter type, indication and therapy start are independent of the planted
    signals.  Returns (demo, drug, outc, indi, ther).
    """
    from datetime import datetime, timedelta

    from drug_mapping import canonicalize_drug

    rng = random.Random(seed)
    demo = demo.copy()
    drug = drug.copy()
    demo["occp_cod"] = [rng.choices(["MD", "HP", "PH", "CN"], weights=[35, 15, 10, 40])[0] for _ in range(len(demo))]
    drug["drug_seq"] = drug.groupby("primaryid").cumcount() + 1

    serious_cases = set(reac.loc[reac["pt"].isin(SAMPLE_SERIOUS_PTS), "primaryid"])
    event_dt = dict(zip(demo["primaryid"], demo["event_dt"].astype(str)))
    outc_rows, indi_rows, ther_rows = [], [], []
    for primaryid, caseid in zip(demo["primaryid"], demo["caseid"]):
        chances = (("HO", 0.60), ("LT", 0.25), ("DE", 0.08)) if primaryid in serious_cases else (("HO", 0.08), ("OT", 0.20))
        for code, p in chances:
            if rng.random() < p:
                outc_rows.append({"primaryid": primaryid, "caseid": caseid, "outc_cod": code})
    for row in drug.itertuples(index=False):
        indication = SAMPLE_INDICATIONS.get(canonicalize_drug(row.drugname), "PRODUCT USED FOR UNKNOWN INDICATION")
        indi_rows.append({
            "primaryid": row.primaryid, "caseid": row.caseid,
            "indi_drug_seq": row.drug_seq, "indi_pt": indication,
        })
        if rng.random() < 0.7:
            event = datetime.strptime(event_dt[row.primaryid], "%Y%m%d")
            start = event - timedelta(days=int(min(rng.lognormvariate(3.0, 1.1), 2000)))
            ther_rows.append({
                "primaryid": row.primaryid, "caseid": row.caseid,
                "dsg_drug_seq": row.drug_seq, "start_dt": start.strftime("%Y%m%d"),
            })
    return demo, drug, pd.DataFrame(outc_rows), pd.DataFrame(indi_rows), pd.DataFrame(ther_rows)


def main():
    """
    Add the optional tables to the committed sample.

    The committed DEMO / DRUG / REAC sample is read back rather than regenerated,
    because ``generate_sample_dataframes`` does not reproduce it byte for byte on
    every Python / NumPy version and the parity fixture depends on its values.
    Pass ``--regenerate`` to rebuild all six files from scratch.
    """
    import sys

    base = os.path.join("sample_data", "DEMO_sample.csv")
    if "--regenerate" in sys.argv or not os.path.isfile(base):
        demo, drug, reac = generate_sample_dataframes()
    else:
        demo = pd.read_csv(os.path.join("sample_data", "DEMO_sample.csv"))
        drug = pd.read_csv(os.path.join("sample_data", "DRUG_sample.csv"))
        reac = pd.read_csv(os.path.join("sample_data", "REAC_sample.csv"))
        demo = demo.drop(columns=[c for c in ("occp_cod",) if c in demo.columns])
        drug = drug.drop(columns=[c for c in ("drug_seq",) if c in drug.columns])
    demo, drug, outc, indi, ther = add_optional_tables(demo, drug, reac)
    for folder in ("sample_data", os.path.join("web", "public", "sample")):
        os.makedirs(folder, exist_ok=True)
        for name, frame in (("DEMO", demo), ("DRUG", drug), ("REAC", reac), ("OUTC", outc), ("INDI", indi), ("THER", ther)):
            frame.to_csv(os.path.join(folder, f"{name}_sample.csv"), index=False)
    print(f"DEMO: {len(demo)} rows | DRUG: {len(drug)} rows | REAC: {len(reac)} rows")
    print(f"OUTC: {len(outc)} rows | INDI: {len(indi)} rows | THER: {len(ther)} rows")
    print("Written to sample_data/ and web/public/sample/")


if __name__ == "__main__":
    main()
