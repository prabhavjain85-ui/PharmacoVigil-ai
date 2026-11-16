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
    "indi": {"primaryid", "indi_pt"},
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


def _read(
    path: Path,
    wanted: set[str],
    table_name: str = "",
    keep: Optional[set[str]] = None,
) -> pd.DataFrame:
    frame = pd.read_csv(
        path,
        sep="$",
        dtype=str,
        na_filter=False,
        encoding="latin-1",
        quoting=csv.QUOTE_NONE,
        on_bad_lines="skip",
        usecols=lambda column: str(column).lstrip("\ufeff").strip().lower() in wanted,
    )
    frame.columns = [str(c).lstrip("\ufeff").strip().lower() for c in frame.columns]
    if "primaryid" in frame.columns:
        frame["primaryid"] = frame["primaryid"].str.strip()
        frame = frame[frame["primaryid"] != ""]
        if keep is not None:
            frame = frame[frame["primaryid"].isin(keep)]
    if table_name == "drug":
        if "prod_ai" in frame.columns:
            ingredient = frame["prod_ai"].str.strip()
            name = ingredient.where(ingredient != "", frame["drugname"])
            frame = frame.drop(columns="prod_ai")
            has_backslash = name.str.contains("\\", regex=False, na=False)
            if has_backslash.any():
                simple = frame.loc[~has_backslash].assign(drugname=name.loc[~has_backslash].str.strip())
                combo = (
                    frame.loc[has_backslash]
                    .assign(drugname=name.loc[has_backslash].str.split("\\", regex=False))
                    .explode("drugname")
                )
                combo["drugname"] = combo["drugname"].str.strip()
                frame = pd.concat([simple, combo], ignore_index=True)
            else:
                frame["drugname"] = name.str.strip()
        if "role_cod" in frame.columns and "drug_seq" in frame.columns:
            roles = frame["role_cod"].str.strip().str.upper()
            is_suspect = roles.isin(["PS", "SS"])
            frame["role_cod"] = roles.where(is_suspect, "C")
            frame["drug_seq"] = frame["drug_seq"].where(is_suspect, "")
    return frame.drop_duplicates()


def _find(directory: Path, table: str) -> list[Path]:
    return sorted(
        p for p in directory.rglob("*")
        if p.is_file() and p.suffix.lower() in {".txt", ".csv"} and p.name.lower().startswith(table)
    )


def load_faers(directories: Iterable[str | Path]) -> FaersTables:
    """Read and concatenate FAERS quarters, keeping the latest version of each case."""
    import gc

    dir_list = [Path(d) for d in directories]
    for directory in dir_list:
        if not directory.is_dir():
            raise FileNotFoundError(f"Not a directory: {directory}")

    quarters: set[str] = set()
    demo_parts: list[pd.DataFrame] = []
    for directory in dir_list:
        for path in _find(directory, "demo"):
            demo_parts.append(_read(path, TABLE_COLUMNS["demo"], "demo"))
            match = _QUARTER.search(path.name)
            if match:
                quarters.add(match.group(1).upper())
    if not demo_parts:
        raise FileNotFoundError("No DEMO*.txt file found in the given directories")

    demo = pd.concat(demo_parts, ignore_index=True)
    del demo_parts
    gc.collect()
    before = len(demo)
    if {"caseid", "caseversion"} <= set(demo.columns):
        version = pd.to_numeric(demo["caseversion"], errors="coerce").fillna(0)
        demo = (
            demo.assign(_version=version)
            .sort_values(["caseid", "_version"])
            .drop_duplicates("caseid", keep="last")
            .drop(columns=["_version", "caseid", "caseversion"])
        )
    demo = demo.drop_duplicates("primaryid").reset_index(drop=True)
    dropped = before - len(demo)
    keep = set(demo["primaryid"])

    tables: dict[str, Optional[pd.DataFrame]] = {"demo": demo}
    for table in ("drug", "reac", "outc", "indi", "ther"):
        parts: list[pd.DataFrame] = []
        for directory in dir_list:
            for path in _find(directory, table):
                parts.append(_read(path, TABLE_COLUMNS[table], table, keep))
                match = _QUARTER.search(path.name)
                if match:
                    quarters.add(match.group(1).upper())
        if table in REQUIRED_TABLES and not parts:
            raise FileNotFoundError(f"No {table.upper()}*.txt file found in the given directories")
        if parts:
            has_overlap = False
            if len(parts) > 1 and "primaryid" in parts[0].columns:
                seen_p: set[str] = set()
                for p_df in parts:
                    p_set = set(p_df["primaryid"].unique())
                    if seen_p & p_set:
                        has_overlap = True
                        break
                    seen_p |= p_set
                del seen_p
            combined = pd.concat(parts, ignore_index=True)
            del parts
            gc.collect()
            if has_overlap:
                combined = combined.drop_duplicates().reset_index(drop=True)
            tables[table] = combined
            del combined
        else:
            del parts
            tables[table] = None
        gc.collect()

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
