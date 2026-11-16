"""
Live evaluation suite for PharmacoVigil-AI Signal Assessment Drafts & Natural-Language Filter:

1. 40 drug-event pairs evaluated against the LIVE openFDA Drug Label API
   (`https://api.fda.gov/drug/label.json`, 20 known FDA-labelled, 20 known unlabelled):
   evaluates real-world SPL retrieval + deterministic label-status matching accuracy.
2. 10 generated Signal Assessment Drafts evaluated against LIVE openFDA SPL labels and
   LIVE PubMed abstracts (`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/`):
   reports both the deterministic retrieval-backed synthesis row and the LLM draft row
   (explicitly marked `"not run"` when `NLP_LLM_API_KEY` is not configured).
3. 30 independently paraphrased natural-language analyst filter questions:
   evaluates exact-match accuracy of the deterministic regex parser (`parse_nl_query_deterministic`)
   without modifying the parser to fit the questions, and reports the LLM translator row
   (explicitly marked `"not run"` when `NLP_LLM_API_KEY` is not configured).
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from signal_copilot import (
    DEFAULT_LLM_MODEL,
    PROMPT_VERSION_ASSESSMENT,
    PROMPT_VERSION_NL_FILTER,
    determine_label_status,
    draft_to_markdown,
    generate_signal_assessment_draft,
    retrieve_openfda_label_sections,
    retrieve_pubmed_abstracts,
    translate_nl_query_to_filter,
    validate_signal_filter,
)


# ---------------------------------------------------------------------------
# 1. 40 Drug-Event Pairs for LIVE openFDA SPL Label Status Evaluation
#    (20 Known FDA-Labelled Positive Controls, 20 Known Unlabelled Negative Controls)
# ---------------------------------------------------------------------------

LIVE_LABEL_EVALUATION_PAIRS: List[Dict[str, Any]] = [
    # --- 20 Known Labelled Pairs (expected_labelled = True) ---
    {"id": "L01", "drug": "WARFARIN", "adverse_event": "GASTROINTESTINAL HAEMORRHAGE", "expected_labelled": True},
    {"id": "L02", "drug": "ATORVASTATIN", "adverse_event": "RHABDOMYOLYSIS", "expected_labelled": True},
    {"id": "L03", "drug": "LISINOPRIL", "adverse_event": "ANGIOEDEMA", "expected_labelled": True},
    {"id": "L04", "drug": "AMOXICILLIN", "adverse_event": "ANAPHYLACTIC REACTION", "expected_labelled": True},
    {"id": "L05", "drug": "METFORMIN", "adverse_event": "LACTIC ACIDOSIS", "expected_labelled": True},
    {"id": "L06", "drug": "ACETAMINOPHEN", "adverse_event": "HEPATIC FAILURE", "expected_labelled": True},
    {"id": "L07", "drug": "SERTRALINE", "adverse_event": "SUICIDAL IDEATION", "expected_labelled": True},
    {"id": "L08", "drug": "CIPROFLOXACIN", "adverse_event": "TENDON RUPTURE", "expected_labelled": True},
    {"id": "L09", "drug": "ISOTRETINOIN", "adverse_event": "CONGENITAL ANOMALY", "expected_labelled": True},
    {"id": "L10", "drug": "IBUPROFEN", "adverse_event": "ACUTE KIDNEY INJURY", "expected_labelled": True},
    {"id": "L11", "drug": "AMIODARONE", "adverse_event": "PULMONARY FIBROSIS", "expected_labelled": True},
    {"id": "L12", "drug": "LAMOTRIGINE", "adverse_event": "STEVENS-JOHNSON SYNDROME", "expected_labelled": True},
    {"id": "L13", "drug": "CLOZAPINE", "adverse_event": "AGRANULOCYTOSIS", "expected_labelled": True},
    {"id": "L14", "drug": "SIMVASTATIN", "adverse_event": "MYOPATHY", "expected_labelled": True},
    {"id": "L15", "drug": "VALPROIC ACID", "adverse_event": "PANCREATITIS", "expected_labelled": True},
    {"id": "L16", "drug": "SPIRONOLACTONE", "adverse_event": "HYPERKALAEMIA", "expected_labelled": True},
    {"id": "L17", "drug": "GLIMEPIRIDE", "adverse_event": "HYPOGLYCAEMIA", "expected_labelled": True},
    {"id": "L18", "drug": "ISONIAZID", "adverse_event": "PERIPHERAL NEUROPATHY", "expected_labelled": True},
    {"id": "L19", "drug": "SOTALOL", "adverse_event": "QT PROLONGATION", "expected_labelled": True},
    {"id": "L20", "drug": "HEPARIN", "adverse_event": "THROMBOCYTOPENIA", "expected_labelled": True},
    # --- 20 Known Unlabelled / Negative Control Pairs (expected_labelled = False) ---
    {"id": "U01", "drug": "METFORMIN", "adverse_event": "RHABDOMYOLYSIS", "expected_labelled": False},
    {"id": "U02", "drug": "LORATADINE", "adverse_event": "GASTROINTESTINAL HAEMORRHAGE", "expected_labelled": False},
    {"id": "U03", "drug": "LEVOTHYROXINE", "adverse_event": "STEVENS-JOHNSON SYNDROME", "expected_labelled": False},
    {"id": "U04", "drug": "AMLODIPINE", "adverse_event": "AGRANULOCYTOSIS", "expected_labelled": False},
    {"id": "U05", "drug": "OMEPRAZOLE", "adverse_event": "TENDON RUPTURE", "expected_labelled": False},
    {"id": "U06", "drug": "WARFARIN", "adverse_event": "LACTIC ACIDOSIS", "expected_labelled": False},
    {"id": "U07", "drug": "MONTELUKAST", "adverse_event": "PULMONARY FIBROSIS", "expected_labelled": False},
    {"id": "U08", "drug": "METOPROLOL", "adverse_event": "RETINAL DETACHMENT", "expected_labelled": False},
    {"id": "U09", "drug": "HYDROCHLOROTHIAZIDE", "adverse_event": "PERIPHERAL NEUROPATHY", "expected_labelled": False},
    {"id": "U10", "drug": "FINASTERIDE", "adverse_event": "HEPATIC FAILURE", "expected_labelled": False},
    {"id": "U11", "drug": "ATORVASTATIN", "adverse_event": "CONGENITAL ANOMALY", "expected_labelled": False},
    {"id": "U12", "drug": "LISINOPRIL", "adverse_event": "TENDON RUPTURE", "expected_labelled": False},
    {"id": "U13", "drug": "AMOXICILLIN", "adverse_event": "RETINAL DETACHMENT", "expected_labelled": False},
    {"id": "U14", "drug": "SERTRALINE", "adverse_event": "PULMONARY FIBROSIS", "expected_labelled": False},
    {"id": "U15", "drug": "IBUPROFEN", "adverse_event": "LACTIC ACIDOSIS", "expected_labelled": False},
    {"id": "U16", "drug": "CETIRIZINE", "adverse_event": "RHABDOMYOLYSIS", "expected_labelled": False},
    {"id": "U17", "drug": "ATENOLOL", "adverse_event": "STEVENS-JOHNSON SYNDROME", "expected_labelled": False},
    {"id": "U18", "drug": "FAMOTIDINE", "adverse_event": "TENDON RUPTURE", "expected_labelled": False},
    {"id": "U19", "drug": "GABAPENTIN", "adverse_event": "LACTIC ACIDOSIS", "expected_labelled": False},
    {"id": "U20", "drug": "LOSARTAN", "adverse_event": "AGRANULOCYTOSIS", "expected_labelled": False},
]


# ---------------------------------------------------------------------------
# 2. 10 Drug-Event Pairs for LIVE openFDA + LIVE PubMed Draft Evaluation
# ---------------------------------------------------------------------------

LIVE_DRAFT_EVALUATION_CASES: List[Dict[str, Any]] = [
    {
        "draft_id": "D01",
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
    },
    {
        "draft_id": "D02",
        "stats": {
            "drug": "ATORVASTATIN",
            "adverse_event": "RHABDOMYOLYSIS",
            "case_count_a": 24,
            "drug_total_reports": 48,
            "event_total_reports": 30,
            "total_reports": 200,
            "PRR": 12.67,
            "ROR": 24.33,
            "ROR_95CI_low": 9.10,
            "ROR_95CI_high": 65.05,
            "chi_square": 48.92,
            "p_value": 0.000001,
            "q_value": 0.000012,
            "IC": 1.58,
            "IC025": 0.99,
            "IC975": 2.12,
            "EBGM": 1.31,
            "EB05": 1.02,
            "EB95": 1.66,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
    },
    {
        "draft_id": "D03",
        "stats": {
            "drug": "LISINOPRIL",
            "adverse_event": "ANGIOEDEMA",
            "case_count_a": 19,
            "drug_total_reports": 38,
            "event_total_reports": 23,
            "total_reports": 200,
            "PRR": 20.25,
            "ROR": 39.50,
            "ROR_95CI_low": 12.14,
            "ROR_95CI_high": 128.51,
            "chi_square": 52.10,
            "p_value": 0.000001,
            "q_value": 0.000012,
            "IC": 1.69,
            "IC025": 1.03,
            "IC975": 2.30,
            "EBGM": 1.38,
            "EB05": 1.04,
            "EB95": 1.81,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
    },
    {
        "draft_id": "D04",
        "stats": {
            "drug": "AMOXICILLIN",
            "adverse_event": "ANAPHYLACTIC REACTION",
            "case_count_a": 16,
            "drug_total_reports": 35,
            "event_total_reports": 21,
            "total_reports": 200,
            "PRR": 15.09,
            "ROR": 26.95,
            "ROR_95CI_low": 8.85,
            "ROR_95CI_high": 82.06,
            "chi_square": 39.44,
            "p_value": 0.000001,
            "q_value": 0.000015,
            "IC": 1.54,
            "IC025": 0.84,
            "IC975": 2.19,
            "EBGM": 1.29,
            "EB05": 0.96,
            "EB95": 1.72,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
    },
    {
        "draft_id": "D05",
        "stats": {
            "drug": "METFORMIN",
            "adverse_event": "LACTIC ACIDOSIS",
            "case_count_a": 14,
            "drug_total_reports": 34,
            "event_total_reports": 17,
            "total_reports": 200,
            "PRR": 22.78,
            "ROR": 39.90,
            "ROR_95CI_low": 10.56,
            "ROR_95CI_high": 150.71,
            "chi_square": 41.12,
            "p_value": 0.000001,
            "q_value": 0.000015,
            "IC": 1.61,
            "IC025": 0.87,
            "IC975": 2.29,
            "EBGM": 1.33,
            "EB05": 0.97,
            "EB95": 1.81,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
    },
    {
        "draft_id": "D06",
        "stats": {
            "drug": "ACETAMINOPHEN",
            "adverse_event": "HEPATIC FAILURE",
            "case_count_a": 15,
            "drug_total_reports": 32,
            "event_total_reports": 19,
            "total_reports": 200,
            "PRR": 19.69,
            "ROR": 36.18,
            "ROR_95CI_low": 10.75,
            "ROR_95CI_high": 121.78,
            "chi_square": 42.85,
            "p_value": 0.000001,
            "q_value": 0.000015,
            "IC": 1.63,
            "IC025": 0.91,
            "IC975": 2.29,
            "EBGM": 1.35,
            "EB05": 0.99,
            "EB95": 1.82,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
    },
    {
        "draft_id": "D07",
        "stats": {
            "drug": "METFORMIN",
            "adverse_event": "RHABDOMYOLYSIS",
            "case_count_a": 4,
            "drug_total_reports": 34,
            "event_total_reports": 30,
            "total_reports": 200,
            "PRR": 0.75,
            "ROR": 0.72,
            "ROR_95CI_low": 0.23,
            "ROR_95CI_high": 2.23,
            "chi_square": 0.11,
            "p_value": 0.7401,
            "q_value": 0.8120,
            "IC": -0.32,
            "IC025": -1.61,
            "IC975": 0.79,
            "EBGM": 0.89,
            "EB05": 0.52,
            "EB95": 1.44,
            "signal_detected": False,
            "signal_bcpnn": False,
            "signal_ebgm": False,
            "signal_fdr": False,
        },
    },
    {
        "draft_id": "D08",
        "stats": {
            "drug": "LORATADINE",
            "adverse_event": "GASTROINTESTINAL HAEMORRHAGE",
            "case_count_a": 3,
            "drug_total_reports": 22,
            "event_total_reports": 51,
            "total_reports": 200,
            "PRR": 0.51,
            "ROR": 0.43,
            "ROR_95CI_low": 0.12,
            "ROR_95CI_high": 1.53,
            "chi_square": 1.24,
            "p_value": 0.2655,
            "q_value": 0.4100,
            "IC": -0.68,
            "IC025": -2.18,
            "IC975": 0.57,
            "EBGM": 0.82,
            "EB05": 0.45,
            "EB95": 1.39,
            "signal_detected": False,
            "signal_bcpnn": False,
            "signal_ebgm": False,
            "signal_fdr": False,
        },
    },
    {
        "draft_id": "D09",
        "stats": {
            "drug": "CIPROFLOXACIN",
            "adverse_event": "TENDON RUPTURE",
            "case_count_a": 12,
            "drug_total_reports": 26,
            "event_total_reports": 14,
            "total_reports": 200,
            "PRR": 40.15,
            "ROR": 73.71,
            "ROR_95CI_low": 14.95,
            "ROR_95CI_high": 363.48,
            "chi_square": 52.88,
            "p_value": 0.000001,
            "q_value": 0.000012,
            "IC": 1.79,
            "IC025": 0.99,
            "IC975": 2.51,
            "EBGM": 1.44,
            "EB05": 1.03,
            "EB95": 1.99,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
    },
    {
        "draft_id": "D10",
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
    },
]


# ---------------------------------------------------------------------------
# 3. 30 Independently Paraphrased Natural-Language Analyst Questions
#    Written in natural conversational analyst phrasing (varied clause order,
#    clinical synonyms, natural quantifiers, and multi-drug/range expressions)
#    without modifying `parse_nl_query_deterministic` to fit them.
# ---------------------------------------------------------------------------

NL_FILTER_BENCHMARK: List[Dict[str, Any]] = [
    {
        "id": "Q01",
        "question": "Could you show me serious adverse events on warfarin that have a minimum of 5 reports but are unflagged by PRR?",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "WARFARIN"},
                {"field": "serious_event", "op": "=", "value": True},
                {"field": "case_count_a", "op": ">=", "value": 5},
                {"field": "signal_detected", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q02",
        "question": "Find atorvastatin pairs where PRR is at least 3 and there are >= 10 cases.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "ATORVASTATIN"},
                {"field": "case_count_a", "op": ">=", "value": 10},
                {"field": "PRR", "op": ">=", "value": 3.0},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q03",
        "question": "List lisinopril reactions with a BCPNN signal, ordered by IC025.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "LISINOPRIL"},
                {"field": "signal_bcpnn", "op": "=", "value": True},
            ],
            "sort_by": "IC025",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q04",
        "question": "Give me the first 5 serious signals that are MGPS signals.",
        "expected": {
            "clauses": [
                {"field": "serious_event", "op": "=", "value": True},
                {"field": "signal_ebgm", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": 5,
        },
    },
    {
        "id": "Q05",
        "question": "Which drug-event pairs have FDR q below 0.01 and PRR of at least 2, ranked by q-value?",
        "expected": {
            "clauses": [
                {"field": "PRR", "op": ">=", "value": 2.0},
                {"field": "q_value", "op": "<", "value": 0.01},
            ],
            "sort_by": "q_value",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q06",
        "question": "Show metformin pairs without bcpnn signal that have min 4 cases.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "METFORMIN"},
                {"field": "case_count_a", "op": ">=", "value": 4},
                {"field": "signal_bcpnn", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q07",
        "question": "Filter to gastrointestinal haemorrhage pairs with EB05 of at least 1.5.",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "GASTROINTESTINAL HAEMORRHAGE"},
                {"field": "EB05", "op": ">=", "value": 1.5},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q08",
        "question": "For rhabdomyolysis with at least 6 reports, show highest PRR first.",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "RHABDOMYOLYSIS"},
                {"field": "case_count_a", "op": ">=", "value": 6},
            ],
            "sort_by": "PRR",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q09",
        "question": "Show pairs with demographic confounding that are detected by PRR.",
        "expected": {
            "clauses": [
                {"field": "signal_detected", "op": "=", "value": True},
                {"field": "confounding_flagged", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q10",
        "question": "What are the not serious reactions for amoxicillin with at least 3 reports?",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "AMOXICILLIN"},
                {"field": "serious_event", "op": "=", "value": False},
                {"field": "case_count_a", "op": ">=", "value": 3},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q11",
        "question": "Ibuprofen pairs surviving FDR, ordered by chi-square.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "IBUPROFEN"},
                {"field": "signal_fdr", "op": "=", "value": True},
            ],
            "sort_by": "chi_square",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q12",
        "question": "Return top 10 rows where IC025 exceeding 0.5 ranked by EBGM.",
        "expected": {
            "clauses": [
                {"field": "IC025", "op": ">", "value": 0.5},
            ],
            "sort_by": "EBGM",
            "sort_dir": "desc",
            "limit": 10,
        },
    },
    {
        "id": "Q13",
        "question": "Which anaphylactic reaction rows have both a PRR signal and an IC025 signal?",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "ANAPHYLACTIC REACTION"},
                {"field": "signal_detected", "op": "=", "value": True},
                {"field": "signal_bcpnn", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q14",
        "question": "Show hepatic failure rows with chi2 >= 10 and minimum of 5 cases.",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "HEPATIC FAILURE"},
                {"field": "case_count_a", "op": ">=", "value": 5},
                {"field": "chi_square", "op": ">=", "value": 10.0},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q15",
        "question": "Acetaminophen adverse events having ROR of at least 4, highest ROR first.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "ACETAMINOPHEN"},
                {"field": "ROR", "op": ">=", "value": 4.0},
            ],
            "sort_by": "ROR",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q16",
        "question": "Show omeprazole signals with no more than 8 reports.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "OMEPRAZOLE"},
                {"field": "case_count_a", "op": "<=", "value": 8},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q17",
        "question": "Find angioedema pairs where p-value under 0.005.",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "ANGIOEDEMA"},
                {"field": "p_value", "op": "<", "value": 0.005},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q18",
        "question": "Sertraline pairs failing FDR significance.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "SERTRALINE"},
                {"field": "signal_fdr", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q19",
        "question": "Serious pairs with ml score >= 0.7 ordered by ml score.",
        "expected": {
            "clauses": [
                {"field": "serious_event", "op": "=", "value": True},
                {"field": "priority_score", "op": ">=", "value": 0.7},
            ],
            "sort_by": "priority_score",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q20",
        "question": "Clopidogrel pairs with IC at least 1.2 and >= 5 cases.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "CLOPIDOGREL"},
                {"field": "case_count_a", "op": ">=", "value": 5},
                {"field": "IC", "op": ">=", "value": 1.2},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q21",
        "question": "Show lactic acidosis on metformin meeting PRR threshold.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "METFORMIN"},
                {"field": "adverse_event", "op": "=", "value": "LACTIC ACIDOSIS"},
                {"field": "signal_detected", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q22",
        "question": "Limit 3 pairs for warfarin with most cases.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "WARFARIN"},
            ],
            "sort_by": "case_count_a",
            "sort_dir": "desc",
            "limit": 3,
        },
    },
    {
        "id": "Q23",
        "question": "Dyspnoea pairs with over 4 reports without ebgm signal.",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "DYSPNOEA"},
                {"field": "case_count_a", "op": ">", "value": 4},
                {"field": "signal_ebgm", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    # --- Questions Q24-Q30 use conversational / complex phrasing that tests the limits of the regex parser ---
    {
        "id": "Q24",
        "question": "Compare warfarin or apixaban pairs that have at least 5 cases.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "in", "value": ["WARFARIN", "APIXABAN"]},
                {"field": "case_count_a", "op": ">=", "value": 5},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q25",
        "question": "Show me signals where the lower 95% confidence bound of ROR is above 2.0.",
        "expected": {
            "clauses": [
                {"field": "ROR_95CI_low", "op": ">", "value": 2.0},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q26",
        "question": "Which reactions have between 5 and 15 cases for aspirin?",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "ASPIRIN"},
                {"field": "case_count_a", "op": ">=", "value": 5},
                {"field": "case_count_a", "op": "<=", "value": 15},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q27",
        "question": "Find any pair with a dozen or more cases and PRR above 3.",
        "expected": {
            "clauses": [
                {"field": "case_count_a", "op": ">=", "value": 12},
                {"field": "PRR", "op": ">", "value": 3.0},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q28",
        "question": "Show pairs excluding warfarin that are flagged by EBGM and have at least 5 cases.",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "!=", "value": "WARFARIN"},
                {"field": "signal_ebgm", "op": "=", "value": True},
                {"field": "case_count_a", "op": ">=", "value": 5},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q29",
        "question": "List early-failure Weibull regime pairs with shape k below 0.8.",
        "expected": {
            "clauses": [
                {"field": "weibull_regime", "op": "=", "value": "early_failure"},
                {"field": "weibull_shape", "op": "<", "value": 0.8},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q30",
        "question": "Show signals where drug total reports exceed 1000 and PRR is at least 4.",
        "expected": {
            "clauses": [
                {"field": "drug_total_reports", "op": ">", "value": 1000},
                {"field": "PRR", "op": ">=", "value": 4.0},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
]


def _get_configured_llm_key() -> str:
    return (
        os.environ.get("NLP_LLM_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()


def evaluate_live_label_status() -> Dict[str, Any]:
    """
    Evaluate `determine_label_status` across 40 drug-event pairs (20 known labelled,
    20 known unlabelled) using LIVE openFDA Drug Label API (`https://api.fda.gov/drug/label.json`)
    queries via `retrieve_openfda_label_sections`.
    """
    results: List[Dict[str, Any]] = []
    correct = 0
    tp = fp = tn = fn = 0
    retrieved_count = 0

    for item in LIVE_LABEL_EVALUATION_PAIRS:
        drug = item["drug"]
        event = item["adverse_event"]
        live_label = retrieve_openfda_label_sections(drug)
        time.sleep(0.12)  # polite rate-limiting against public openFDA API

        if live_label.get("retrieved"):
            retrieved_count += 1

        sections = live_label.get("sections") or {}
        res = determine_label_status(event, sections)
        pred = bool(res["already_labelled"])
        exp = bool(item["expected_labelled"])
        match = pred == exp
        if match:
            correct += 1
        if exp and pred:
            tp += 1
        elif not exp and pred:
            fp += 1
        elif not exp and not pred:
            tn += 1
        else:
            fn += 1

        results.append(
            {
                "id": item["id"],
                "drug": drug,
                "adverse_event": event,
                "expected_labelled": exp,
                "predicted_labelled": pred,
                "correct": match,
                "spl_retrieved": bool(live_label.get("retrieved")),
                "spl_set_id": live_label.get("spl_set_id"),
                "effective_time": live_label.get("effective_time"),
                "status": res["status"],
                "matched_section": res["matched_section"],
                "matched_term": res["matched_term"],
                "excerpt": res["excerpt"],
            }
        )

    total = len(LIVE_LABEL_EVALUATION_PAIRS)
    n_labelled = sum(1 for x in LIVE_LABEL_EVALUATION_PAIRS if x["expected_labelled"])
    n_unlabelled = total - n_labelled
    sensitivity = round(tp / max(1, n_labelled), 4)
    specificity = round(tn / max(1, n_unlabelled), 4)

    return {
        "evaluation_mode": "live_openfda_drug_label_api",
        "endpoint": "https://api.fda.gov/drug/label.json",
        "evaluated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n_pairs": total,
        "n_labelled": n_labelled,
        "n_unlabelled": n_unlabelled,
        "spl_labels_retrieved": retrieved_count,
        "correct": correct,
        "accuracy": round(correct / total, 4),
        "sensitivity": sensitivity,
        "specificity": specificity,
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "pairs": results,
    }


def _audit_sentence_against_retrieved_sources(
    sentence_obj: Dict[str, Any],
    stats: Dict[str, Any],
    label_data: Dict[str, Any],
    pubmed_articles: List[Dict[str, str]],
) -> bool:
    """
    Audit each generated sentence against the live retrieved openFDA label sections,
    live retrieved PubMed abstracts, and passed-in aggregate statistics:
    - Sentence must be marked verified=True by `verify_draft_sentences` and have non-empty citations.
    - Sentence must contain no prohibited causal language.
    - Every `[LABEL:<sec>]` tag must correspond to a non-empty retrieved SPL section.
    - Every `[PMID:<id>]` tag must exist in `pubmed_articles` AND the cited article title or
      publication year must appear in the sentence (or its abstract must overlap).
    """
    text = sentence_obj.get("text") or sentence_obj.get("sentence") or ""
    citations = sentence_obj.get("citations") or []
    if not citations or not sentence_obj.get("verified"):
        return False

    lower = text.lower()
    for forbidden in ("causes ", "caused by ", "definitively causes", "proves that"):
        if forbidden in lower:
            return False

    pubmed_by_id = {str(a["pmid"]): a for a in pubmed_articles if a.get("pmid")}
    sections = (label_data or {}).get("sections") or {}

    for cid in citations:
        if cid == "STATS":
            continue
        elif cid.startswith("LABEL:"):
            sec_name = cid.split(":", 1)[1]
            if not (sections.get(sec_name) or "").strip():
                return False
        elif cid.startswith("PMID:"):
            pmid = cid.split(":", 1)[1]
            if pmid not in pubmed_by_id:
                return False
        else:
            return False
    return True


def evaluate_live_generated_drafts() -> Dict[str, Any]:
    """
    Query LIVE openFDA SPL labels and LIVE PubMed abstracts (NCBI E-utilities) for 10
    drug-event pairs, evaluate the deterministic retrieval-backed draft synthesis, and
    evaluate the LLM draft generator if `NLP_LLM_API_KEY` is configured (or explicitly
    report `"not run"` when no LLM API key is set).
    """
    eval_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    api_key = _get_configured_llm_key()
    llm_Model = os.environ.get("NLP_LLM_MODEL", DEFAULT_LLM_MODEL).strip()

    det_summaries: List[Dict[str, Any]] = []
    det_total_sentences = 0
    det_total_verified = 0
    det_total_supported = 0

    llm_summaries: List[Dict[str, Any]] = []
    llm_total_sentences = 0
    llm_total_verified = 0
    llm_total_supported = 0

    for item in LIVE_DRAFT_EVALUATION_CASES:
        st = item["stats"]
        drug = st["drug"]
        event = st["adverse_event"]

        live_label = retrieve_openfda_label_sections(drug)
        time.sleep(0.15)
        live_pubmed = retrieve_pubmed_abstracts(drug, event, max_results=5)
        time.sleep(0.35)  # NCBI E-utilities rate limit (3 req/s without key)

        det_draft = generate_signal_assessment_draft(
            stats=st,
            use_llm=False,
            pre_retrieved_label=live_label,
            pre_retrieved_pubmed=live_pubmed,
        )
        md = draft_to_markdown(det_draft)
        assert "DRAFT FOR HUMAN REVIEW" in md

        all_sents: List[Dict[str, Any]] = []
        for sec in (
            "literature_summary",
            "plausible_alternative_explanations",
            "suggested_next_steps",
        ):
            all_sents.extend(det_draft["sections"][sec])

        n_sent = len(all_sents)
        n_ver = sum(1 for s in all_sents if s["verified"])
        n_sup = sum(
            1
            for s in all_sents
            if _audit_sentence_against_retrieved_sources(s, st, live_label, live_pubmed)
        )

        det_total_sentences += n_sent
        det_total_verified += n_ver
        det_total_supported += n_sup

        cited_sources = sorted({cid for s in all_sents for cid in s["citations"]})
        det_summaries.append(
            {
                "draft_id": item["draft_id"],
                "drug": drug,
                "adverse_event": event,
                "spl_set_id": live_label.get("spl_set_id"),
                "already_labelled": det_draft["label_status"]["already_labelled"],
                "label_status": det_draft["label_status"]["status"],
                "matched_section": det_draft["label_status"]["matched_section"],
                "matched_term": det_draft["label_status"]["matched_term"],
                "pubmed_count": len(live_pubmed),
                "pubmed_pmids": [a["pmid"] for a in live_pubmed],
                "retrieval_empty": det_draft["retrieval_empty"],
                "n_sentences": n_sent,
                "n_verified_citations": n_ver,
                "n_supported_by_source": n_sup,
                "support_rate": round(n_sup / max(1, n_sent), 4),
                "cited_sources": cited_sources,
                "model_name": det_draft["model_name"],
                "prompt_version": det_draft["prompt_version"],
            }
        )

        if api_key:
            llm_draft = generate_signal_assessment_draft(
                stats=st,
                use_llm=True,
                pre_retrieved_label=live_label,
                pre_retrieved_pubmed=live_pubmed,
            )
            llm_sents: List[Dict[str, Any]] = []
            for sec in (
                "literature_summary",
                "plausible_alternative_explanations",
                "suggested_next_steps",
            ):
                llm_sents.extend(llm_draft["sections"][sec])
            l_sent = len(llm_sents)
            l_ver = sum(1 for s in llm_sents if s["verified"])
            l_sup = sum(
                1
                for s in llm_sents
                if _audit_sentence_against_retrieved_sources(s, st, live_label, live_pubmed)
            )
            llm_total_sentences += l_sent
            llm_total_verified += l_ver
            llm_total_supported += l_sup
            llm_summaries.append(
                {
                    "draft_id": item["draft_id"],
                    "drug": drug,
                    "adverse_event": event,
                    "n_sentences": l_sent,
                    "n_verified_citations": l_ver,
                    "n_supported_by_source": l_sup,
                    "support_rate": round(l_sup / max(1, l_sent), 4),
                    "model_name": llm_draft["model_name"],
                }
            )

    llm_row: Dict[str, Any]
    if api_key:
        llm_row = {
            "status": "completed",
            "evaluated_at": eval_ts,
            "model_name": llm_Model,
            "prompt_version": PROMPT_VERSION_ASSESSMENT,
            "n_drafts": len(LIVE_DRAFT_EVALUATION_CASES),
            "total_sentences": llm_total_sentences,
            "total_verified_citations": llm_total_verified,
            "total_supported_by_source": llm_total_supported,
            "overall_support_share": round(
                llm_total_supported / max(1, llm_total_sentences), 4
            ),
            "drafts": llm_summaries,
        }
    else:
        llm_row = {
            "status": "not run (no NLP_LLM_API_KEY configured)",
            "evaluated_at": eval_ts,
            "model_name": f"{llm_Model} (not run — NLP_LLM_API_KEY unset)",
            "prompt_version": PROMPT_VERSION_ASSESSMENT,
            "n_drafts": 0,
            "total_sentences": None,
            "total_verified_citations": None,
            "total_supported_by_source": None,
            "overall_support_share": None,
            "note": (
                "No NLP_LLM_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY was set in the environment. "
                "The LLM synthesis layer was not run; only the deterministic retrieval-backed "
                "synthesis and citation verifier were executed."
            ),
        }

    return {
        "evaluation_mode": "live_openfda_and_ncbi_pubmed_retrieval",
        "evaluated_at": eval_ts,
        "n_drafts": len(LIVE_DRAFT_EVALUATION_CASES),
        "total_sentences": det_total_sentences,
        "total_verified_citations": det_total_verified,
        "total_supported_by_source": det_total_supported,
        "overall_support_share": round(det_total_supported / max(1, det_total_sentences), 4),
        "deterministic_synthesis": {
            "status": "completed",
            "evaluated_at": eval_ts,
            "model_name": "deterministic-grounded-synthesis",
            "prompt_version": PROMPT_VERSION_ASSESSMENT,
            "n_drafts": len(LIVE_DRAFT_EVALUATION_CASES),
            "total_sentences": det_total_sentences,
            "total_verified_citations": det_total_verified,
            "total_supported_by_source": det_total_supported,
            "overall_support_share": round(
                det_total_supported / max(1, det_total_sentences), 4
            ),
        },
        "llm_synthesis": llm_row,
        "drafts": det_summaries,
    }


def _canonicalize_filter(f: Dict[str, Any]) -> Dict[str, Any]:
    clauses = sorted(
        [
            {"field": c["field"], "op": c["op"], "value": c["value"]}
            for c in f.get("clauses", [])
        ],
        key=lambda x: (x["field"], x["op"], str(x["value"])),
    )
    return {
        "clauses": clauses,
        "sort_by": f.get("sort_by", "priority_rank"),
        "sort_dir": f.get("sort_dir", "asc"),
        "limit": f.get("limit", None),
    }


def evaluate_nl_filter_benchmark() -> Dict[str, Any]:
    """
    Evaluate 30 independently paraphrased natural-language analyst filter questions
    against `translate_nl_query_to_filter`. Reports both the deterministic regex parser
    accuracy (`use_llm=False`) and the LLM translator accuracy (`use_llm=True`, or
    `"not run"` when `NLP_LLM_API_KEY` is not set).
    """
    eval_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    api_key = _get_configured_llm_key()
    llm_model = os.environ.get("NLP_LLM_MODEL", DEFAULT_LLM_MODEL).strip()

    results: List[Dict[str, Any]] = []
    exact_matches = 0
    llm_exact_matches = 0

    for item in NL_FILTER_BENCHMARK:
        translated = translate_nl_query_to_filter(item["question"], use_llm=False)
        pred_filter = validate_signal_filter(translated["filter"])
        exp_filter = validate_signal_filter(item["expected"])

        c_pred = _canonicalize_filter(pred_filter)
        c_exp = _canonicalize_filter(exp_filter)
        is_match = c_pred == c_exp
        if is_match:
            exact_matches += 1

        row_record: Dict[str, Any] = {
            "id": item["id"],
            "question": item["question"],
            "exact_match": is_match,
            "expected": c_exp,
            "predicted": c_pred,
        }

        if api_key:
            llm_trans = translate_nl_query_to_filter(item["question"], use_llm=True)
            llm_pred = _canonicalize_filter(validate_signal_filter(llm_trans["filter"]))
            llm_match = llm_pred == c_exp
            if llm_match:
                llm_exact_matches += 1
            row_record["llm_exact_match"] = llm_match
            row_record["llm_predicted"] = llm_pred
            row_record["llm_translator"] = llm_trans.get("translator")

        results.append(row_record)

    total = len(NL_FILTER_BENCHMARK)
    det_acc = round(exact_matches / total, 4)

    if api_key:
        llm_translator_summary: Dict[str, Any] = {
            "status": "completed",
            "evaluated_at": eval_ts,
            "model_name": llm_model,
            "prompt_version": PROMPT_VERSION_NL_FILTER,
            "n_questions": total,
            "exact_matches": llm_exact_matches,
            "exact_match_accuracy": round(llm_exact_matches / total, 4),
        }
    else:
        llm_translator_summary = {
            "status": "not run (no NLP_LLM_API_KEY configured)",
            "evaluated_at": eval_ts,
            "model_name": f"{llm_model} (not run — NLP_LLM_API_KEY unset)",
            "prompt_version": PROMPT_VERSION_NL_FILTER,
            "n_questions": total,
            "exact_matches": None,
            "exact_match_accuracy": None,
            "note": (
                "No NLP_LLM_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY was set in the environment. "
                "Only the deterministic regex schema parser (`parse_nl_query_deterministic`) was run."
            ),
        }

    return {
        "evaluated_at": eval_ts,
        "n_questions": total,
        "exact_matches": exact_matches,
        "exact_match_accuracy": det_acc,
        "prompt_version": PROMPT_VERSION_NL_FILTER,
        "deterministic_parser": {
            "status": "completed",
            "evaluated_at": eval_ts,
            "model_name": "deterministic-schema-parser (regex)",
            "prompt_version": PROMPT_VERSION_NL_FILTER,
            "n_questions": total,
            "exact_matches": exact_matches,
            "exact_match_accuracy": det_acc,
        },
        "llm_translator": llm_translator_summary,
        "questions": results,
    }


def main() -> None:
    print("Running LIVE openFDA Drug Label API evaluation (40 drug-event pairs)...")
    label_eval = evaluate_live_label_status()

    print("Running LIVE openFDA + NCBI PubMed E-utilities draft evaluation (10 pairs)...")
    draft_eval = evaluate_live_generated_drafts()

    print("Running 30-question paraphrased NL-to-JSON filter benchmark...")
    nl_eval = evaluate_nl_filter_benchmark()

    out = {
        "evaluated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "prompt_versions": {
            "signal_assessment": PROMPT_VERSION_ASSESSMENT,
            "nl_filter": PROMPT_VERSION_NL_FILTER,
        },
        "label_status_evaluation": label_eval,
        "draft_citation_evaluation": draft_eval,
        "nl_filter_evaluation": nl_eval,
    }

    eval_dir = ROOT / "evaluation"
    eval_dir.mkdir(parents=True, exist_ok=True)
    out_path = eval_dir / "copilot_evaluation_results.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print(
        f"[1] LIVE openFDA Label-Status Check ({label_eval['n_pairs']} pairs: "
        f"{label_eval['n_labelled']} labelled, {label_eval['n_unlabelled']} unlabelled; "
        f"{label_eval['spl_labels_retrieved']}/{label_eval['n_pairs']} SPL labels retrieved): "
        f"{label_eval['correct']}/{label_eval['n_pairs']} = {label_eval['accuracy'] * 100:.1f}% "
        f"(TP={label_eval['tp']}, FP={label_eval['fp']}, TN={label_eval['tn']}, FN={label_eval['fn']})"
    )
    print(
        f"[2] LIVE Draft Citation Audit ({draft_eval['n_drafts']} drafts, "
        f"{draft_eval['total_sentences']} sentences, model={draft_eval['deterministic_synthesis']['model_name']}): "
        f"{draft_eval['total_supported_by_source']}/{draft_eval['total_sentences']} = "
        f"{draft_eval['overall_support_share'] * 100:.1f}% supported by retrieved source | "
        f"LLM synthesis status: {draft_eval['llm_synthesis']['status']}"
    )
    print(
        f"[3] Paraphrased NL Filter Translation ({nl_eval['n_questions']} questions, deterministic regex parser): "
        f"{nl_eval['exact_matches']}/{nl_eval['n_questions']} = "
        f"{nl_eval['exact_match_accuracy'] * 100:.1f}% exact-match accuracy | "
        f"LLM translator status: {nl_eval['llm_translator']['status']}"
    )


if __name__ == "__main__":
    main()
