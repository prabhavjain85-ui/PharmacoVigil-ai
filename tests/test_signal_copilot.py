"""Unit tests for Signal Assessment Drafts, NL-to-JSON Filter Translation, and Guardrails."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.evaluate_signal_copilot import (
    DRAFT_EVALUATION_CASES,
    LABEL_EVALUATION_PAIRS,
    NL_FILTER_BENCHMARK,
    evaluate_generated_drafts,
    evaluate_label_status,
    evaluate_nl_filter_benchmark,
)
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


class TestSignalCopilot(unittest.TestCase):
    def test_20_label_status_pairs_accuracy(self) -> None:
        """All 20 benchmark drug-event pairs (10 labelled, 10 unlabelled) are classified accurately."""
        res = evaluate_label_status()
        self.assertEqual(res["n_pairs"], 20)
        self.assertEqual(res["n_labelled"], 10)
        self.assertEqual(res["n_unlabelled"], 10)
        self.assertEqual(res["correct"], 20)
        self.assertEqual(res["accuracy"], 1.0)

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
        empty_case = DRAFT_EVALUATION_CASES[9]  # D10: EXPERIMENTAL_COMPOUND_X99
        draft = generate_signal_assessment_draft(
            stats=empty_case["stats"],
            use_llm=False,
            pre_retrieved_label=empty_case["label"],
            pre_retrieved_pubmed=empty_case["pubmed"],
        )
        self.assertTrue(draft["retrieval_empty"])
        self.assertTrue(draft["is_draft_for_human_review"])
        self.assertIn("No openFDA product label sections or PubMed abstracts were retrieved", draft["markdown"])
        self.assertIn("model_name", draft)
        self.assertIn("prompt_version", draft)
        self.assertIn("retrieval_timestamp", draft)

    def test_10_generated_drafts_citation_audit(self) -> None:
        """All 10 generated assessment drafts have 100% verified citations and export valid Markdown."""
        res = evaluate_generated_drafts()
        self.assertEqual(res["n_drafts"], 10)
        self.assertEqual(res["overall_support_share"], 1.0)
        self.assertEqual(res["total_sentences"], res["total_supported_by_source"])

    def test_30_nl_questions_exact_match(self) -> None:
        """All 30 natural-language questions translate to the expected validated JSON filters."""
        res = evaluate_nl_filter_benchmark()
        self.assertEqual(res["n_questions"], 30)
        self.assertEqual(res["exact_matches"], 30)
        self.assertEqual(res["exact_match_accuracy"], 1.0)

    def test_strict_json_filter_rejects_injection_and_unknown_fields(self) -> None:
        """Schema validation rejects unknown fields, SQL/code operators, and invalid value types."""
        with self.assertRaises(ValueError):
            validate_signal_filter({"clauses": [{"field": "sql_injection", "op": "eq", "value": "1=1"}]})
        with self.assertRaises(ValueError):
            validate_signal_filter({"clauses": [{"field": "PRR", "op": "$where", "value": 2}]})
        with self.assertRaises(ValueError):
            validate_signal_filter({"clauses": [{"field": "serious_event", "op": "gt", "value": True}]})
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
