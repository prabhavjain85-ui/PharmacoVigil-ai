"""
Weak supervision reference for ML prioritisation on the synthetic sample dataset.

Labels are NOT regulatory ground truth. They mark drug–event pairs that were
*planted* in ``make_sample_data.py`` (boosted_pairs) plus a small set of
well-known pharmacovigilance associations for drugs present in the demo data.
All other pairs with min_cases are treated as negatives for training.
"""
from __future__ import annotations

# Pairs intentionally boosted in synthetic data generation (canonical drug, PT)
PLANTED_REFERENCE_PAIRS: frozenset[tuple[str, str]] = frozenset({
    ("WARFARIN", "GASTROINTESTINAL HAEMORRHAGE"),
    ("CLOPIDOGREL", "GASTROINTESTINAL HAEMORRHAGE"),
    ("SIMVASTATIN", "RHABDOMYOLYSIS"),
    ("AMOXICILLIN", "ANAPHYLACTIC REACTION"),
    ("PREDNISONE", "HEPATIC FAILURE"),
})

# Additional literature-aligned associations (weak labels for demo drugs)
LITERATURE_REFERENCE_PAIRS: frozenset[tuple[str, str]] = frozenset({
    ("WARFARIN", "INTERNATIONAL NORMALISED RATIO INCREASED"),
    ("ATORVASTATIN", "MYALGIA"),
    ("LISINOPRIL", "ANGIOEDEMA"),
})

REFERENCE_POSITIVE_PAIRS: frozenset[tuple[str, str]] = (
    PLANTED_REFERENCE_PAIRS | LITERATURE_REFERENCE_PAIRS
)


def is_reference_positive(drug: str, adverse_event: str) -> bool:
    return (str(drug).upper(), str(adverse_event).upper()) in REFERENCE_POSITIVE_PAIRS
