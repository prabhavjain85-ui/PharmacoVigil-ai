"""
Synthetic FAERS-shaped benchmark for exercising ``train_prioritizer.py``.

Writes ``$``-delimited DEMO / DRUG / REAC / OUTC / INDI / THER files that use
the reference-set drugs.  Positive controls get an elevated reporting rate for
their outcome; negative controls do not, except for a minority that are given
a mild spurious elevation so the task is not trivial.

Only the reporting *rate* depends on the ground truth.  Outcome codes, reporter
type, age, sex, onset time and indications are drawn independently of it, so a
model trained on this data cannot learn anything real about those features.
It exists to test the pipeline end to end and to produce placeholder weights;
it says nothing about performance on real reports.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from reference_sets import HOI_PREFIX, load_outcome_map, load_reference_controls

BACKGROUND_PTS = [
    "NAUSEA", "HEADACHE", "FATIGUE", "DIZZINESS", "DIARRHOEA", "VOMITING", "RASH", "PRURITUS",
    "DYSPNOEA", "PAIN", "ARTHRALGIA", "INSOMNIA", "ANXIETY", "COUGH", "PYREXIA", "ASTHENIA",
    "DRUG INEFFECTIVE", "OFF LABEL USE", "MALAISE", "WEIGHT DECREASED", "CONSTIPATION",
    "ABDOMINAL PAIN", "BACK PAIN", "FALL", "HYPERTENSION", "HYPOTENSION", "MYALGIA", "TREMOR",
    "DEPRESSION", "SOMNOLENCE", "OEDEMA PERIPHERAL", "PNEUMONIA", "URINARY TRACT INFECTION",
    "ALOPECIA", "DECREASED APPETITE", "PALPITATIONS", "PARAESTHESIA", "CONFUSIONAL STATE",
]


def generate(n_cases: int = 60_000, seed: int = 7) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    controls = load_reference_controls()
    outcomes = load_outcome_map()
    hois = list(outcomes)

    ref_drugs = sorted(controls["drug"].unique())
    filler = [f"BACKGROUND DRUG {i:02d}" for i in range(1, 61)]
    drugs = ref_drugs + filler
    popularity = rng.lognormal(0.0, 0.9, len(drugs))
    popularity /= popularity.sum()
    indication = (
        controls.dropna(subset=["indication"]).drop_duplicates("drug")
        .set_index("drug")["indication"].str.upper().to_dict()
    )

    base_rate = {h: float(rng.uniform(0.006, 0.03)) for h in hois}
    rr: dict[tuple[str, str], float] = {}
    for row in controls.itertuples(index=False):
        hoi = row.adverse_event[len(HOI_PREFIX):]
        if row.label == 1:
            value = float(np.clip(rng.lognormal(1.0, 0.6), 1.1, 12.0))
        elif rng.random() < 0.2:
            value = float(rng.uniform(1.3, 2.2))
        else:
            value = float(rng.lognormal(0.0, 0.15))
        rr[(row.drug, hoi)] = value

    start_day = date(2023, 1, 1)
    demo, drug, reac, outc, indi, ther = [], [], [], [], [], []
    for case in range(1, n_cases + 1):
        caseid = 20_000_000 + case
        versions = [1, 2] if rng.random() < 0.03 else [1]
        n_suspect = int(rng.choice([1, 2, 3], p=[0.70, 0.22, 0.08]))
        n_concomitant = int(rng.choice([0, 1, 2, 3], p=[0.45, 0.30, 0.15, 0.10]))
        chosen = rng.choice(len(drugs), size=n_suspect + n_concomitant, replace=False, p=popularity)
        suspects = [drugs[i] for i in chosen[:n_suspect]]
        concomitants = [drugs[i] for i in chosen[n_suspect:]]

        pts = set(rng.choice(BACKGROUND_PTS, size=int(rng.integers(1, 4)), replace=False))
        has_hoi = False
        for hoi in hois:
            p = base_rate[hoi]
            for name in suspects:
                p *= rr.get((name, hoi), float(rng.lognormal(0.0, 0.25)))
            if rng.random() < min(p, 0.6):
                terms = outcomes[hoi]["pts"]
                weights = 1.0 / np.arange(1, len(terms) + 1)
                pts.add(str(rng.choice(terms, p=weights / weights.sum())))
                has_hoi = True

        event = start_day + timedelta(days=int(rng.integers(0, 365)))
        event_dt = event.strftime("%Y%m%d") if rng.random() > 0.15 else ""
        age = int(np.clip(rng.normal(58, 18), 1, 99))
        sex = "F" if rng.random() < 0.55 else "M"
        occp = str(rng.choice(["MD", "HP", "PH", "CN", "LW"], p=[0.30, 0.20, 0.08, 0.40, 0.02]))
        if has_hoi:
            codes = [c for c, p in (("HO", 0.55), ("LT", 0.20), ("DE", 0.08)) if rng.random() < p]
        else:
            codes = [c for c, p in (("HO", 0.12), ("OT", 0.20), ("DE", 0.02)) if rng.random() < p]

        for version in versions:
            primaryid = f"{caseid}{version}"
            demo.append((primaryid, caseid, version, event_dt, age, "YR", sex, occp))
            for seq, name in enumerate(suspects + concomitants, start=1):
                role = "PS" if seq == 1 else ("SS" if seq <= n_suspect else "C")
                ingredient = name + (" HYDROCHLORIDE" if rng.random() < 0.1 else "")
                drug.append((primaryid, seq, role, ingredient, ingredient))
                if seq <= n_suspect:
                    indi.append((primaryid, seq, indication.get(name, "PRODUCT USED FOR UNKNOWN INDICATION")))
                    if event_dt and rng.random() < 0.6:
                        days = int(min(rng.lognormal(3.2, 1.2), 3000))
                        ther.append((primaryid, seq, (event - timedelta(days=days)).strftime("%Y%m%d")))
            for pt in sorted(pts):
                reac.append((primaryid, pt))
            for code in codes:
                outc.append((primaryid, code))

    return {
        "DEMO": pd.DataFrame(demo, columns=["primaryid", "caseid", "caseversion", "event_dt", "age", "age_cod", "sex", "occp_cod"]),
        "DRUG": pd.DataFrame(drug, columns=["primaryid", "drug_seq", "role_cod", "drugname", "prod_ai"]),
        "REAC": pd.DataFrame(reac, columns=["primaryid", "pt"]),
        "OUTC": pd.DataFrame(outc, columns=["primaryid", "outc_cod"]),
        "INDI": pd.DataFrame(indi, columns=["primaryid", "indi_drug_seq", "indi_pt"]),
        "THER": pd.DataFrame(ther, columns=["primaryid", "dsg_drug_seq", "start_dt"]),
    }


def write(directory: str | Path, n_cases: int = 60_000, seed: int = 7) -> Path:
    out = Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    for name, frame in generate(n_cases, seed).items():
        frame.to_csv(out / f"{name}_SYNTHETIC.txt", sep="$", index=False)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Write a synthetic FAERS-shaped benchmark")
    parser.add_argument("--out", default="synthetic_benchmark")
    parser.add_argument("--cases", type=int, default=60_000)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    print(f"Wrote synthetic benchmark to {write(args.out, args.cases, args.seed)}")


if __name__ == "__main__":
    main()
