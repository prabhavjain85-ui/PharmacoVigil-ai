"""Offline unit tests for Signal Assessment Draft guardrails, citation verification,
deterministic SPL negation handling, and strict JSON filter schema validation.

Note: These tests use offline mock SPL / PubMed fixtures and template NL queries to test
deterministic guardrails and schema enforcement in CI without network access.
For the live evaluation against the real openFDA Drug Label API, real NCBI E-utilities
PubMed API, and independently paraphrased NL queries, run `scripts/evaluate_signal_copilot.py`.
"""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any, Dict, List
import unittest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from signal_copilot import (
    SlidingWindowRateLimiter,
    apply_signal_filter,
    check_spending_cap,
    determine_label_status,
    draft_to_markdown,
    generate_signal_assessment_draft,
    sanitize_causal_language,
    translate_nl_query_to_filter,
    validate_signal_filter,
    verify_draft_sentences,
)


MOCK_LABEL_EVALUATION_PAIRS: List[Dict[str, Any]] = [
    {
        "id": "MOCK_L01",
        "drug": "WARFARIN",
        "adverse_event": "GASTROINTESTINAL HAEMORRHAGE",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": (
                "WARNING: BLEEDING RISK. Warfarin sodium can cause major or fatal bleeding. "
                "Gastrointestinal hemorrhage and intracranial hemorrhage are the most frequent "
                "manifestations of major bleeding."
            ),
            "warnings": "Monitor INR closely to reduce risk of hemorrhage.",
            "adverse_reactions": "Hemorrhage from any tissue or organ, epistaxis, hematuria.",
        },
    },
    {
        "id": "MOCK_L02",
        "drug": "ATORVASTATIN",
        "adverse_event": "RHABDOMYOLYSIS",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": "",
            "warnings": (
                "Skeletal Muscle: Cases of myopathy and rhabdomyolysis with acute renal failure "
                "secondary to myoglobinuria have been reported with HMG-CoA reductase inhibitors."
            ),
            "adverse_reactions": "Myalgia, muscle spasms, arthralgia, diarrhea, nasopharyngitis.",
        },
    },
    {
        "id": "MOCK_U01",
        "drug": "METFORMIN",
        "adverse_event": "RHABDOMYOLYSIS",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "WARNING: LACTIC ACIDOSIS.",
            "warnings": "Vitamin B12 deficiency, hypoglycemia with insulin secretagogues.",
            "adverse_reactions": "Diarrhea, nausea, vomiting, flatulence, abdominal discomfort, headache.",
        },
    },
    {
        "id": "MOCK_U02",
        "drug": "FINASTERIDE",
        "adverse_event": "HEPATIC FAILURE",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "",
            "warnings": (
                "Increased risk of high-grade prostate cancer. Clinical trials showed no evidence of hepatic failure."
            ),
            "adverse_reactions": "Impotence, decreased libido, decreased volume of ejaculate, gynecomastia.",
        },
    },
]

MOCK_DRAFT_CASE_EMPTY: Dict[str, Any] = {
    "draft_id": "MOCK_D_EMPTY",
    "stats": {
        "drug": "EXPERIMENTAL_COMPOUND_X99",
        "adverse_event": "IDIOSYNCRATIC NEUROPATHY",
        "case_count_a": 5,
        "drug_total_reports": 12,
        "event_total_reports": 8,
        "total_reports": 200,
        "PRR": 26.11,
        "ROR": 44.05,
        "ROR_95CI_low": 8.42,
        "ROR_95CI_high": 230.40,
        "chi_square": 23.14,
        "p_value": 0.000002,
        "q_value": 0.000020,
        "IC": 1.38,
        "IC025": 0.34,
        "IC975": 2.31,
        "EBGM": 1.18,
        "EB05": 0.78,
        "EB95": 1.75,
        "signal_detected": True,
        "signal_bcpnn": True,
        "signal_ebgm": False,
        "signal_fdr": True,
    },
    "label": {
        "retrieved": False,
        "sections": {
            "boxed_warning": "",
            "warnings": "",
            "adverse_reactions": "",
        },
    },
    "pubmed": {
        "abstracts": [],
    },
}

MOCK_DRAFT_CASE_WITH_SOURCES: Dict[str, Any] = {
    "draft_id": "MOCK_D01",
    "stats": {
        "drug": "WARFARIN",
        "adverse_event": "GASTROINTESTINAL HAEMORRHAGE",
        "case_count_a": 42,
        "drug_total_reports": 68,
        "event_total_reports": 51,
        "total_reports": 200,
        "PRR": 8.41,
        "ROR": 20.38,
        "ROR_95CI_low": 9.12,
        "ROR_95CI_high": 45.54,
        "chi_square": 62.18,
        "p_value": 0.000001,
        "q_value": 0.000012,
        "IC": 1.62,
        "IC025": 1.18,
        "IC975": 2.04,
        "EBGM": 1.27,
        "EB05": 1.05,
        "EB95": 1.54,
        "signal_detected": True,
        "signal_bcpnn": True,
        "signal_ebgm": False,
        "signal_fdr": True,
    },
    "label": {
        "retrieved": True,
        "sections": MOCK_LABEL_EVALUATION_PAIRS[0]["label_sections"],
    },
    "pubmed": {
        "abstracts": [
            {
                "pmid": "38412011",
                "title": "Anticoagulant-associated upper and lower gastrointestinal bleeding in older adults",
                "year": "2024",
                "abstract": "Observational cohort evaluating vitamin K antagonist monitoring.",
            }
        ],
    },
}


class TestSignalCopilotOfflineUnit(unittest.TestCase):
    def test_offline_mock_label_status_matching(self) -> None:
        """Offline unit test: deterministic SPL section matcher handles British/US spelling and negation."""
        for item in MOCK_LABEL_EVALUATION_PAIRS:
            res = determine_label_status(item["adverse_event"], item["label_sections"])
            self.assertEqual(
                bool(res["already_labelled"]),
                bool(item["expected_labelled"]),
                msg=f"Failed on mock pair {item['id']}",
            )

    def test_label_negation_guard(self) -> None:
        """Negated label statements ('no evidence of hepatic failure') are not flagged as labelled."""
        sections = {
            "boxed_warning": "",
            "warnings": "Clinical trials showed no evidence of hepatic failure in treated patients.",
            "adverse_reactions": "Headache, dizziness.",
        }
        status = determine_label_status("HEPATIC FAILURE", sections)
        self.assertFalse(status["is_labelled"])
        self.assertEqual(status["status"], "not_found_in_label")

    def test_citation_verification_drops_unverified_sources(self) -> None:
        """Sentences missing citations or citing non-retrieved PMIDs/label sections are flagged and dropped."""
        valid_sources = {"STATS", "LABEL:boxed_warning", "PMID:38412011"}
        sentences = [
            "Warfarin has 42 co-reported cases of gastrointestinal bleeding with PRR=8.41 [STATS].",
            "The boxed warning notes major or fatal gastrointestinal hemorrhage [LABEL:boxed_warning].",
            "Cohort study evaluated bleeding rates in older adults [PMID:38412011].",
            "Hallucinated study claims a specific mechanism [PMID:99999999].",
            "Uncited claim from parametric model memory without any tag.",
        ]
        checked = verify_draft_sentences(sentences, valid_sources)
        self.assertEqual(len(checked), 5)
        self.assertTrue(checked[0]["verified"])
        self.assertTrue(checked[1]["verified"])
        self.assertTrue(checked[2]["verified"])
        self.assertFalse(checked[3]["verified"])
        self.assertEqual(checked[3]["status"], "dropped_unverified_source")
        self.assertFalse(checked[4]["verified"])
        self.assertEqual(checked[4]["status"], "dropped_missing_citation")

    def test_causal_language_sanitizer(self) -> None:
        """Drafts never state that the drug causes the adverse event."""
        raw = "This high PRR proves that warfarin causes gastrointestinal haemorrhage [STATS]."
        sanitized, modified = sanitize_causal_language(raw)
        self.assertTrue(modified)
        self.assertNotIn("causes", sanitized.lower())
        self.assertIn("associated", sanitized.lower())

    def test_empty_retrieval_refuses_memory_answering(self) -> None:
        """When neither openFDA label nor PubMed returns results, the draft states so and does not answer from memory."""
        draft = generate_signal_assessment_draft(
            stats=MOCK_DRAFT_CASE_EMPTY["stats"],
            use_llm=False,
            pre_retrieved_label=MOCK_DRAFT_CASE_EMPTY["label"],
            pre_retrieved_pubmed=MOCK_DRAFT_CASE_EMPTY["pubmed"],
        )
        self.assertTrue(draft["retrieval_empty"])
        self.assertTrue(draft["is_draft_for_human_review"])
        self.assertIn(
            "No openFDA product label sections or PubMed abstracts were retrieved",
            draft["markdown"],
        )
        self.assertIn("model_name", draft)
        self.assertIn("prompt_version", draft)
        self.assertIn("retrieval_timestamp", draft)

    def test_offline_draft_generation_with_mock_sources(self) -> None:
        """Offline unit test: draft generation verifies all sentences against mock retrieved sources."""
        draft = generate_signal_assessment_draft(
            stats=MOCK_DRAFT_CASE_WITH_SOURCES["stats"],
            use_llm=False,
            pre_retrieved_label=MOCK_DRAFT_CASE_WITH_SOURCES["label"],
            pre_retrieved_pubmed=MOCK_DRAFT_CASE_WITH_SOURCES["pubmed"],
        )
        md = draft_to_markdown(draft)
        self.assertIn("DRAFT FOR HUMAN REVIEW", md)
        self.assertEqual(
            draft["provenance"]["sentences_verified"],
            draft["provenance"]["sentences_total"],
        )

    def test_template_nl_query_deterministic_unit(self) -> None:
        """Offline unit test: deterministic parser translates standard template syntax into validated JSON."""
        translated = translate_nl_query_to_filter(
            "serious events for warfarin with at least 5 cases not flagged by PRR",
            use_llm=False,
        )
        filt = validate_signal_filter(translated["filter"])
        self.assertEqual(filt["sort_by"], "priority_rank")
        self.assertEqual(filt["sort_dir"], "asc")
        self.assertEqual(len(filt["clauses"]), 4)

    def test_strict_json_filter_rejects_injection_and_unknown_fields(self) -> None:
        """Schema validation rejects unknown fields, SQL/code operators, and invalid value types."""
        with self.assertRaises(ValueError):
            validate_signal_filter(
                {"clauses": [{"field": "sql_injection", "op": "eq", "value": "1=1"}]}
            )
        with self.assertRaises(ValueError):
            validate_signal_filter({"clauses": [{"field": "PRR", "op": "$where", "value": 2}]})
        with self.assertRaises(ValueError):
            validate_signal_filter(
                {"clauses": [{"field": "serious_event", "op": "gt", "value": True}]}
            )
        with self.assertRaises(ValueError):
            validate_signal_filter({"clauses": [], "sort_by": "DROP TABLE signals"})

    def test_apply_signal_filter_execution(self) -> None:
        """apply_signal_filter filters and sorts signal rows accurately in ordinary Python code."""
        rows = [
            {
                "drug": "WARFARIN",
                "adverse_event": "GASTROINTESTINAL HAEMORRHAGE",
                "case_count_a": 12,
                "PRR": 5.2,
                "serious_event": True,
                "signal_detected": True,
                "priority_rank": 1,
            },
            {
                "drug": "WARFARIN",
                "adverse_event": "HEPATIC FAILURE",
                "case_count_a": 6,
                "PRR": 1.4,
                "serious_event": True,
                "signal_detected": False,
                "priority_rank": 8,
            },
            {
                "drug": "WARFARIN",
                "adverse_event": "NAUSEA",
                "case_count_a": 9,
                "PRR": 1.1,
                "serious_event": False,
                "signal_detected": False,
                "priority_rank": 15,
            },
        ]
        translated = translate_nl_query_to_filter(
            "serious events for warfarin with at least 5 cases not flagged by PRR",
            use_llm=False,
        )
        filtered = apply_signal_filter(rows, translated["filter"])
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["adverse_event"], "HEPATIC FAILURE")

    def test_rate_limiter_and_spending_cap(self) -> None:
        """SlidingWindowRateLimiter enforces request limits and check_spending_cap blocks oversized prompts."""
        limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=60.0)
        ok1, _ = limiter.check("test:127.0.0.1")
        ok2, _ = limiter.check("test:127.0.0.1")
        ok3, retry = limiter.check("test:127.0.0.1")
        self.assertTrue(ok1)
        self.assertTrue(ok2)
        self.assertFalse(ok3)
        self.assertGreaterEqual(retry, 1.0)

        cost = check_spending_cap(prompt_chars=2000, max_output_tokens=600, cap_usd=0.02)
        self.assertLess(cost, 0.02)
        with self.assertRaises(ValueError):
            check_spending_cap(prompt_chars=500_000, max_output_tokens=10_000, cap_usd=0.01)


if __name__ == "__main__":
    unittest.main()
