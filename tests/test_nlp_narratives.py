"""Tests for clinical narrative extraction, PII scrubbing, span validation, and benchmark fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from drug_mapping import canonicalize_drug, lookup_rxnorm_online
from main import (
    NlpExtractRequest,
    api_nlp_extract,
    redact_narrative_pii,
    validate_llm_extraction_payload,
)

ROOT = Path(__file__).resolve().parent.parent
GOLD_PATH = ROOT / "tests" / "narratives" / "gold_narratives.json"
BENCH_PATH = ROOT / "tests" / "narratives" / "benchmark_results.json"


def test_gold_narratives_fixture_structure() -> None:
    """Verify 60 synthetic narratives exist with >= 15 negated/historical/uncertain cases."""
    assert GOLD_PATH.exists(), "tests/narratives/gold_narratives.json must exist"
    narratives = json.loads(GOLD_PATH.read_text(encoding="utf-8"))
    assert len(narratives) == 60

    neg_or_hist_count = sum(
        1
        for item in narratives
        if len(item.get("gold", {}).get("negated_or_historical_reactions") or []) > 0
    )
    assert neg_or_hist_count >= 15, f"Expected >= 15 negated/historical/uncertain narratives, got {neg_or_hist_count}"

    # Verify N01 specifically tests negation of gastrointestinal haemorrhage
    n01 = narratives[0]
    assert "no evidence of gastrointestinal haemorrhage" in n01["text"].lower()
    assert "GASTROINTESTINAL HAEMORRHAGE" in n01["gold"]["negated_or_historical_reactions"]
    assert "GASTROINTESTINAL HAEMORRHAGE" not in n01["gold"]["active_reactions"]


def test_benchmark_results_reported() -> None:
    """Verify precision, recall, and F1 per entity type are recorded for legacy and local extractors."""
    assert BENCH_PATH.exists(), "tests/narratives/benchmark_results.json must exist"
    bench = json.loads(BENCH_PATH.read_text(encoding="utf-8"))
    assert bench["dataset_summary"]["total_narratives"] == 60
    assert bench["dataset_summary"]["negated_or_historical_or_uncertain_narratives"] >= 15

    legacy = bench["extractors"]["legacy_regex"]["metrics"]
    local = bench["extractors"]["local_extractor"]["metrics"]

    for key in (
        "suspect_drugs",
        "concomitant_drugs",
        "active_reactions",
        "negated_or_historical_reactions",
        "seriousness",
        "demographics",
        "clinical_course_and_reporter",
        "micro_overall",
    ):
        assert key in legacy
        assert key in local
        for metric_name in ("precision", "recall", "f1"):
            assert 0.0 <= legacy[key][metric_name] <= 1.0
            assert 0.0 <= local[key][metric_name] <= 1.0

    # Local extractor must substantially outperform legacy regex on active reactions and negation filtering
    assert local["active_reactions"]["f1"] > legacy["active_reactions"]["f1"]
    assert local["negated_or_historical_reactions"]["f1"] > 0.90
    assert legacy["negated_or_historical_reactions"]["f1"] == 0.0


def test_pii_redaction_strips_identifiers() -> None:
    """Ensure obvious identifiers (names, phones, MRNs, SSNs, exact DOBs) are scrubbed."""
    raw = (
        "Patient Johnathan Smith (MRN: 8492014, DOB: 04/19/1952, SSN 123-45-6789, "
        "Tel: 415-555-0198, email jsmith@example.org) seen by Dr. Alice Walker."
    )
    scrubbed = redact_narrative_pii(raw)
    assert "Johnathan Smith" not in scrubbed
    assert "8492014" not in scrubbed
    assert "04/19/1952" not in scrubbed
    assert "123-45-6789" not in scrubbed
    assert "415-555-0198" not in scrubbed
    assert "jsmith@example.org" not in scrubbed
    assert "Alice Walker" not in scrubbed


def test_llm_payload_validation_rejects_non_verbatim_spans() -> None:
    """Ensure spans that do not occur verbatim in the narrative are rejected."""
    narrative = "68-year-old male started Coumadin 5 mg daily and developed mild epistaxis. No evidence of haemorrhage."
    raw_llm = {
        "suspectDrugs": [
            {"verbatim": "Coumadin", "canonical": "WARFARIN", "dose": "5 mg daily", "confidence": 0.95},
            {"verbatim": "Apixaban", "canonical": "APIXABAN", "confidence": 0.90},  # Hallucinated!
        ],
        "concomitantDrugs": [],
        "reactions": [
            {"verbatim": "epistaxis", "mappedTerm": "EPISTAXIS", "negated": False, "confidence": 0.92},
            {"verbatim": "haemorrhage", "mappedTerm": "GASTROINTESTINAL HAEMORRHAGE", "negated": True, "confidence": 0.91},
            {"verbatim": "anaphylactic shock", "mappedTerm": "ANAPHYLACTIC REACTION", "negated": False, "confidence": 0.85},  # Hallucinated!
        ],
    }
    validated = validate_llm_extraction_payload(narrative, raw_llm)
    assert len(validated["suspectDrugs"]) == 1
    assert validated["suspectDrugs"][0]["canonical"] == "WARFARIN"
    assert validated["suspectDrugs"][0]["span"]["text"] == "Coumadin"

    assert len(validated["reactions"]) == 2
    reac_terms = [r["mappedTerm"] for r in validated["reactions"]]
    assert "EPISTAXIS" in reac_terms
    assert "ANAPHYLACTIC REACTION" not in reac_terms
    assert validated["requiresHumanReview"] is True


def test_expanded_drug_mapping_and_rxnorm_consent_gate() -> None:
    """Verify expanded local ingredient/brand dictionary and consent gating on online lookup."""
    assert canonicalize_drug("Eliquis tablets") == "APIXABAN"
    assert canonicalize_drug("Keppra hydrochloride") == "LEVETIRACETAM"
    assert canonicalize_drug("Synthroid") == "LEVOTHYROXINE"
    assert canonicalize_drug("Ozempic") == "SEMAGLUTIDE"

    # Without consent, online RxNav lookup must never perform a network call
    res = lookup_rxnorm_online("Eliquis", consent_granted=False)
    assert res["source"] == "local"
    assert res["normalized_name"] == "APIXABAN"
    assert res["rxcui"] is None


def test_api_nlp_extract_enforces_consent() -> None:
    """Verify POST /api/nlp/extract rejects requests without explicit consentConfirmed=True."""
    with pytest.raises(HTTPException) as exc_info:
        api_nlp_extract(
            NlpExtractRequest(
                narrative="Patient took Coumadin and had epistaxis.",
                consentConfirmed=False,
            )
        )
    assert exc_info.value.status_code == 400
    assert "consent" in str(exc_info.value.detail).lower()
