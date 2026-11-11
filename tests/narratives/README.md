# Synthetic Clinical Narrative Evaluation Benchmark (`tests/narratives/`)

This directory contains 60 synthetic pharmacovigilance case narratives with gold-standard annotations (`gold_narratives.json`) and pre-computed evaluation metrics (`benchmark_results.json`).

## Composition
- **60 total synthetic narratives** (`N01`–`N60`)
- **20 narratives** containing negated (`"no evidence of"`, `"denies"`, `"ruled out"`), historical (`"past medical history of"`), family-history (`"family history of"`), or uncertain (`"to rule out"`, `"possible"`) mentions
- **40 narratives** describing affirmed suspect/concomitant drugs, reactions, dechallenge/rechallenge, seriousness criteria, reporter occupation, and patient demographics

## Disclaimer
These narratives are synthetic test fixtures constructed solely for technical pipeline evaluation. They do **not** establish clinical validity or regulatory readiness. Every extracted case requires human review.
