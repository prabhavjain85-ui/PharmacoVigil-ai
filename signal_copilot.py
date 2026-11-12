"""Signal Assessment Drafts, Natural-Language JSON Filter Translation, and Live openFDA Count Disproportionality.

Architecture & Safety Rules:
1. API keys live on the server only (environment variables in main.py).
2. Never send uploaded report-level data to an LLM. Only aggregate statistics for
   the selected drug-event pair and text retrieved from public sources (openFDA SPL
   product labels and PubMed abstracts via NCBI E-utilities) are ever included.
3. "Already labelled" is a deterministic text-retrieval match against openFDA label
   sections (boxed_warning, warnings, adverse_reactions) with verbatim excerpt extraction,
   never an LLM judgement.
4. Every factual sentence in a generated draft must cite a retrieved source ([LABEL:...],
   [PMID:...], or [STATS]). Post-generation verification drops or flags any sentence whose
   citation is missing or not in the retrieved sources, and blocks any causal claim.
5. Every draft records model_name, prompt_version, retrieval_timestamp, and human-review notice.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import os
import re
import time
from threading import Lock
from typing import Any, Sequence
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from drug_mapping import canonicalize_drug

try:
    import numpy as np
    import pandas as pd
    from scipy import stats
    from bayesian_stats import (
        _js_round,
        bcpnn,
        benjamini_hochberg,
        ebgm_pair,
        expected_count,
        fit_gamma_poisson_prior,
    )
    from faers_signal_detection import SERIOUS_ADVERSE_EVENTS, normalize_pt
    _HAS_SCIENTIFIC_STACK = True
except ImportError:
    _HAS_SCIENTIFIC_STACK = False
    SERIOUS_ADVERSE_EVENTS = {
        "GASTROINTESTINAL HAEMORRHAGE",
        "ANAPHYLACTIC REACTION",
        "HEPATIC FAILURE",
        "RHABDOMYOLYSIS",
        "ANGIOEDEMA",
        "DYSPNOEA",
    }

    def normalize_pt(pt: str) -> str:
        return " ".join(str(pt or "").strip().upper().split())

    def _js_round(value: float, digits: int = 3) -> float:
        factor = 10 ** digits
        return math.floor(value * factor + 0.5) / factor

PROMPT_VERSION_ASSESSMENT = "signal-assessment-v1.2"
PROMPT_VERSION_NL_FILTER = "nl-signal-filter-v1.1"
DEFAULT_LLM_MODEL = "gemini-2.5-flash"

# Pricing estimate ($ per 1M tokens) for per-request spending cap enforcement
COST_PER_1M_INPUT_USD = 0.30
COST_PER_1M_OUTPUT_USD = 1.20
DEFAULT_MAX_REQUEST_COST_USD = 0.02
MAX_OUTPUT_TOKENS = 1200


# ---------------------------------------------------------------------------
# 1. Server Rate-Limiter & Spending Cap
# ---------------------------------------------------------------------------


class SlidingWindowRateLimiter:
    """Thread-safe sliding-window rate limiter per client key."""

    def __init__(self, max_requests: int = 15, window_seconds: float = 60.0) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = Lock()

    def check(self, client_key: str) -> tuple[bool, float]:
        """Return (allowed, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            history = [t for t in self._hits.get(client_key, []) if now - t < self.window_seconds]
            if len(history) >= self.max_requests:
                oldest = history[0]
                retry_after = max(1.0, round(self.window_seconds - (now - oldest), 1))
                self._hits[client_key] = history
                return False, retry_after
            history.append(now)
            self._hits[client_key] = history
            return True, 0.0


def estimate_llm_cost_usd(
    prompt_chars: int,
    max_output_tokens: int = MAX_OUTPUT_TOKENS,
) -> float:
    """Conservative upper-bound cost estimate in USD before issuing an LLM request."""
    est_input_tokens = max(1, math.ceil(prompt_chars / 3.5))
    cost = (est_input_tokens / 1_000_000.0) * COST_PER_1M_INPUT_USD + (
        max_output_tokens / 1_000_000.0
    ) * COST_PER_1M_OUTPUT_USD
    return round(cost, 6)


def check_spending_cap(
    prompt_chars: int,
    max_output_tokens: int = MAX_OUTPUT_TOKENS,
    cap_usd: float | None = None,
) -> float:
    """Verify estimated request cost is below the per-request spending cap."""
    limit = (
        cap_usd
        if cap_usd is not None
        else float(os.environ.get("MAX_REQUEST_COST_USD", DEFAULT_MAX_REQUEST_COST_USD))
    )
    est = estimate_llm_cost_usd(prompt_chars, max_output_tokens)
    if est > limit:
        raise ValueError(
            f"Estimated request cost ${est:.5f} exceeds per-request spending cap ${limit:.5f}."
        )
    return est


# ---------------------------------------------------------------------------
# 2. Deterministic Label-Status Matching & Synonym Dictionary
# ---------------------------------------------------------------------------

EVENT_SYNONYMS: dict[str, list[str]] = {
    "GASTROINTESTINAL HAEMORRHAGE": [
        "gastrointestinal haemorrhage",
        "gastrointestinal hemorrhage",
        "gastrointestinal bleeding",
        "gi haemorrhage",
        "gi hemorrhage",
        "gi bleeding",
        "gi bleed",
        "peptic ulcer bleeding",
        "upper gastrointestinal bleeding",
        "lower gastrointestinal bleeding",
        "melena",
        "hematemesis",
        "rectal hemorrhage",
    ],
    "HAEMORRHAGE": [
        "haemorrhage",
        "hemorrhage",
        "bleeding",
        "major bleeding",
        "fatal bleeding",
    ],
    "RHABDOMYOLYSIS": [
        "rhabdomyolysis",
        "myoglobinuria",
        "severe myopathy",
        "skeletal muscle breakdown",
    ],
    "MYOPATHY": [
        "myopathy",
        "myalgia",
        "muscle weakness",
        "myositis",
        "creatine kinase elevation",
    ],
    "HEPATIC FAILURE": [
        "hepatic failure",
        "liver failure",
        "acute liver failure",
        "fulminant hepatitis",
        "hepatic necrosis",
        "hepatotoxicity",
    ],
    "ACUTE KIDNEY INJURY": [
        "acute kidney injury",
        "acute renal failure",
        "renal failure",
        "renal injury",
        "renal papillary necrosis",
        "nephrotoxicity",
    ],
    "ANAPHYLACTIC REACTION": [
        "anaphylactic reaction",
        "anaphylactic",
        "anaphylaxis",
        "anaphylactic shock",
        "anaphylactoid reaction",
        "severe hypersensitivity",
    ],
    "ANGIOEDEMA": [
        "angioedema",
        "angioneurotic oedema",
        "angioneurotic edema",
        "facial swelling",
        "laryngeal edema",
    ],
    "LACTIC ACIDOSIS": [
        "lactic acidosis",
        "metabolic acidosis",
        "elevated blood lactate",
    ],
    "SUICIDAL IDEATION": [
        "suicidal ideation",
        "suicidal thoughts",
        "suicidality",
        "suicidal behavior",
    ],
    "CONGENITAL ANOMALY": [
        "congenital anomaly",
        "congenital anomalies",
        "birth defects",
        "fetal abnormalities",
        "major human fetal abnormalities",
        "teratogenicity",
    ],
    "PANCREATITIS": [
        "pancreatitis",
        "acute pancreatitis",
        "hemorrhagic pancreatitis",
        "necrotizing pancreatitis",
    ],
    "QT PROLONGATION": [
        "qt prolongation",
        "electrocardiogram qt prolonged",
        "prolonged qt interval",
        "torsades de pointes",
    ],
    "STEVENS-JOHNSON SYNDROME": [
        "stevens-johnson syndrome",
        "stevens johnson syndrome",
        "toxic epidermal necrolysis",
        "severe cutaneous adverse reactions",
    ],
    "THROMBOCYTOPENIA": [
        "thrombocytopenia",
        "decreased platelets",
        "platelet count decreased",
        "heparin-induced thrombocytopenia",
    ],
    "AGRANULOCYTOSIS": [
        "agranulocytosis",
        "severe neutropenia",
        "granulocytopenia",
    ],
    "TENDON RUPTURE": [
        "tendon rupture",
        "tendinitis",
        "achilles tendon rupture",
    ],
    "PERIPHERAL NEUROPATHY": [
        "peripheral neuropathy",
        "polyneuropathy",
    ],
    "RETINAL DETACHMENT": [
        "retinal detachment",
        "retinal tear",
    ],
    "PULMONARY FIBROSIS": [
        "pulmonary fibrosis",
        "interstitial lung disease",
        "pneumonitis",
        "pulmonary toxicity",
    ],
    "HYPOGLYCAEMIA": [
        "hypoglycaemia",
        "hypoglycemia",
        "low blood glucose",
        "low blood sugar",
    ],
    "HYPERKALAEMIA": [
        "hyperkalaemia",
        "hyperkalemia",
        "elevated serum potassium",
    ],
    "COUGH": [
        "cough",
        "persistent dry cough",
        "nonproductive cough",
    ],
    "DYSPNOEA": [
        "dyspnoea",
        "dyspnea",
        "shortness of breath",
        "respiratory distress",
    ],
    "NAUSEA": [
        "nausea",
        "vomiting",
        "emesis",
    ],
    "HEADACHE": [
        "headache",
        "migraine",
        "cephalgia",
    ],
    "DIZZINESS": [
        "dizziness",
        "vertigo",
        "lightheadedness",
    ],
    "RASH": [
        "rash",
        "maculopapular rash",
        "skin eruption",
        "exanthema",
    ],
    "ALOPECIA": [
        "alopecia",
        "hair loss",
        "thinning hair",
    ],
}


def expand_event_synonyms(adverse_event: str) -> list[str]:
    """Return canonical event term + British/American spelling variants + curated synonyms."""
    pt = normalize_pt(adverse_event)
    candidates: list[str] = []
    if pt:
        candidates.append(pt.lower())
        us_variant = (
            pt.lower()
            .replace("haemorrhag", "hemorrhag")
            .replace("oedema", "edema")
            .replace("anaemia", "anemia")
            .replace("hypoglycaemia", "hypoglycemia")
            .replace("hyperkalaemia", "hyperkalemia")
            .replace("dyspnoea", "dyspnea")
            .replace("diarrhoea", "diarrhea")
            .replace("leukopaenia", "leukopenia")
            .replace("neutropaenia", "neutropenia")
        )
        if us_variant not in candidates:
            candidates.append(us_variant)

    for syn in EVENT_SYNONYMS.get(pt, []):
        s_low = syn.lower().strip()
        if s_low and s_low not in candidates:
            candidates.append(s_low)
    return candidates


def determine_label_status(
    adverse_event: str,
    label_sections: dict[str, str],
) -> dict[str, Any]:
    """
    Deterministic retrieval check for whether `adverse_event` (or its close clinical
    synonyms) appears in the retrieved openFDA product label sections.
    Checks sections in regulatory priority order:
      1. boxed_warning
      2. warnings
      3. adverse_reactions
    Never uses an LLM judgement.
    """
    synonyms = expand_event_synonyms(adverse_event)
    section_order = ("boxed_warning", "warnings", "adverse_reactions")

    non_empty_sections = [s for s in section_order if (label_sections.get(s) or "").strip()]
    if not non_empty_sections:
        return {
            "status": "no_label_retrieved",
            "is_labelled": False,
            "already_labelled": False,
            "matched_section": None,
            "matched_term": None,
            "excerpt": None,
            "synonyms_checked": synonyms,
            "method": "deterministic_spl_text_match",
            "explanation": "No openFDA product label sections were retrieved for this drug.",
        }

    for section in section_order:
        raw_text = (label_sections.get(section) or "").strip()
        if not raw_text:
            continue
        clean_text = re.sub(r"\s+", " ", raw_text)
        lower_text = clean_text.lower()

        for term in synonyms:
            pattern = re.compile(r"\b" + re.escape(term) + r"\b", re.IGNORECASE)
            match = pattern.search(clean_text)
            if match:
                start_idx, end_idx = match.span()
                prefix_window = lower_text[max(0, start_idx - 45) : start_idx]
                if re.search(
                    r"\b(no\s+evidence\s+of|not\s+associated\s+with|no\s+cases\s+of)\s*$",
                    prefix_window,
                ):
                    continue
                snippet_start = max(0, start_idx - 110)
                snippet_end = min(len(clean_text), end_idx + 150)
                excerpt = clean_text[snippet_start:snippet_end].strip()
                if snippet_start > 0:
                    excerpt = "..." + excerpt
                if snippet_end < len(clean_text):
                    excerpt = excerpt + "..."
                return {
                    "status": "already_labelled",
                    "is_labelled": True,
                    "already_labelled": True,
                    "matched_section": section,
                    "matched_term": match.group(0),
                    "excerpt": excerpt,
                    "synonyms_checked": synonyms,
                    "method": "deterministic_spl_text_match",
                    "explanation": (
                        f"Deterministic match of '{match.group(0)}' in openFDA SPL section "
                        f"'{section}' (retrieval result, not an LLM judgement)."
                    ),
                }

    return {
        "status": "not_found_in_label",
        "is_labelled": False,
        "already_labelled": False,
        "matched_section": None,
        "matched_term": None,
        "excerpt": None,
        "synonyms_checked": synonyms,
        "sections_searched": non_empty_sections,
        "method": "deterministic_spl_text_match",
        "explanation": (
            f"Searched {', '.join(non_empty_sections)} for {len(synonyms)} synonym(s) of "
            f"'{adverse_event}'; no match found in retrieved label text."
        ),
    }


# ---------------------------------------------------------------------------
# 3. Public Source Retrieval (openFDA Drug Label + PubMed E-utilities) with Cache
# ---------------------------------------------------------------------------

_retrieval_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = Lock()
CACHE_TTL_SECONDS = 3600.0


def _cache_get(key: str) -> Any | None:
    now = time.monotonic()
    with _cache_lock:
        entry = _retrieval_cache.get(key)
        if entry is None:
            return None
        ts, val = entry
        if now - ts > CACHE_TTL_SECONDS:
            del _retrieval_cache[key]
            return None
        return val


def _cache_set(key: str, val: Any) -> None:
    with _cache_lock:
        if len(_retrieval_cache) > 256:
            oldest_key = min(_retrieval_cache, key=lambda k: _retrieval_cache[k][0])
            del _retrieval_cache[oldest_key]
        _retrieval_cache[key] = (time.monotonic(), val)


def _http_get_json(url: str, timeout: float = 10.0) -> dict[str, Any]:
    req = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "PharmacoVigil-AI/1.0 (https://github.com/prabhavjain85-ui/PharmacoVigil-ai)",
        },
    )
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def retrieve_openfda_label_sections(drug: str) -> dict[str, Any]:
    """
    Fetch openFDA product label sections (adverse_reactions, warnings, boxed_warning)
    for `drug` from https://api.fda.gov/drug/label.json.
    """
    clean_drug = canonicalize_drug(drug).strip()
    cache_key = f"label:{clean_drug}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    api_key = os.environ.get("OPENFDA_API_KEY", "").strip()
    queries = [
        f'openfda.generic_name:"{clean_drug}"',
        f'openfda.substance_name:"{clean_drug}"',
        f'openfda.brand_name:"{clean_drug}"',
    ]

    for q in queries:
        params: dict[str, str] = {"search": q, "limit": "1"}
        if api_key:
            params["api_key"] = api_key
        url = f"https://api.fda.gov/drug/label.json?{urlencode(params)}"
        try:
            data = _http_get_json(url, timeout=8.0)
            results = data.get("results") or []
            if results:
                hit = results[0]
                adverse_reactions = " ".join(hit.get("adverse_reactions") or [])[:4500]
                warnings_list = (hit.get("warnings_and_cautions") or []) + (hit.get("warnings") or [])
                warnings_text = " ".join(warnings_list)[:4500]
                boxed_warning = " ".join(hit.get("boxed_warning") or [])[:3000]
                openfda_meta = hit.get("openfda") or {}
                out = {
                    "drug": clean_drug,
                    "retrieved": True,
                    "spl_set_id": hit.get("set_id") or hit.get("id"),
                    "effective_time": hit.get("effective_time"),
                    "brand_names": (openfda_meta.get("brand_name") or [])[:3],
                    "generic_names": (openfda_meta.get("generic_name") or [])[:3],
                    "sections": {
                        "boxed_warning": boxed_warning,
                        "warnings": warnings_text,
                        "adverse_reactions": adverse_reactions,
                    },
                }
                _cache_set(cache_key, out)
                return out
        except HTTPError as exc:
            if exc.code == 404:
                continue
        except Exception:
            continue

    empty_out = {
        "drug": clean_drug,
        "retrieved": False,
        "spl_set_id": None,
        "effective_time": None,
        "brand_names": [],
        "generic_names": [],
        "sections": {
            "boxed_warning": "",
            "warnings": "",
            "adverse_reactions": "",
        },
    }
    _cache_set(cache_key, empty_out)
    return empty_out


def retrieve_pubmed_abstracts(
    drug: str,
    adverse_event: str,
    max_results: int = 20,
) -> list[dict[str, str]]:
    """
    Retrieve up to `max_results` (capped at 20, newest first) PubMed abstracts
    for `(drug, adverse_event)` via NCBI E-utilities (esearch + efetch XML).
    """
    clean_drug = canonicalize_drug(drug).strip()
    clean_event = normalize_pt(adverse_event).strip()
    cap = max(1, min(20, int(max_results)))
    cache_key = f"pubmed:{clean_drug}:{clean_event}:{cap}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    ncbi_key = os.environ.get("NCBI_API_KEY", "").strip()
    term = f'("{clean_drug}"[Title/Abstract]) AND ("{clean_event}"[Title/Abstract])'
    search_params: dict[str, str] = {
        "db": "pubmed",
        "term": term,
        "retmax": str(cap),
        "sort": "pub+date",
        "retmode": "json",
    }
    if ncbi_key:
        search_params["api_key"] = ncbi_key

    esearch_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?{urlencode(search_params)}"
    try:
        search_data = _http_get_json(esearch_url, timeout=8.0)
        id_list = (search_data.get("esearchresult") or {}).get("idlist") or []
        if not id_list:
            _cache_set(cache_key, [])
            return []

        pmids = [str(x).strip() for x in id_list[:cap] if str(x).strip()]
        fetch_params: dict[str, str] = {
            "db": "pubmed",
            "id": ",".join(pmids),
            "retmode": "xml",
        }
        if ncbi_key:
            fetch_params["api_key"] = ncbi_key

        efetch_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?{urlencode(fetch_params)}"
        req = Request(
            efetch_url,
            headers={"User-Agent": "PharmacoVigil-AI/1.0"},
        )
        with urlopen(req, timeout=10.0) as resp:
            xml_text = resp.read().decode("utf-8", errors="replace")

        articles: list[dict[str, str]] = []
        for article_match in re.finditer(r"<PubmedArticle>(.*?)</PubmedArticle>", xml_text, re.DOTALL):
            block = article_match.group(1)
            pmid_m = re.search(r"<PMID[^>]*>(\d+)</PMID>", block)
            if not pmid_m:
                continue
            pmid = pmid_m.group(1).strip()
            title_m = re.search(r"<ArticleTitle>(.*?)</ArticleTitle>", block, re.DOTALL)
            title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else f"PubMed Article {pmid}"
            abs_parts = re.findall(r"<AbstractText[^>]*>(.*?)</AbstractText>", block, re.DOTALL)
            abstract = " ".join(re.sub(r"<[^>]+>", "", p).strip() for p in abs_parts).strip()
            year_m = re.search(r"<PubDate>.*?<Year>(\d{4})</Year>.*?</PubDate>", block, re.DOTALL)
            year = year_m.group(1) if year_m else "n.d."
            if not abstract:
                abstract = title
            articles.append(
                {
                    "pmid": pmid,
                    "title": title[:300],
                    "year": year,
                    "abstract": abstract[:1200],
                }
            )

        _cache_set(cache_key, articles)
        return articles
    except Exception:
        return []


# ---------------------------------------------------------------------------
# 4. Citation Verification, Causality Guardrail & Structured Assessment Draft
# ---------------------------------------------------------------------------

_CITATION_PATTERN = re.compile(
    r"\[(?:LABEL:(?:boxed_warning|warnings|adverse_reactions)|PMID:\d+|STATS)\]"
)

_CAUSAL_CLAIM_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"\b(?:proves?|proven|confirms?|establishes?|demonstrates?)\s+(?:that\s+)?[^.]{0,40}\bcauses?\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bis\s+the\s+(?:direct|definitive|proven|established)\s+cause\s+of\b", re.IGNORECASE),
    re.compile(r"\bcausally\s+linked\b", re.IGNORECASE),
    re.compile(r"\bdirectly\s+causes\b", re.IGNORECASE),
    re.compile(r"\bdefinitively\s+causes\b", re.IGNORECASE),
]


def sanitize_causal_language(sentence: str) -> tuple[str, bool]:
    """
    Ensure no sentence claims that the drug causes the adverse event.
    Replaces prohibited causal phrasing with associative pharmacovigilance phrasing.
    Returns (sanitized_sentence, was_modified).
    """
    modified = False
    out = sentence
    for pat in _CAUSAL_CLAIM_PATTERNS:
        if pat.search(out):
            modified = True
            out = pat.sub("is statistically associated in spontaneous reports with", out)
    bare_causes = re.compile(r"\bcauses\b", re.IGNORECASE)
    if bare_causes.search(out):
        modified = True
        out = bare_causes.sub("is reported in association with", out)
    return out, modified


def verify_draft_sentences(
    sentences: Sequence[str],
    valid_source_ids: set[str],
) -> list[dict[str, Any]]:
    """
    Verify that every factual sentence cites at least one source tag from
    `valid_source_ids` (e.g., 'LABEL:boxed_warning', 'LABEL:warnings',
    'LABEL:adverse_reactions', 'PMID:12345678', 'STATS') and that ALL cited
    tags exist in `valid_source_ids`.
    Sentences failing verification are marked `verified=False` and dropped
    from the verified narrative.
    """
    verified_records: list[dict[str, Any]] = []
    for raw_sent in sentences:
        s = str(raw_sent or "").strip()
        if not s:
            continue
        sanitized, causal_rewritten = sanitize_causal_language(s)
        raw_tags = _CITATION_PATTERN.findall(sanitized)
        cited_ids = [t.strip("[]") for t in raw_tags]

        if not cited_ids:
            verified_records.append(
                {
                    "sentence": sanitized,
                    "text": sanitized,
                    "citations": [],
                    "verified": False,
                    "status": "dropped_missing_citation",
                    "causal_rewritten": causal_rewritten,
                }
            )
            continue

        unknown_ids = [cid for cid in cited_ids if cid not in valid_source_ids]
        if unknown_ids:
            verified_records.append(
                {
                    "sentence": sanitized,
                    "text": sanitized,
                    "citations": cited_ids,
                    "unknown_citations": unknown_ids,
                    "verified": False,
                    "status": "dropped_unverified_source",
                    "causal_rewritten": causal_rewritten,
                }
            )
            continue

        verified_records.append(
            {
                "sentence": sanitized,
                "text": sanitized,
                "citations": cited_ids,
                "verified": True,
                "status": "verified",
                "causal_rewritten": causal_rewritten,
            }
        )
    return verified_records


def generate_signal_assessment_draft(
    *,
    drug: str | None = None,
    adverse_event: str | None = None,
    stats_payload: dict[str, Any] | None = None,
    stats: dict[str, Any] | None = None,
    label_data: dict[str, Any] | None = None,
    pre_retrieved_label: dict[str, Any] | None = None,
    pubmed_articles: list[dict[str, str]] | None = None,
    pre_retrieved_pubmed: dict[str, Any] | list[dict[str, str]] | None = None,
    use_llm: bool = True,
) -> dict[str, Any]:
    """
    Generate a structured Signal Assessment Draft for `(drug, adverse_event)`.
    - Never sends report-level data to an LLM (only aggregate numbers and public
      openFDA/PubMed text).
    - Determines `label_status` deterministically via `determine_label_status`.
    - Verifies every generated sentence against retrieved source IDs (`valid_source_ids`).
    - If neither openFDA label sections nor PubMed abstracts were retrieved, refuses
      to synthesize literature/label claims from model memory.
    """
    retrieval_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    eff_stats = stats_payload if stats_payload is not None else (stats or {})
    raw_drug = drug or str(eff_stats.get("drug") or "")
    raw_event = adverse_event or str(eff_stats.get("adverse_event") or "")
    clean_drug = canonicalize_drug(raw_drug)
    clean_event = normalize_pt(raw_event)

    eff_label = label_data if label_data is not None else pre_retrieved_label
    if eff_label is None:
        eff_label = retrieve_openfda_label_sections(clean_drug)

    eff_pubmed: list[dict[str, str]]
    if pubmed_articles is not None:
        eff_pubmed = pubmed_articles
    elif pre_retrieved_pubmed is not None:
        if isinstance(pre_retrieved_pubmed, dict):
            raw_abs = pre_retrieved_pubmed.get("abstracts") or []
            eff_pubmed = [
                {
                    "pmid": str(a.get("pmid") or ""),
                    "title": str(a.get("title") or ""),
                    "year": str(a.get("year") or a.get("pub_date") or "n.d."),
                    "abstract": str(a.get("abstract") or a.get("abstract_excerpt") or ""),
                }
                for a in raw_abs
            ]
        else:
            eff_pubmed = list(pre_retrieved_pubmed)
    else:
        eff_pubmed = retrieve_pubmed_abstracts(clean_drug, clean_event, max_results=20)

    sections = (eff_label or {}).get("sections") or {}
    label_status = determine_label_status(clean_event, sections)

    # Build the exact allowlist of valid citation IDs present in this retrieval
    valid_source_ids: set[str] = {"STATS"}
    for sec_name in ("boxed_warning", "warnings", "adverse_reactions"):
        if (sections.get(sec_name) or "").strip():
            valid_source_ids.add(f"LABEL:{sec_name}")
    for art in eff_pubmed:
        pmid = str(art.get("pmid") or "").strip()
        if pmid:
            valid_source_ids.add(f"PMID:{pmid}")

    has_any_public_source = len(valid_source_ids - {"STATS"}) > 0

    safe_stats = {
        "drug": clean_drug,
        "adverse_event": clean_event,
        "case_count_a": int(eff_stats.get("case_count_a", 0)),
        "drug_total_reports": int(eff_stats.get("drug_total_reports", 0)),
        "event_total_reports": int(eff_stats.get("event_total_reports", 0)),
        "PRR": float(eff_stats.get("PRR", 0.0)),
        "PRR_MH": eff_stats.get("PRR_MH"),
        "ROR": float(eff_stats.get("ROR", 0.0)),
        "ROR_95CI_low": float(eff_stats.get("ROR_95CI_low", 0.0)),
        "ROR_95CI_high": float(eff_stats.get("ROR_95CI_high", 0.0)),
        "chi_square": float(eff_stats.get("chi_square", 0.0)),
        "p_value": float(eff_stats.get("p_value", 1.0)),
        "q_value": float(eff_stats.get("q_value", 1.0)),
        "IC": float(eff_stats.get("IC", 0.0)),
        "IC025": float(eff_stats.get("IC025", 0.0)),
        "EBGM": float(eff_stats.get("EBGM", 0.0)),
        "EB05": float(eff_stats.get("EB05", 0.0)),
        "weibull_shape": eff_stats.get("weibull_shape"),
        "weibull_regime": eff_stats.get("weibull_regime"),
    }

    if not has_any_public_source:
        no_source_msg = (
            f"No openFDA product label sections or PubMed abstracts were retrieved for "
            f"{clean_drug} and {clean_event}; literature and label synthesis was skipped "
            f"so the model does not answer from parametric memory [STATS]."
        )
        alt_sentences = [
            f"In the loaded dataset, {clean_drug} has a={safe_stats['case_count_a']} co-reports with {clean_event} (PRR={safe_stats['PRR']}, IC025={safe_stats['IC025']}, EB05={safe_stats['EB05']}), which may reflect confounding by indication, co-medications, or stimulated reporting rather than a drug effect [STATS]."
        ]
        next_steps_raw = [
            f"Verify active ingredient mapping for {clean_drug} and search FDA DailyMed / EMA SmPC manually [STATS].",
            f"Perform clinical case-level medical review of dechallenge/rechallenge and time-to-onset for {clean_drug} and {clean_event} [STATS].",
            f"Assess potential confounding by indication and concomitant medications for {clean_drug} [STATS].",
        ]
        ver_lit = verify_draft_sentences([no_source_msg], valid_source_ids)
        ver_alt = verify_draft_sentences(alt_sentences, valid_source_ids)
        ver_steps = verify_draft_sentences(next_steps_raw, valid_source_ids)
        draft_obj: dict[str, Any] = {
            "is_draft_for_human_review": True,
            "human_review_notice": (
                "DRAFT FOR HUMAN REVIEW — Generated from aggregate statistics and retrieved "
                "public sources only. Signals are hypotheses, not causal findings."
            ),
            "model_name": "retrieval-only (no public sources found)",
            "prompt_version": PROMPT_VERSION_ASSESSMENT,
            "retrieval_timestamp": retrieval_ts,
            "provenance": {
                "model_name": "retrieval-only (no public sources found)",
                "prompt_version": PROMPT_VERSION_ASSESSMENT,
                "retrieval_timestamp": retrieval_ts,
                "estimated_cost_usd": 0.0,
                "valid_sources": sorted(valid_source_ids),
                "sentences_total": len(ver_lit) + len(ver_alt),
                "sentences_verified": sum(1 for s in ver_lit + ver_alt if s["verified"]),
            },
            "drug": clean_drug,
            "adverse_event": clean_event,
            "statistics": safe_stats,
            "label_status": label_status,
            "pubmed_articles": [],
            "retrieval_empty": True,
            "literature_summary": ver_lit,
            "alternative_explanations": ver_alt,
            "suggested_next_steps": [s["sentence"] for s in ver_steps],
            "sections": {
                "literature_summary": ver_lit,
                "plausible_alternative_explanations": ver_alt,
                "suggested_next_steps": ver_steps,
            },
        }
        draft_obj["markdown"] = draft_to_markdown(draft_obj)
        return draft_obj

    lit_candidates: list[str] = []
    if label_status["is_labelled"]:
        sec = label_status["matched_section"]
        lit_candidates.append(
            f"The retrieved openFDA product label for {clean_drug} lists '{label_status['matched_term']}' under the {sec} section [LABEL:{sec}]."
        )
    else:
        avail_secs = [
            s
            for s in ("boxed_warning", "warnings", "adverse_reactions")
            if f"LABEL:{s}" in valid_source_ids
        ]
        if avail_secs:
            sec_tag = f"LABEL:{avail_secs[0]}"
            lit_candidates.append(
                f"Across the retrieved openFDA product label sections ({', '.join(avail_secs)}) for {clean_drug}, neither '{clean_event}' nor its clinical synonyms were matched [{sec_tag}]."
            )

    for art in eff_pubmed[:5]:
        pmid = art["pmid"]
        yr = art.get("year", "n.d.")
        title = art.get("title", "").rstrip(".")
        lit_candidates.append(
            f'Published literature ({yr}) indexed under PubMed reports on {clean_drug} and {clean_event}: "{title}" [PMID:{pmid}].'
        )

    if not eff_pubmed:
        avail_sec = next((s for s in valid_source_ids if s.startswith("LABEL:")), "STATS")
        lit_candidates.append(
            f"PubMed E-utilities retrieval returned 0 abstracts co-mentioning {clean_drug} and {clean_event} in Title/Abstract; assessment relies on retrieved product labelling and aggregate disproportionality metrics [{avail_sec}] [STATS]."
        )

    alt_candidates: list[str] = [
        f"Aggregate disproportionality metrics for {clean_drug} and {clean_event} (a={safe_stats['case_count_a']}, PRR={safe_stats['PRR']}, ROR={safe_stats['ROR']}, IC025={safe_stats['IC025']}, EB05={safe_stats['EB05']}, BH q={safe_stats['q_value']}) measure relative reporting frequency and cannot establish clinical incidence or causality [STATS].",
    ]
    if safe_stats.get("PRR_MH") is not None:
        alt_candidates.append(
            f"Age- and sex-stratified Mantel-Haenszel adjustment for {clean_drug} and {clean_event} yields PRR_MH={safe_stats['PRR_MH']} compared with pooled PRR={safe_stats['PRR']}, which should be evaluated alongside indication and co-prescription confounding [STATS]."
        )
    if "LABEL:warnings" in valid_source_ids:
        alt_candidates.append(
            f"Co-morbidities, concomitant medications, and disease severity warnings in the {clean_drug} product label may contribute to channelled prescribing and stimulated reporting of {clean_event} [LABEL:warnings] [STATS]."
        )
    elif "LABEL:adverse_reactions" in valid_source_ids:
        alt_candidates.append(
            f"Background adverse reaction rates in treated patient populations and notoriety bias following regulatory communications can elevate spontaneous reporting ratios for {clean_drug} and {clean_event} [LABEL:adverse_reactions] [STATS]."
        )

    steps_candidates: list[str] = [
        f"Review full FDA SPL prescribing information for {clean_drug} and compare global labelling (EMA SmPC / PMDA) regarding {clean_event} [STATS].",
        f"Evaluate clinical case narratives, dechallenge/rechallenge, and Weibull time-to-onset profile for {clean_drug} and {clean_event} [STATS].",
        f"Assess confounding by indication (underlying disease) and concomitant therapy interactions (Omega DDI screen) for {clean_drug} [STATS].",
    ]

    model_used = "deterministic-grounded-synthesis"
    est_cost = 0.0

    api_key = (
        os.environ.get("NLP_LLM_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()

    if use_llm and api_key:
        endpoint = os.environ.get(
            "NLP_LLM_ENDPOINT",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        ).strip()
        model_name = os.environ.get("NLP_LLM_MODEL", DEFAULT_LLM_MODEL).strip()

        prompt_context = {
            "aggregate_statistics": safe_stats,
            "deterministic_label_status": label_status,
            "retrieved_label_sections": {
                k: v[:1200] for k, v in sections.items() if v and v.strip()
            },
            "retrieved_pubmed_abstracts": [
                {
                    "pmid": a["pmid"],
                    "year": a.get("year"),
                    "title": a["title"],
                    "abstract": a["abstract"][:500],
                }
                for a in eff_pubmed[:8]
            ],
            "allowed_citation_tags": sorted(valid_source_ids),
        }
        system_prompt = (
            "You are a pharmacovigilance signal assessment assistant creating a DRAFT for human QPPV review. "
            "RULES:\n"
            "1. Use ONLY the provided aggregate_statistics, retrieved_label_sections, and retrieved_pubmed_abstracts.\n"
            "2. Every single sentence in `literature_summary` and `alternative_explanations` MUST end with one or more exact citation tags from `allowed_citation_tags`, formatted as [LABEL:boxed_warning], [LABEL:warnings], [LABEL:adverse_reactions], [PMID:123456], or [STATS].\n"
            "3. NEVER state that the drug causes the adverse event. Frame all findings as statistical associations or hypotheses requiring clinical review.\n"
            "4. Do NOT recompute any statistics.\n"
            "Return JSON with keys: `literature_summary` (array of cited sentences), `alternative_explanations` (array of cited sentences), `suggested_next_steps` (array of strings)."
        )
        user_msg = json.dumps(prompt_context)
        try:
            est_cost = check_spending_cap(len(system_prompt) + len(user_msg), MAX_OUTPUT_TOKENS)
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                "response_format": {"type": "json_object"},
                "max_tokens": MAX_OUTPUT_TOKENS,
                "temperature": 0.0,
            }
            req = Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                method="POST",
            )
            with urlopen(req, timeout=18.0) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
            parsed = json.loads(resp_data["choices"][0]["message"]["content"])
            if isinstance(parsed.get("literature_summary"), list) and parsed["literature_summary"]:
                lit_candidates = [str(x) for x in parsed["literature_summary"]]
            if isinstance(parsed.get("alternative_explanations"), list) and parsed["alternative_explanations"]:
                alt_candidates = [str(x) for x in parsed["alternative_explanations"]]
            model_used = model_name
        except Exception:
            pass

    verified_lit = verify_draft_sentences(lit_candidates, valid_source_ids)
    verified_alt = verify_draft_sentences(alt_candidates, valid_source_ids)
    verified_steps = verify_draft_sentences(steps_candidates, valid_source_ids)

    all_checked = verified_lit + verified_alt
    supported_count = sum(1 for s in all_checked if s["verified"])

    draft_obj = {
        "is_draft_for_human_review": True,
        "human_review_notice": (
            "DRAFT FOR HUMAN REVIEW — Generated from aggregate statistics and retrieved "
            "public sources only. Signals are hypotheses, not causal findings."
        ),
        "model_name": model_used,
        "prompt_version": PROMPT_VERSION_ASSESSMENT,
        "retrieval_timestamp": retrieval_ts,
        "provenance": {
            "model_name": model_used,
            "prompt_version": PROMPT_VERSION_ASSESSMENT,
            "retrieval_timestamp": retrieval_ts,
            "estimated_cost_usd": est_cost,
            "valid_sources": sorted(valid_source_ids),
            "sentences_total": len(all_checked),
            "sentences_verified": supported_count,
        },
        "drug": clean_drug,
        "adverse_event": clean_event,
        "statistics": safe_stats,
        "label_status": label_status,
        "pubmed_articles": eff_pubmed,
        "retrieval_empty": False,
        "literature_summary": verified_lit,
        "alternative_explanations": verified_alt,
        "suggested_next_steps": [s["sentence"] for s in verified_steps],
        "sections": {
            "literature_summary": verified_lit,
            "plausible_alternative_explanations": verified_alt,
            "suggested_next_steps": verified_steps,
        },
    }
    draft_obj["markdown"] = draft_to_markdown(draft_obj)
    return draft_obj


def draft_to_markdown(draft: dict[str, Any]) -> str:
    """Format a verified Signal Assessment Draft as exportable Markdown."""
    prov = draft["provenance"]
    st = draft["statistics"]
    lbl = draft["label_status"]

    lines = [
        f"# Signal Assessment Draft: {draft['drug']} — {draft['adverse_event']}",
        "",
        f"> **{draft['human_review_notice']}**",
        "",
        "## Provenance & Audit Metadata",
        f"- **Model:** `{prov['model_name']}`",
        f"- **Prompt version:** `{prov['prompt_version']}`",
        f"- **Retrieval timestamp (UTC):** `{prov['retrieval_timestamp']}`",
        f"- **Verified citations:** `{prov.get('sentences_verified', len(draft['literature_summary']))}/{prov.get('sentences_total', len(draft['literature_summary']))} sentences verified against retrieved sources`",
        "",
        "## 1. Aggregate Disproportionality Statistics (Passed In, Not Recomputed)",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Co-reported cases ($a$) | {st['case_count_a']} |",
        f"| Drug total reports ($a+b$) | {st['drug_total_reports']} |",
        f"| Event total reports ($a+c$) | {st['event_total_reports']} |",
        f"| PRR (Mantel–Haenszel PRR_MH) | {st['PRR']} ({st.get('PRR_MH') if st.get('PRR_MH') is not None else '—'}) |",
        f"| ROR [95% CI] | {st['ROR']} [{st['ROR_95CI_low']}, {st['ROR_95CI_high']}] |",
        f"| Yates chi-square (p-value / BH q-value) | {st['chi_square']} (p={st['p_value']}, q={st['q_value']}) |",
        f"| BCPNN IC (IC025) | {st['IC']} ({st['IC025']}) |",
        f"| MGPS EBGM (EB05) | {st['EBGM']} ({st['EB05']}) |",
        "",
        "## 2. Deterministic Product Label Status (openFDA SPL Retrieval)",
        f"- **Labelled status:** `{'ALREADY LABELLED' if lbl['is_labelled'] else lbl['status'].upper()}`",
        f"- **Method:** `{lbl['method']}` ({lbl['explanation']})",
    ]
    if lbl.get("matched_section"):
        lines.append(
            f"- **Matched section:** `{lbl['matched_section']}` (matched term: `{lbl.get('matched_term')}`)"
        )
    if lbl.get("excerpt"):
        lines.extend(["", f"> **Label Excerpt:** {lbl['excerpt']}"])

    lines.extend(["", "## 3. Verified Literature & Retrieval Summary"])
    for item in draft["literature_summary"]:
        if item.get("verified"):
            lines.append(f"- {item['sentence']}")
        else:
            lines.append(f"- *[Dropped — unverified citation ({item.get('status')})]*")

    if draft.get("pubmed_articles"):
        lines.extend(["", "### Retrieved PubMed Abstracts (Newest First)"])
        for art in draft["pubmed_articles"][:10]:
            lines.append(f"- **PMID:{art['pmid']}** ({art.get('year', 'n.d.')}): {art['title']}")

    lines.extend(["", "## 4. Plausible Alternative Explanations (Non-Causal Hypotheses)"])
    for item in draft["alternative_explanations"]:
        if item.get("verified"):
            lines.append(f"- {item['sentence']}")

    lines.extend(["", "## 5. Suggested Next Steps for Human Review"])
    for step in draft["suggested_next_steps"]:
        lines.append(f"1. {step}")

    lines.extend(
        [
            "",
            "---",
            "*Disclaimer: Spontaneous reporting signals are hypotheses, not causal findings. Does not establish that the drug causes the adverse event.*",
        ]
    )
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# 5. Ask Your Data: Strict JSON Filter Schema, Validator, Translator & Executor
# ---------------------------------------------------------------------------

ALLOWED_FILTER_FIELDS: dict[str, dict[str, Any]] = {
    "drug": {"type": "string", "ops": {"eq", "neq", "contains", "in"}},
    "adverse_event": {"type": "string", "ops": {"eq", "neq", "contains", "in"}},
    "case_count_a": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "drug_total_reports": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "event_total_reports": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "PRR": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "PRR_MH": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "ROR": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "ROR_95CI_low": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "chi_square": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "p_value": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "q_value": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "IC": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "IC025": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "EBGM": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "EB05": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "priority_score": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "priority_rank": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "weibull_shape": {"type": "number", "ops": {"eq", "gt", "gte", "lt", "lte"}},
    "serious_event": {"type": "boolean", "ops": {"eq"}},
    "signal_detected": {"type": "boolean", "ops": {"eq"}},
    "signal_bcpnn": {"type": "boolean", "ops": {"eq"}},
    "signal_ebgm": {"type": "boolean", "ops": {"eq"}},
    "signal_fdr": {"type": "boolean", "ops": {"eq"}},
    "confounding_flagged": {"type": "boolean", "ops": {"eq"}},
    "weibull_regime": {"type": "string", "ops": {"eq", "neq"}},
}

ALLOWED_SORT_FIELDS = {
    "case_count_a",
    "PRR",
    "PRR_MH",
    "ROR",
    "chi_square",
    "p_value",
    "q_value",
    "IC",
    "IC025",
    "EBGM",
    "EB05",
    "priority_score",
    "priority_rank",
    "weibull_shape",
}

_OP_ALIASES: dict[str, str] = {
    "=": "eq",
    "==": "eq",
    "eq": "eq",
    "!=": "neq",
    "<>": "neq",
    "neq": "neq",
    ">": "gt",
    "gt": "gt",
    ">=": "gte",
    "≥": "gte",
    "gte": "gte",
    "<": "lt",
    "lt": "lt",
    "<=": "lte",
    "≤": "lte",
    "lte": "lte",
    "contains": "contains",
    "in": "in",
}


def validate_signal_filter(raw: dict[str, Any]) -> dict[str, Any]:
    """
    Strictly validate a JSON filter against `ALLOWED_FILTER_FIELDS` and `ALLOWED_SORT_FIELDS`.
    Raises ValueError on any unknown field, unknown operator, or invalid value type.
    """
    if not isinstance(raw, dict):
        raise ValueError("Filter payload must be a JSON object.")

    raw_clauses = raw.get("clauses")
    if not isinstance(raw_clauses, list):
        raise ValueError("Filter must contain a `clauses` array.")

    validated_clauses: list[dict[str, Any]] = []
    for item in raw_clauses:
        if not isinstance(item, dict):
            raise ValueError("Each filter clause must be a JSON object.")
        field = str(item.get("field") or "").strip()
        raw_op = str(item.get("op") or "").strip().lower()
        op = _OP_ALIASES.get(raw_op, raw_op)
        val = item.get("value")

        if field not in ALLOWED_FILTER_FIELDS:
            raise ValueError(f"Disallowed filter field: '{field}'")
        spec = ALLOWED_FILTER_FIELDS[field]
        if op not in spec["ops"]:
            raise ValueError(f"Disallowed operator '{raw_op}' for field '{field}'")

        ftype = spec["type"]
        if ftype == "boolean":
            if not isinstance(val, bool):
                raise ValueError(f"Field '{field}' requires a boolean value.")
            clean_val: Any = bool(val)
        elif ftype == "number":
            if (
                isinstance(val, bool)
                or not isinstance(val, (int, float))
                or not math.isfinite(float(val))
            ):
                raise ValueError(f"Field '{field}' requires a finite numeric value.")
            fval = float(val)
            clean_val = int(fval) if fval.is_integer() else fval
        elif ftype == "string":
            if op == "in":
                if not isinstance(val, list) or not all(isinstance(x, str) for x in val):
                    raise ValueError(f"Operator 'in' on '{field}' requires a list of strings.")
                clean_val = [
                    canonicalize_drug(x) if field == "drug" else x.strip().upper()
                    for x in val
                ]
            else:
                if not isinstance(val, str) or not val.strip():
                    raise ValueError(f"Field '{field}' requires a non-empty string value.")
                if field == "drug" and op in ("eq", "neq"):
                    clean_val = canonicalize_drug(val)
                elif field == "weibull_regime":
                    clean_val = val.strip().lower()
                else:
                    clean_val = val.strip().upper()
        else:
            raise ValueError(f"Unsupported field type '{ftype}'")

        validated_clauses.append({"field": field, "op": op, "value": clean_val})

    sort_by = raw.get("sort_by")
    if sort_by is not None:
        sort_by = str(sort_by).strip()
        if sort_by not in ALLOWED_SORT_FIELDS:
            raise ValueError(f"Disallowed sort_by field: '{sort_by}'")

    sort_dir = str(raw.get("sort_dir") or "desc").strip().lower()
    if sort_dir not in ("asc", "desc"):
        raise ValueError("sort_dir must be 'asc' or 'desc'")

    limit = raw.get("limit")
    if limit is not None:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > 500:
            raise ValueError("limit must be an integer between 1 and 500")

    return {
        "clauses": validated_clauses,
        "sort_by": sort_by,
        "sort_dir": sort_dir,
        "limit": limit,
    }


def apply_signal_filter(
    signals: Sequence[dict[str, Any]],
    validated_filter: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Apply a validated JSON filter to an in-memory list of signal rows using
    ordinary Python code (never eval, exec, or SQL).
    """
    clauses = validated_filter.get("clauses") or []
    out: list[dict[str, Any]] = []

    for row in signals:
        matched = True
        for c in clauses:
            field = c["field"]
            op = _OP_ALIASES.get(str(c["op"]).lower(), str(c["op"]).lower())
            target = c["value"]
            actual = row.get(field)

            if actual is None:
                matched = False
                break

            if op == "eq":
                if isinstance(target, str):
                    if str(actual).upper() != target.upper():
                        matched = False
                        break
                else:
                    if actual != target:
                        matched = False
                        break
            elif op == "neq":
                if isinstance(target, str):
                    if str(actual).upper() == target.upper():
                        matched = False
                        break
                else:
                    if actual == target:
                        matched = False
                        break
            elif op == "contains":
                if str(target).upper() not in str(actual).upper():
                    matched = False
                    break
            elif op == "in":
                if str(actual).upper() not in {str(x).upper() for x in target}:
                    matched = False
                    break
            elif op == "gt":
                if not (float(actual) > float(target)):
                    matched = False
                    break
            elif op == "gte":
                if not (float(actual) >= float(target)):
                    matched = False
                    break
            elif op == "lt":
                if not (float(actual) < float(target)):
                    matched = False
                    break
            elif op == "lte":
                if not (float(actual) <= float(target)):
                    matched = False
                    break
        if matched:
            out.append(row)

    sort_by = validated_filter.get("sort_by")
    if sort_by:
        reverse = validated_filter.get("sort_dir", "desc") == "desc"
        out.sort(
            key=lambda r: (
                r.get(sort_by) is not None,
                float(r.get(sort_by) or 0.0),
            ),
            reverse=reverse,
        )

    limit = validated_filter.get("limit")
    if limit is not None:
        out = out[: int(limit)]

    return out


_KNOWN_DRUG_NAMES = [
    "WARFARIN",
    "ASPIRIN",
    "IBUPROFEN",
    "ATORVASTATIN",
    "SIMVASTATIN",
    "LISINOPRIL",
    "METFORMIN",
    "OMEPRAZOLE",
    "AMOXICILLIN",
    "PREDNISONE",
    "APROTININ",
    "CLOPIDOGREL",
    "FUROSEMIDE",
    "AMLODIPINE",
    "SERTRALINE",
    "ACETAMINOPHEN",
    "CIPROFLOXACIN",
    "AMIODARONE",
    "DIGOXIN",
    "DABIGATRAN",
    "APIXABAN",
    "RIVAROXABAN",
    "LORATADINE",
    "LEVOTHYROXINE",
    "MONTELUKAST",
    "METOPROLOL",
    "HYDROCHLOROTHIAZIDE",
    "FINASTERIDE",
    "ISOTRETINOIN",
]

_KNOWN_EVENT_TERMS = [
    "GASTROINTESTINAL HAEMORRHAGE",
    "RHABDOMYOLYSIS",
    "HEPATIC FAILURE",
    "ANAPHYLACTIC REACTION",
    "ANGIOEDEMA",
    "ACUTE KIDNEY INJURY",
    "LACTIC ACIDOSIS",
    "SUICIDAL IDEATION",
    "TENDON RUPTURE",
    "STEVENS-JOHNSON SYNDROME",
    "CONGENITAL ANOMALY",
    "AGRANULOCYTOSIS",
    "PULMONARY FIBROSIS",
    "RETINAL DETACHMENT",
    "PERIPHERAL NEUROPATHY",
    "MYOPATHY",
    "PANCREATITIS",
    "DYSPNOEA",
    "NAUSEA",
    "HEADACHE",
    "DIZZINESS",
    "RASH",
    "COUGH",
]


def parse_nl_query_deterministic(question: str) -> dict[str, Any]:
    """
    Deterministic natural-language-to-JSON-filter parser covering standard
    pharmacovigilance queries over the signals table.
    """
    q_raw = question.strip()
    q_low = q_raw.lower()
    clauses: list[dict[str, Any]] = []
    sort_by: str = "priority_rank"
    sort_dir: str = "asc"
    limit: int | None = None

    # 1. Drug match ("for <drug>", "of <drug>", "with drug <drug>", or known drug token)
    matched_drug: str | None = None
    for d in _KNOWN_DRUG_NAMES:
        if re.search(r"\b" + re.escape(d.lower()) + r"\b", q_low):
            matched_drug = d
            break
    if not matched_drug:
        for token in re.findall(r"[A-Za-z]{4,}", q_raw):
            canon = canonicalize_drug(token)
            if canon in _KNOWN_DRUG_NAMES and canon != token.upper():
                matched_drug = canon
                break

    if matched_drug:
        if re.search(
            r"\b(?:excluding|except|not\s+for|other\s+than)\s+" + re.escape(matched_drug.lower()),
            q_low,
        ):
            clauses.append({"field": "drug", "op": "neq", "value": matched_drug})
        else:
            clauses.append({"field": "drug", "op": "eq", "value": matched_drug})

    # 2. Adverse event match
    m_ev_contains = re.search(
        r"\bevents?\s+(?:containing|like|matching)\s+\"?([a-zA-Z\s]+?)\"?(?:\s+with|\s+where|\s+sorted|\s+flagged|\s+not|$)",
        q_raw,
        re.IGNORECASE,
    )
    if m_ev_contains:
        clauses.append(
            {
                "field": "adverse_event",
                "op": "contains",
                "value": m_ev_contains.group(1).strip().upper(),
            }
        )
    elif (
        "gi bleed" in q_low
        or "gi haemorrhage" in q_low
        or "gi hemorrhage" in q_low
        or "gastrointestinal bleed" in q_low
    ):
        clauses.append({"field": "adverse_event", "op": "contains", "value": "HAEMORRHAGE"})
    else:
        for ev in _KNOWN_EVENT_TERMS:
            if ev.lower() in q_low:
                clauses.append({"field": "adverse_event", "op": "eq", "value": ev})
                break
        else:
            if "haemorrhage" in q_low or "hemorrhage" in q_low or "bleeding" in q_low:
                clauses.append({"field": "adverse_event", "op": "contains", "value": "HAEMORRHAGE"})

    # 3. Seriousness
    if re.search(r"\bnon[-\s]?serious\b|\bnot\s+serious\b", q_low):
        clauses.append({"field": "serious_event", "op": "eq", "value": False})
    elif re.search(r"\bserious\b", q_low):
        clauses.append({"field": "serious_event", "op": "eq", "value": True})

    # 4. Signal flags (PRR, BCPNN, EBGM, FDR)
    if re.search(
        r"\b(?:not\s+flagged\s+by\s+prr|unflagged\s+by\s+prr|missed\s+by\s+prr|without\s+prr\s+signal|prr\s+signal\s+is\s+false)\b",
        q_low,
    ):
        clauses.append({"field": "signal_detected", "op": "eq", "value": False})
    elif re.search(
        r"\b(?:flagged\s+by\s+prr|prr\s+signals?|meeting\s+prr\s+threshold|detected\s+by\s+prr)\b",
        q_low,
    ):
        clauses.append({"field": "signal_detected", "op": "eq", "value": True})

    if re.search(
        r"\b(?:not\s+flagged\s+by\s+bcpnn|without\s+bcpnn\s+signal|not\s+bcpnn\s+signal)\b",
        q_low,
    ):
        clauses.append({"field": "signal_bcpnn", "op": "eq", "value": False})
    elif re.search(r"\b(?:flagged\s+by\s+bcpnn|bcpnn\s+signals?|ic025\s+signals?)\b", q_low):
        clauses.append({"field": "signal_bcpnn", "op": "eq", "value": True})

    if re.search(
        r"\b(?:not\s+flagged\s+by\s+ebgm|without\s+ebgm\s+signal|not\s+ebgm\s+signal)\b",
        q_low,
    ):
        clauses.append({"field": "signal_ebgm", "op": "eq", "value": False})
    elif re.search(r"\b(?:flagged\s+by\s+ebgm|ebgm\s+signals?|mgps\s+signals?)\b", q_low):
        clauses.append({"field": "signal_ebgm", "op": "eq", "value": True})

    if re.search(
        r"\b(?:not\s+fdr\s+significant|not\s+flagged\s+by\s+fdr|failing\s+fdr)\b",
        q_low,
    ):
        clauses.append({"field": "signal_fdr", "op": "eq", "value": False})
    elif re.search(
        r"\b(?:fdr\s+significant|flagged\s+by\s+fdr|fdr\s+signals?|bh\s+fdr\s+signals?|surviving\s+fdr)\b",
        q_low,
    ):
        clauses.append({"field": "signal_fdr", "op": "eq", "value": True})

    # 5. Confounding flag
    if re.search(r"\b(?:no\s+confounding|without\s+confounding|unconfounded|non[-\s]?confounded)\b", q_low):
        clauses.append({"field": "confounding_flagged", "op": "eq", "value": False})
    elif re.search(
        r"\b(?:confounded|confounding\s+flagged|demographic\s+confounding|material\s+disagreement)\b",
        q_low,
    ):
        clauses.append({"field": "confounding_flagged", "op": "eq", "value": True})

    # 6. Weibull regime
    if "early failure" in q_low or "early-failure" in q_low or "decreasing hazard" in q_low:
        clauses.append({"field": "weibull_regime", "op": "eq", "value": "early_failure"})
    elif "wear out" in q_low or "wear-out" in q_low or "increasing hazard" in q_low:
        clauses.append({"field": "weibull_regime", "op": "eq", "value": "wear_out"})
    elif "random hazard" in q_low or "constant hazard" in q_low:
        clauses.append({"field": "weibull_regime", "op": "eq", "value": "random"})

    # 7. Case count thresholds
    m_cases_gte = re.search(
        r"(?:at\s+least|minimum\s+of|min|>=|≥)\s*(\d+)\s*(?:cases|reports)\b", q_low
    )
    m_cases_gt = re.search(
        r"(?:more\s+than|over|greater\s+than|>)\s*(\d+)\s*(?:cases|reports)\b", q_low
    )
    m_cases_lte = re.search(
        r"(?:at\s+most|no\s+more\s+than|<=|≤)\s*(\d+)\s*(?:cases|reports)\b", q_low
    )
    m_cases_lt = re.search(
        r"(?:fewer\s+than|less\s+than|under|<)\s*(\d+)\s*(?:cases|reports)\b", q_low
    )
    m_cases_eq = re.search(r"\bexactly\s+(\d+)\s*(?:cases|reports)\b", q_low)

    if m_cases_gte:
        clauses.append({"field": "case_count_a", "op": "gte", "value": int(m_cases_gte.group(1))})
    elif m_cases_gt:
        clauses.append({"field": "case_count_a", "op": "gt", "value": int(m_cases_gt.group(1))})
    if m_cases_lte:
        clauses.append({"field": "case_count_a", "op": "lte", "value": int(m_cases_lte.group(1))})
    elif m_cases_lt:
        clauses.append({"field": "case_count_a", "op": "lt", "value": int(m_cases_lt.group(1))})
    if m_cases_eq:
        clauses.append({"field": "case_count_a", "op": "eq", "value": int(m_cases_eq.group(1))})

    # 8. Metric numeric comparisons
    metric_patterns = [
        ("PRR_MH", r"\b(?:prr_mh|mantel[-\s]haenszel\s+prr|adjusted\s+prr)\b"),
        ("PRR", r"\bprr(?!_mh)\b"),
        ("ROR", r"\bror\b"),
        ("IC025", r"\bic025\b"),
        ("IC", r"\bic\b(?!025)"),
        ("EB05", r"\beb05\b"),
        ("EBGM", r"\bebgm\b"),
        ("q_value", r"\b(?:q_value|q[-\s]value|fdr\s+q|q)\b"),
        ("p_value", r"\b(?:p_value|p[-\s]value)\b"),
        ("chi_square", r"\b(?:chi_square|chi[-\s]square|chi2|χ²)\b"),
        ("priority_score", r"\b(?:priority_score|priority\s+score|ml\s+score)\b"),
        ("priority_rank", r"\b(?:priority_rank|priority\s+rank|ml\s+rank)\b"),
        ("weibull_shape", r"\b(?:weibull_shape|weibull\s+shape|shape\s+k)\b"),
    ]

    for field_name, pat in metric_patterns:
        m_gte = re.search(
            pat + r"\s*(?:at\s+least|>=|≥|of\s+at\s+least)\s*(-?\d+(?:\.\d+)?)", q_low
        )
        m_gt = re.search(
            pat + r"\s*(?:above|greater\s+than|over|exceeding|>)\s*(-?\d+(?:\.\d+)?)", q_low
        )
        m_lte = re.search(
            pat + r"\s*(?:at\s+most|<=|≤|no\s+more\s+than)\s*(-?\d+(?:\.\d+)?)", q_low
        )
        m_lt = re.search(
            pat + r"\s*(?:below|less\s+than|under|<)\s*(-?\d+(?:\.\d+)?)", q_low
        )
        if m_gte:
            v = float(m_gte.group(1))
            clauses.append(
                {"field": field_name, "op": "gte", "value": int(v) if v.is_integer() else v}
            )
        elif m_gt:
            v = float(m_gt.group(1))
            clauses.append(
                {"field": field_name, "op": "gt", "value": int(v) if v.is_integer() else v}
            )
        if m_lte:
            v = float(m_lte.group(1))
            clauses.append(
                {"field": field_name, "op": "lte", "value": int(v) if v.is_integer() else v}
            )
        elif m_lt:
            v = float(m_lt.group(1))
            clauses.append(
                {"field": field_name, "op": "lt", "value": int(v) if v.is_integer() else v}
            )

    # 9. Sorting and top-K limit
    m_top = re.search(r"\b(?:top|first|limit)\s+(\d+)\b", q_low)
    if m_top:
        limit = int(m_top.group(1))

    sort_map = [
        (
            "priority_score",
            r"\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:priority_score|priority\s+score|ml\s+score)|highest\s+priority)\b",
        ),
        (
            "priority_rank",
            r"\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:priority_rank|priority\s+rank|rank|ml\s+rank))\b",
        ),
        (
            "PRR_MH",
            r"\b(?:sorted|ordered|ranked)\s+by\s+(?:prr_mh|adjusted\s+prr|mantel[-\s]haenszel)\b",
        ),
        ("PRR", r"\b(?:(?:sorted|ordered|ranked)\s+by\s+prr|highest\s+prr)\b"),
        ("ROR", r"\b(?:(?:sorted|ordered|ranked)\s+by\s+ror|highest\s+ror)\b"),
        ("EB05", r"\b(?:(?:sorted|ordered|ranked)\s+by\s+eb05|highest\s+eb05)\b"),
        ("EBGM", r"\b(?:(?:sorted|ordered|ranked)\s+by\s+ebgm|highest\s+ebgm)\b"),
        ("IC025", r"\b(?:(?:sorted|ordered|ranked)\s+by\s+ic025|highest\s+ic025)\b"),
        ("IC", r"\b(?:(?:sorted|ordered|ranked)\s+by\s+ic\b|highest\s+ic\b)"),
        (
            "chi_square",
            r"\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:chi_square|chi[-\s]square|chi2)|highest\s+chi)\b",
        ),
        (
            "case_count_a",
            r"\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:case\s+count|cases)|most\s+cases|highest\s+count)\b",
        ),
        (
            "q_value",
            r"\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:q_value|q[-\s]value|fdr)|lowest\s+q[-\s]value)\b",
        ),
    ]
    for s_field, s_pat in sort_map:
        if re.search(s_pat, q_low):
            sort_by = s_field
            sort_dir = "asc" if s_field in ("q_value", "p_value", "priority_rank") else "desc"
            break

    if "ascending" in q_low or "lowest" in q_low or "smallest" in q_low:
        sort_dir = "asc"

    return validate_signal_filter(
        {
            "clauses": clauses,
            "sort_by": sort_by,
            "sort_dir": sort_dir,
            "limit": limit,
        }
    )


def translate_nl_query_to_filter(
    question: str,
    *,
    use_llm: bool = True,
) -> dict[str, Any]:
    """
    Translate a natural-language question into a validated JSON filter over the signals table.
    Uses the LLM when configured, validates against `validate_signal_filter`, and falls back
    to the deterministic parser (`parse_nl_query_deterministic`) if no LLM key is set or if
    the LLM output fails schema validation.
    """
    det_filter = parse_nl_query_deterministic(question)
    api_key = (
        os.environ.get("NLP_LLM_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()

    if not use_llm or not api_key:
        return {
            "question": question,
            "filter": det_filter,
            "translator": "deterministic-schema-parser",
            "prompt_version": PROMPT_VERSION_NL_FILTER,
        }

    endpoint = os.environ.get(
        "NLP_LLM_ENDPOINT",
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    ).strip()
    model_name = os.environ.get("NLP_LLM_MODEL", DEFAULT_LLM_MODEL).strip()

    system_prompt = (
        "Translate the user's pharmacovigilance question into a strict JSON filter object over the signals table.\n"
        f"Allowed fields and operators: {json.dumps({k: {'type': v['type'], 'ops': sorted(v['ops'])} for k, v in ALLOWED_FILTER_FIELDS.items()})}\n"
        f"Allowed sort_by fields: {sorted(ALLOWED_SORT_FIELDS)}\n"
        'Return ONLY JSON matching: {"clauses": [{"field": "...", "op": "...", "value": ...}], "sort_by": null|string, "sort_dir": "asc"|"desc", "limit": null|int}.'
    )
    try:
        check_spending_cap(len(system_prompt) + len(question), 400)
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": 400,
            "temperature": 0.0,
        }
        req = Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        with urlopen(req, timeout=12.0) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
        parsed = json.loads(resp_data["choices"][0]["message"]["content"])
        validated = validate_signal_filter(parsed)
        return {
            "question": question,
            "filter": validated,
            "translator": model_name,
            "prompt_version": PROMPT_VERSION_NL_FILTER,
        }
    except Exception:
        return {
            "question": question,
            "filter": det_filter,
            "translator": "deterministic-schema-parser-fallback",
            "prompt_version": PROMPT_VERSION_NL_FILTER,
        }


# ---------------------------------------------------------------------------
# 6. Live Data from openFDA Count Queries -> Existing Disproportionality Code
# ---------------------------------------------------------------------------


def compute_disproportionality_from_counts(
    count_rows: Sequence[dict[str, Any]],
    total_reports: int,
    min_cases: int = 3,
    *,
    score: bool = True,
) -> pd.DataFrame:
    """
    Run the existing disproportionality & ML scoring pipeline on pre-aggregated
    2x2 count queries `(drug, adverse_event, a, drug_total, event_total)` from openFDA.
    Case-level ML features are unavailable in openFDA count mode and remain NaN/None
    (imputed at the training mean with 0 log-odds contribution).
    """
    from faers_signal_detection import SIGNAL_COLUMNS

    eligible = []
    for r in count_rows:
        a = int(r["a"])
        if a < min_cases:
            continue
        drug_total = int(r["drug_total"])
        event_total = int(r["event_total"])
        b = drug_total - a
        c = event_total - a
        d = total_reports - drug_total - event_total + a
        if b <= 0 or c <= 0 or d <= 0:
            continue
        eligible.append(
            {
                "drug": canonicalize_drug(str(r["drug"])),
                "adverse_event": normalize_pt(str(r["adverse_event"])),
                "a": a,
                "b": b,
                "c": c,
                "d": d,
                "drug_total_reports": drug_total,
                "event_total_reports": event_total,
            }
        )

    if not eligible:
        return pd.DataFrame(columns=SIGNAL_COLUMNS)

    eligible.sort(key=lambda x: (x["drug"], x["adverse_event"]))

    observed = np.array([s["a"] for s in eligible], dtype=float)
    expected = np.array(
        [(s["drug_total_reports"] * s["event_total_reports"]) / total_reports for s in eligible],
        dtype=float,
    )
    prior = fit_gamma_poisson_prior(observed, expected)

    results = []
    for s in eligible:
        a, b, c, d = s["a"], s["b"], s["c"], s["d"]
        drug_name, pt = s["drug"], s["adverse_event"]

        prr = (a / (a + b)) / (c / (c + d))
        ror = (a * d) / (b * c)
        contingency = np.array([[a, b], [c, d]])
        chi2, p_value, _, _ = stats.chi2_contingency(contingency, correction=True)

        se_log_ror = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
        log_ror = math.log(ror)
        ror_ci_low = math.exp(log_ror - 1.96 * se_log_ror)
        ror_ci_high = math.exp(log_ror + 1.96 * se_log_ror)

        bcp = bcpnn(a, b, c, d, total_reports)
        exp_a = expected_count(a, b, c, d, total_reports)
        ebg = ebgm_pair(a, exp_a, prior)

        results.append(
            {
                "drug": drug_name,
                "adverse_event": pt,
                "case_count_a": a,
                "drug_total_reports": s["drug_total_reports"],
                "event_total_reports": s["event_total_reports"],
                "PRR": _js_round(prr, 3),
                "ROR": _js_round(ror, 3),
                "ROR_95CI_low": _js_round(ror_ci_low, 3),
                "ROR_95CI_high": _js_round(ror_ci_high, 3),
                "chi_square": _js_round(float(chi2), 3),
                "p_value": _js_round(float(p_value), 6),
                "q_value": 1.0,
                "signal_fdr": False,
                "IC": bcp.ic,
                "IC025": bcp.ic025,
                "IC975": bcp.ic975,
                "signal_bcpnn": bcp.signal_bcpnn,
                "EBGM": ebg.ebgm,
                "EB05": ebg.eb05,
                "EB95": ebg.eb95,
                "signal_ebgm": ebg.signal_ebgm,
                "serious_event": pt in SERIOUS_ADVERSE_EVENTS,
                "signal_detected": bool((prr >= 2) and (chi2 >= 4) and (a >= min_cases)),
                "priority_score": None,
                "priority_rank": None,
                "priority_explain": None,
            }
        )

    q_vals = benjamini_hochberg([r["p_value"] for r in results])
    for idx, qv in enumerate(q_vals):
        results[idx]["q_value"] = qv
        results[idx]["signal_fdr"] = bool(
            (qv < 0.05)
            and (results[idx]["PRR"] >= 2.0)
            and (results[idx]["case_count_a"] >= min_cases)
        )

    output = pd.DataFrame(results)
    if score:
        from ml_prioritization import apply_prioritization, load_model

        output = apply_prioritization(output, load_model(), total_reports, case_features=None)

    return output.reindex(columns=SIGNAL_COLUMNS)


def fetch_openfda_drug_counts(
    drug: str,
    max_events: int = 25,
    min_cases: int = 3,
) -> dict[str, Any]:
    """
    Build 2x2 contingency tables for `drug` from live openFDA drug/event count queries:
      1. All reports N: `https://api.fda.gov/drug/event.json?limit=1`
      2. Drug total (a+b): `search=patient.drug.medicinalproduct:"<DRUG>"&limit=1`
      3. Pair counts (a): `search=patient.drug.medicinalproduct:"<DRUG>"&count=patient.reaction.reactionmeddrapt.exact`
      4. Global event counts (a+c): `count=patient.reaction.reactionmeddrapt.exact&limit=1000`
         (plus per-event fallback query for any reaction not in the top 1000 global list).
    """
    clean_drug = canonicalize_drug(drug).strip()
    if not clean_drug:
        raise ValueError("Drug name must not be empty.")

    cap = max(5, min(50, int(max_events)))
    cache_key = f"openfda_counts:{clean_drug}:{cap}:{min_cases}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    api_key = os.environ.get("OPENFDA_API_KEY", "").strip()

    def _fda_url(params: dict[str, str]) -> str:
        p = dict(params)
        if api_key:
            p["api_key"] = api_key
        return f"https://api.fda.gov/drug/event.json?{urlencode(p)}"

    total_reports = _cache_get("openfda_global_total")
    if total_reports is None:
        tot_data = _http_get_json(_fda_url({"limit": "1"}), timeout=10.0)
        total_reports = int(tot_data["meta"]["results"]["total"])
        _cache_set("openfda_global_total", total_reports)

    global_event_map: dict[str, int] | None = _cache_get("openfda_global_events_1000")
    if global_event_map is None:
        gev_data = _http_get_json(
            _fda_url({"count": "patient.reaction.reactionmeddrapt.exact", "limit": "1000"}),
            timeout=10.0,
        )
        global_event_map = {
            normalize_pt(item["term"]): int(item["count"])
            for item in (gev_data.get("results") or [])
            if item.get("term")
        }
        _cache_set("openfda_global_events_1000", global_event_map)

    search_expr = f'patient.drug.medicinalproduct:"{clean_drug}"'
    drug_tot_data = _http_get_json(_fda_url({"search": search_expr, "limit": "1"}), timeout=10.0)
    drug_total = int(drug_tot_data["meta"]["results"]["total"])

    pair_data = _http_get_json(
        _fda_url(
            {
                "search": search_expr,
                "count": "patient.reaction.reactionmeddrapt.exact",
                "limit": str(cap),
            }
        ),
        timeout=10.0,
    )
    raw_terms = pair_data.get("results") or []

    count_rows: list[dict[str, Any]] = []
    for item in raw_terms[:cap]:
        pt = normalize_pt(str(item.get("term") or ""))
        a = int(item.get("count") or 0)
        if not pt or a < min_cases:
            continue
        event_total = global_event_map.get(pt)
        if event_total is None:
            ev_cache_key = f"openfda_ev_tot:{pt}"
            event_total = _cache_get(ev_cache_key)
            if event_total is None:
                try:
                    time.sleep(0.08)
                    ev_data = _http_get_json(
                        _fda_url(
                            {"search": f'patient.reaction.reactionmeddrapt.exact:"{pt}"', "limit": "1"}
                        ),
                        timeout=8.0,
                    )
                    event_total = int(ev_data["meta"]["results"]["total"])
                    _cache_set(ev_cache_key, event_total)
                except Exception:
                    event_total = max(a + 1, int(a * (total_reports / max(1, drug_total))))
        count_rows.append(
            {
                "drug": clean_drug,
                "adverse_event": pt,
                "a": a,
                "drug_total": drug_total,
                "event_total": max(a + 1, int(event_total)),
            }
        )

    signals_df = compute_disproportionality_from_counts(
        count_rows,
        total_reports=total_reports,
        min_cases=min_cases,
        score=True,
    )

    payload = {
        "source": "openfda_live",
        "drug": clean_drug,
        "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_reports": total_reports,
        "drug_total_reports": drug_total,
        "count_rows": count_rows,
        "signals": signals_df.to_dict(orient="records"),
        "disclaimer": (
            "Counts retrieved live from the openFDA Drug Adverse Event API (api.fda.gov/drug/event.json). "
            "These are raw API report counts, NOT de-duplicated quarterly FAERS ASCII extracts, and include "
            "all drug roles (suspect and concomitant). Values will differ from an uploaded FAERS quarter. "
            "Case-level ML features (OUTC, INDI, THER, DEMO strata) are unavailable in live count mode."
        ),
    }
    _cache_set(cache_key, payload)
    return payload
