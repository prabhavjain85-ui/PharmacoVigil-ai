"""
Optional FastAPI service for pharmacovigilance disproportionality analysis.

The public site is a static Next.js app (`web/`) with in-browser analysis.
This API remains available for local experimentation and uploads.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from typing import Any
from urllib.parse import unquote

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from drug_mapping import drug_map_summary
from faers_signal_detection import (
    build_case_level_table,
    compute_disproportionality,
    load_table,
    normalize_drug_name,
)
from make_sample_data import generate_sample_dataframes
from ml_prioritization import model_card
from pair_features import CaseContext

app = FastAPI(
    title="Pharmacovigilance Signal Analysis API",
    description="FAERS-style disproportionality analysis (PRR, BCPNN, EBGM, ML priority).",
    version="4.0.0",
)

ROOT = Path(__file__).resolve().parent

_DEFAULT_LOCAL_ORIGINS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]


def _cors_origins() -> list[str]:
    """Allow FRONTEND_ORIGIN (comma-separated); otherwise local dev origins only."""
    raw = os.environ.get("FRONTEND_ORIGIN", "").strip()
    if raw:
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return list(_DEFAULT_LOCAL_ORIGINS)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
SAMPLE_DIR = ROOT / "sample_data"
DEMO_CSV = SAMPLE_DIR / "DEMO_sample.csv"
DRUG_CSV = SAMPLE_DIR / "DRUG_sample.csv"
REAC_CSV = SAMPLE_DIR / "REAC_sample.csv"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024

# Upload state is process-local by design. The lock makes state replacement and
# cache invalidation atomic within one server process.
_data_lock = RLock()
_uploaded_tables: tuple[Any, Any, Any] | None = None
_uploaded_files: dict[str, str] = {}


def _jsonify_records(df) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    records = df.to_dict(orient="records")
    for row in records:
        for key, value in list(row.items()):
            if hasattr(value, "item"):
                row[key] = value.item()
            elif isinstance(value, bool):
                row[key] = bool(value)
            elif value is None or (isinstance(value, float) and pd.isna(value)):
                row[key] = None
    return records


@lru_cache(maxsize=1)
def _load_tables():
    """Use the active upload, then committed samples, then generated samples."""
    with _data_lock:
        if _uploaded_tables is not None:
            demo, drug, reac = _uploaded_tables
            return demo, drug, reac, "upload", dict(_uploaded_files)

    if DEMO_CSV.is_file() and DRUG_CSV.is_file() and REAC_CSV.is_file():
        demo = load_table(str(DEMO_CSV))
        drug = load_table(str(DRUG_CSV))
        reac = load_table(str(REAC_CSV))
        source = "sample_data"
        files = {
            "DEMO": "sample_data/DEMO_sample.csv",
            "DRUG": "sample_data/DRUG_sample.csv",
            "REAC": "sample_data/REAC_sample.csv",
        }
    else:
        demo, drug, reac = generate_sample_dataframes()
        # Generated frames predate load_table's column cleanup, so normalize here.
        for frame in (demo, drug, reac):
            frame.columns = [str(column).strip().lower() for column in frame.columns]
        source = "generated"
        files = {"DEMO": "generated", "DRUG": "generated", "REAC": "generated"}
    return demo, drug, reac, source, files


@lru_cache(maxsize=1)
def _pairs_and_meta():
    demo, drug, reac, source, files = _load_tables()
    pairs = build_case_level_table(demo, drug, reac)
    meta = {
        "source": source,
        "demo_rows": int(len(demo)),
        "drug_rows": int(len(drug)),
        "reac_rows": int(len(reac)),
        "case_count": int(demo["primaryid"].nunique()),
        "pair_count": int(len(pairs)),
        "files": files,
    }
    return pairs, meta


@lru_cache(maxsize=8)
def _all_signals(min_cases: int = 3) -> list[dict[str, Any]]:
    pairs, _ = _pairs_and_meta()
    demo, drug, *_ = _load_tables()
    context = CaseContext(demo=demo, drug=drug)
    return _jsonify_records(
        compute_disproportionality(pairs, min_cases=min_cases, case_context=context)
    )


def _invalidate_caches() -> None:
    _all_signals.cache_clear()
    _pairs_and_meta.cache_clear()
    _load_tables.cache_clear()


def _drug_stats() -> list[dict[str, Any]]:
    pairs, _ = _pairs_and_meta()
    signals = _all_signals(3)
    signal_by_drug: dict[str, int] = {}
    adr_by_drug: dict[str, int] = {}
    for row in signals:
        drug_name = row["drug"]
        adr_by_drug[drug_name] = adr_by_drug.get(drug_name, 0) + 1
        if row.get("signal_detected"):
            signal_by_drug[drug_name] = signal_by_drug.get(drug_name, 0) + 1

    if pairs.empty:
        return []
    counts = (
        pairs.groupby("drugname")["primaryid"]
        .nunique()
        .reset_index(name="report_count")
        .sort_values("drugname")
    )
    return [{
        "drug": row["drugname"],
        "report_count": int(row["report_count"]),
        "adr_count": int(adr_by_drug.get(row["drugname"], 0)),
        "signal_count": int(signal_by_drug.get(row["drugname"], 0)),
    } for _, row in counts.iterrows()]


async def _parse_upload(
    upload: UploadFile,
    table_name: str,
    required_columns: set[str],
):
    """Bound an upload, parse it through load_table, and validate its schema."""
    temporary_path: Path | None = None
    try:
        suffix = Path(upload.filename or "").suffix[:16]
        size = 0
        with NamedTemporaryFile(mode="wb", suffix=suffix, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            while True:
                chunk = await upload.read(UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"{table_name} exceeds the 5 MB upload limit",
                    )
                temporary.write(chunk)

        try:
            frame = load_table(str(temporary_path))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Could not parse {table_name}: {exc}",
            ) from exc

        missing = sorted(required_columns - set(frame.columns))
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"{table_name} missing required columns: {', '.join(missing)}",
            )
        return frame
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        await upload.close()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "pharmacovigilance-signal-api"}


@app.get("/api/dataset")
def api_dataset() -> JSONResponse:
    _, meta = _pairs_and_meta()
    drugs = _drug_stats()
    return JSONResponse({
        **meta,
        "drug_count": len(drugs),
        "drugs": [drug["drug"] for drug in drugs],
    })


@app.post("/api/ingest")
async def api_ingest(
    demo: UploadFile = File(..., description="FAERS DEMO CSV/TXT"),
    drug: UploadFile = File(..., description="FAERS DRUG CSV/TXT"),
    reac: UploadFile = File(..., description="FAERS REAC CSV/TXT"),
) -> JSONResponse:
    """Activate validated DEMO/DRUG/REAC uploads in this process."""
    parsed_demo = await _parse_upload(demo, "DEMO", {"primaryid"})
    parsed_drug = await _parse_upload(drug, "DRUG", {"primaryid", "drugname"})
    parsed_reac = await _parse_upload(reac, "REAC", {"primaryid", "pt"})

    global _uploaded_tables, _uploaded_files
    with _data_lock:
        _uploaded_tables = (
            parsed_demo.copy(deep=True),
            parsed_drug.copy(deep=True),
            parsed_reac.copy(deep=True),
        )
        _uploaded_files = {
            "DEMO": demo.filename or "uploaded DEMO",
            "DRUG": drug.filename or "uploaded DRUG",
            "REAC": reac.filename or "uploaded REAC",
        }
        _invalidate_caches()

    return api_dataset()


@app.post("/api/reset")
def api_reset() -> JSONResponse:
    """Discard process-local uploads and return to committed sample data."""
    global _uploaded_tables, _uploaded_files
    with _data_lock:
        _uploaded_tables = None
        _uploaded_files = {}
        _invalidate_caches()
    return api_dataset()


@app.get("/api/drug-map")
def api_drug_map() -> JSONResponse:
    return JSONResponse(drug_map_summary())


@app.get("/api/prioritization/meta")
def api_prioritization_meta() -> JSONResponse:
    """Provenance, evaluation and weights of the pretrained prioritisation model."""
    return JSONResponse(model_card())


@app.get("/api/drugs")
def api_drugs() -> JSONResponse:
    drugs = _drug_stats()
    return JSONResponse({"count": len(drugs), "drugs": drugs})


@app.get("/api/drugs/{drug_name}/adrs")
def api_drug_adrs(
    drug_name: str,
    min_cases: int = Query(3, ge=1, le=100, description="Minimum case count for a pair"),
    signals_only: bool = Query(False, description="Return only flagged signals"),
) -> JSONResponse:
    name = normalize_drug_name(unquote(drug_name))
    results = [row for row in _all_signals(min_cases) if row["drug"] == name]
    if signals_only:
        results = [row for row in results if row.get("signal_detected")]
    if not results and name not in {drug["drug"] for drug in _drug_stats()}:
        raise HTTPException(status_code=404, detail=f"Drug not found: {drug_name}")
    return JSONResponse({
        "drug": name,
        "min_cases": min_cases,
        "signals_only": signals_only,
        "count": len(results),
        "results": results,
    })


@app.get("/api/signals")
def api_signals(
    min_cases: int = Query(3, ge=1, le=100, description="Minimum case count for a pair"),
    signals_only: bool = Query(False, description="Return only flagged signals"),
    drug: str | None = Query(None, description="Optional drug filter"),
) -> JSONResponse:
    results = _all_signals(min_cases)
    if drug:
        wanted = normalize_drug_name(drug)
        results = [row for row in results if row["drug"] == wanted]
    if signals_only:
        results = [row for row in results if row.get("signal_detected")]
    return JSONResponse({
        "min_cases": min_cases,
        "signals_only": signals_only,
        "drug": normalize_drug_name(drug) if drug else None,
        "count": len(results),
        "results": results,
    })


@app.get("/api/compare")
def api_compare(
    drugs: str = Query(..., description="Comma-separated list of two or three drugs"),
    min_cases: int = Query(3, ge=1, le=100),
    signals_only: bool = Query(False),
) -> JSONResponse:
    """Return full per-drug rows and a matrix of events shared by selected drugs."""
    selected: list[str] = []
    for raw_name in drugs.split(","):
        raw_name = raw_name.strip()
        if not raw_name:
            continue
        canonical = normalize_drug_name(unquote(raw_name))
        if canonical not in selected:
            selected.append(canonical)
    if not 2 <= len(selected) <= 3:
        raise HTTPException(status_code=400, detail="Select two or three unique drugs")

    available = {drug["drug"] for drug in _drug_stats()}
    missing = [drug for drug in selected if drug not in available]
    if missing:
        raise HTTPException(status_code=404, detail=f"Drug not found: {', '.join(missing)}")

    rows = _all_signals(min_cases)
    if signals_only:
        rows = [row for row in rows if row.get("signal_detected")]
    selected_rows = {
        drug: [row for row in rows if row["drug"] == drug]
        for drug in selected
    }
    per_drug = [{
        "drug": drug,
        "count": len(selected_rows[drug]),
        "results": selected_rows[drug],
    } for drug in selected]

    by_event: dict[str, dict[str, dict[str, Any]]] = {}
    for drug, drug_rows in selected_rows.items():
        for row in drug_rows:
            by_event.setdefault(row["adverse_event"], {})[drug] = row

    matrix = []
    for event, event_rows in by_event.items():
        if len(event_rows) < 2:
            continue
        values = {}
        for drug in selected:
            row = event_rows.get(drug)
            values[drug] = None if row is None else {
                "case_count_a": row["case_count_a"],
                "PRR": row["PRR"],
                "ROR": row["ROR"],
                "chi_square": row["chi_square"],
                "IC": row.get("IC"),
                "IC025": row.get("IC025"),
                "EBGM": row.get("EBGM"),
                "EB05": row.get("EB05"),
                "signal_detected": row["signal_detected"],
                "signal_bcpnn": row.get("signal_bcpnn"),
                "signal_ebgm": row.get("signal_ebgm"),
                "priority_score": row.get("priority_score"),
                "priority_rank": row.get("priority_rank"),
            }
        matrix.append({
            "adverse_event": event,
            "drug_count": len(event_rows),
            "values": values,
        })
    matrix.sort(key=lambda row: (
        -row["drug_count"],
        -max(value["PRR"] for value in row["values"].values() if value is not None),
        row["adverse_event"],
    ))

    return JSONResponse({
        "drugs": selected,
        "min_cases": min_cases,
        "signals_only": signals_only,
        "per_drug": per_drug,
        "shared_event_count": len(matrix),
        "shared_event_matrix": matrix,
    })


# ---------------------------------------------------------------------------
# Optional Server-Side LLM Narrative Extractor (/api/nlp/extract)
# ---------------------------------------------------------------------------
import json as _json
import re as _re
from urllib.request import Request as _Request, urlopen as _urlopen
from pydantic import BaseModel, Field


class NlpExtractRequest(BaseModel):
    narrative: str = Field(..., min_length=1, max_length=20000)
    consentConfirmed: bool = Field(False, description="User must explicitly confirm external LLM transmission")
    loadedReacPts: list[str] = Field(default_factory=list)


_PII_PATTERNS: list[tuple[str, _re.Pattern[str], str]] = [
    ("email", _re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[REDACTED_EMAIL]"),
    ("phone", _re.compile(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b"), "[REDACTED_PHONE]"),
    ("ssn", _re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED_SSN]"),
    (
        "mrn",
        _re.compile(
            r"\b(?:MRN|Medical\s+Record(?:\s+Number)?|Record\s*#|Chart\s*#|Patient\s+ID)\s*[:#]?\s*[A-Za-z0-9-]{4,}\b",
            _re.IGNORECASE,
        ),
        "[REDACTED_MRN]",
    ),
    (
        "dob",
        _re.compile(
            r"\b(?:DOB|Date\s+of\s+Birth|born\s+on)\s*[:#]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b",
            _re.IGNORECASE,
        ),
        "DOB: [REDACTED_DOB]",
    ),
    (
        "titled_name",
        _re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b"),
        "[REDACTED_NAME]",
    ),
    (
        "patient_name",
        _re.compile(r"\bPatient\s+(?:Name\s*:\s*)?[A-Z][a-z]+\s+[A-Z][a-z]+\b"),
        "Patient [REDACTED_NAME]",
    ),
]


def redact_narrative_pii(text: str) -> str:
    """Strip obvious personal identifiers before sending narrative text to an external LLM."""
    cleaned = text
    for _, pattern, replacement in _PII_PATTERNS:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned


def _find_verbatim_span(narrative: str, candidate_text: str | None) -> dict[str, Any] | None:
    """Verify that candidate_text occurs verbatim in narrative; return {start, end, text} or None."""
    if not candidate_text or not str(candidate_text).strip():
        return None
    sub = str(candidate_text).strip()
    idx = narrative.find(sub)
    if idx >= 0:
        return {"start": idx, "end": idx + len(sub), "text": sub}
    lower_idx = narrative.lower().find(sub.lower())
    if lower_idx >= 0:
        actual = narrative[lower_idx : lower_idx + len(sub)]
        return {"start": lower_idx, "end": lower_idx + len(actual), "text": actual}
    return None


def validate_llm_extraction_payload(narrative: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Validate structured LLM JSON output and reject any spans not present verbatim in narrative."""
    validated_suspect: list[dict[str, Any]] = []
    for item in raw.get("suspectDrugs") or []:
        if not isinstance(item, dict):
            continue
        verbatim = item.get("verbatim") or (item.get("span") or {}).get("text")
        span = _find_verbatim_span(narrative, verbatim)
        if span is None:
            continue
        validated_suspect.append({
            "verbatim": span["text"],
            "canonical": normalize_drug_name(item.get("canonical") or span["text"]),
            "role": "PS",
            "dose": item.get("dose"),
            "route": item.get("route"),
            "startDate": item.get("startDate"),
            "stopDate": item.get("stopDate"),
            "indication": item.get("indication"),
            "span": span,
            "confidence": float(item.get("confidence", 0.9)),
        })

    validated_concomitant: list[dict[str, Any]] = []
    for item in raw.get("concomitantDrugs") or []:
        if not isinstance(item, dict):
            continue
        verbatim = item.get("verbatim") or (item.get("span") or {}).get("text")
        span = _find_verbatim_span(narrative, verbatim)
        if span is None:
            continue
        validated_concomitant.append({
            "verbatim": span["text"],
            "canonical": normalize_drug_name(item.get("canonical") or span["text"]),
            "role": "C",
            "dose": item.get("dose"),
            "route": item.get("route"),
            "startDate": item.get("startDate"),
            "stopDate": item.get("stopDate"),
            "indication": item.get("indication"),
            "span": span,
            "confidence": float(item.get("confidence", 0.88)),
        })

    validated_reactions: list[dict[str, Any]] = []
    for item in raw.get("reactions") or []:
        if not isinstance(item, dict):
            continue
        verbatim = item.get("verbatim") or (item.get("span") or {}).get("text")
        span = _find_verbatim_span(narrative, verbatim)
        if span is None:
            continue
        validated_reactions.append({
            "verbatim": span["text"],
            "mappedTerm": str(item.get("mappedTerm") or span["text"]).strip().upper(),
            "negated": bool(item.get("negated", False)),
            "uncertain": bool(item.get("uncertain", False)),
            "historical": bool(item.get("historical", False)),
            "onset": item.get("onset"),
            "span": span,
            "confidence": float(item.get("confidence", 0.9)),
        })

    return {
        "suspectDrugs": validated_suspect,
        "concomitantDrugs": validated_concomitant,
        "reactions": validated_reactions,
        "dechallenge": raw.get("dechallenge"),
        "rechallenge": raw.get("rechallenge"),
        "outcome": raw.get("outcome"),
        "seriousness": raw.get("seriousness") or {},
        "patientAge": raw.get("patientAge"),
        "patientSex": raw.get("patientSex"),
        "reporterType": raw.get("reporterType"),
        "extractorUsed": "llm-server",
        "requiresHumanReview": True,
        "regulatoryDisclaimer": (
            "Human review required — automated extraction is a research/triage aid "
            "and is NOT validated for regulatory ICSR submission."
        ),
    }


@app.post("/api/nlp/extract")
def api_nlp_extract(req: NlpExtractRequest) -> JSONResponse:
    """Optional server-side LLM narrative extractor.

    Requires explicit user consent (`consentConfirmed=True`) and a server-side API key
    (`NLP_LLM_API_KEY`, `GEMINI_API_KEY`, or `OPENAI_API_KEY`). Never logs narrative text.
    """
    if not req.consentConfirmed:
        raise HTTPException(
            status_code=400,
            detail="Explicit user consent (consentConfirmed=True) is required before calling the external LLM extractor.",
        )

    api_key = (
        os.environ.get("NLP_LLM_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Server LLM extractor is not configured (set NLP_LLM_API_KEY or GEMINI_API_KEY on the server).",
        )

    sanitized_narrative = redact_narrative_pii(req.narrative)
    endpoint = os.environ.get(
        "NLP_LLM_ENDPOINT",
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    ).strip()
    model_name = os.environ.get("NLP_LLM_MODEL", "gemini-2.5-flash").strip()

    system_prompt = (
        "You are a pharmacovigilance clinical narrative entity extractor. "
        "Return ONLY valid JSON with keys: suspectDrugs, concomitantDrugs, reactions, "
        "dechallenge, rechallenge, outcome, seriousness, patientAge, patientSex, reporterType. "
        "Every extracted item MUST include a `verbatim` string copied character-for-character "
        "from the narrative and a `confidence` float in [0, 1]. Flag negated, historical, or "
        "uncertain reactions with boolean flags (`negated`, `historical`, `uncertain`)."
    )

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": sanitized_narrative},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.0,
    }

    try:
        http_req = _Request(
            endpoint,
            data=_json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        with _urlopen(http_req, timeout=20.0) as resp:
            resp_data = _json.loads(resp.read().decode("utf-8"))
        content = resp_data["choices"][0]["message"]["content"]
        parsed = _json.loads(content)
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="External LLM extraction request failed.",
        )

    validated = validate_llm_extraction_payload(sanitized_narrative, parsed)
    return JSONResponse({"extraction": validated})
