"""
Load one or more real FAERS quarterly ASCII extracts for model training.

Point ``load_faers`` at the unzipped ``ASCII`` folders of the quarterly files
from the FDA (DEMOyyQq.txt, DRUGyyQq.txt, REACyyQq.txt, OUTCyyQq.txt,
INDIyyQq.txt, THERyyQq.txt).  Quarters are concatenated and reduced to the
latest version of each case, because a case that is updated is re-sent in a
later quarter under a new ``primaryid``.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd

TABLE_COLUMNS: dict[str, set[str]] = {
    "demo": {"primaryid", "caseid", "caseversion", "event_dt", "age", "age_cod", "sex", "occp_cod"},
    "drug": {"primaryid", "drug_seq", "role_cod", "drugname", "prod_ai"},
    "reac": {"primaryid", "pt"},
    "outc": {"primaryid", "outc_cod"},
    "indi": {"primaryid", "indi_drug_seq", "indi_pt"},
    "ther": {"primaryid", "dsg_drug_seq", "start_dt"},
}
REQUIRED_TABLES = ("demo", "drug", "reac")
_QUARTER = re.compile(r"(\d{2}Q[1-4])", re.IGNORECASE)


@dataclass
class FaersTables:
    demo: pd.DataFrame
    drug: pd.DataFrame
    reac: pd.DataFrame
    outc: Optional[pd.DataFrame] = None
    indi: Optional[pd.DataFrame] = None
    ther: Optional[pd.DataFrame] = None
    quarters: list[str] = field(default_factory=list)
    superseded_versions_dropped: int = 0


def _read(path: Path, wanted: set[str]) -> pd.DataFrame:
    frame = pd.read_csv(
        path,
        sep="$",
        dtype=str,
        encoding="latin-1",
        quoting=csv.QUOTE_NONE,
        on_bad_lines="skip",
        usecols=lambda column: str(column).lstrip("\ufeff").strip().lower() in wanted,
    )
    frame.columns = [str(c).lstrip("\ufeff").strip().lower() for c in frame.columns]
    return frame


def _find(directory: Path, table: str) -> list[Path]:
    return sorted(
        p for p in directory.rglob("*")
        if p.is_file() and p.suffix.lower() in {".txt", ".csv"} and p.name.lower().startswith(table)
    )


def load_faers(directories: Iterable[str | Path]) -> FaersTables:
    """Read and concatenate FAERS quarters, keeping the latest version of each case."""
    frames: dict[str, list[pd.DataFrame]] = {table: [] for table in TABLE_COLUMNS}
    quarters: set[str] = set()
    for directory in map(Path, directories):
        if not directory.is_dir():
            raise FileNotFoundError(f"Not a directory: {directory}")
        for table, wanted in TABLE_COLUMNS.items():
            for path in _find(directory, table):
                frames[table].append(_read(path, wanted))
                match = _QUARTER.search(path.name)
                if match:
                    quarters.add(match.group(1).upper())
    for table in REQUIRED_TABLES:
        if not frames[table]:
            raise FileNotFoundError(f"No {table.upper()}*.txt file found in the given directories")

    tables = {
        table: pd.concat(parts, ignore_index=True) if parts else None
        for table, parts in frames.items()
    }
    demo = tables["demo"]
    demo["primaryid"] = demo["primaryid"].astype("string").str.strip()
    before = len(demo)
    if {"caseid", "caseversion"} <= set(demo.columns):
        version = pd.to_numeric(demo["caseversion"], errors="coerce").fillna(0)
        demo = (
            demo.assign(_version=version)
            .sort_values(["caseid", "_version"])
            .drop_duplicates("caseid", keep="last")
            .drop(columns="_version")
        )
    demo = demo.drop_duplicates("primaryid").reset_index(drop=True)
    dropped = before - len(demo)

    keep = set(demo["primaryid"])
    for table in ("drug", "reac", "outc", "indi", "ther"):
        frame = tables[table]
        if frame is None:
            continue
        frame["primaryid"] = frame["primaryid"].astype("string").str.strip()
        tables[table] = frame[frame["primaryid"].isin(keep)].drop_duplicates().reset_index(drop=True)

    drug = tables["drug"]
    if "prod_ai" in drug.columns:
        # prod_ai is the active ingredient; fall back to the verbatim name when it is blank.
        ingredient = drug["prod_ai"].astype("string").str.strip()
        name = ingredient.where(ingredient.notna() & (ingredient != ""), drug["drugname"])
        # Combination products list ingredients separated by a backslash.
        drug = drug.assign(drugname=name.astype("string").str.split("\\", regex=False)).explode("drugname")
        drug["drugname"] = drug["drugname"].astype("string").str.strip()
        drug = drug.drop(columns="prod_ai").reset_index(drop=True)
    tables["drug"] = drug

    return FaersTables(
        demo=demo,
        drug=tables["drug"],
        reac=tables["reac"],
        outc=tables["outc"],
        indi=tables["indi"],
        ther=tables["ther"],
        quarters=sorted(quarters),
        superseded_versions_dropped=dropped,
    )
