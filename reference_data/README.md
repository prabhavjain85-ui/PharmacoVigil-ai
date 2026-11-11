# Pharmacovigilance Reference Sets (OMOP & EU-ADR)

This directory contains positive and negative drug–outcome controls used as ground truth for training and evaluating the ML signal prioritisation model.

## Sources & Citations

1. **OMOP Reference Set** (`omop_reference_set.csv` — 399 controls: 165 positive, 234 negative)
   - Ryan PB, Schuemie MJ, Welebob E, Duke J, Valentine S, Hartzema AG. *Defining a reference set to support methodological research in drug safety.* Drug Safety. 2013;36 Suppl 1:S33-47.

2. **EU-ADR Reference Set** (`euadr_reference_set.csv` — 93 controls: 43 positive, 50 negative)
   - Coloma PM, Avillach P, Salvo F, Schuemie MJ, Ferrajolo C, Pariente A, Fourrier-Réglat A, Molokhia M, Patadia V, Sturkenboom M, Trifirò G. *A reference standard for evaluation of methods for drug safety signal detection using electronic healthcare record databases.* Drug Safety. 2013;36(1):13-23.

## Upstream Distribution & Licence

Extracted from `data/omopReferenceSet.rda` and `data/euadrReferenceSet.rda` in the **OHDSI MethodEvaluation** R package (<https://github.com/OHDSI/MethodEvaluation>), distributed under the **Apache License 2.0**.

## Outcome Mapping (`outcome_pt_map.json`)

Maps the 10 health outcomes of interest (HOIs) in the OMOP and EU-ADR reference sets to hand-curated approximations of MedDRA Preferred Terms (PTs). Note that this mapping is an approximation for research and triage benchmarking and is **not** an official Standardized MedDRA Query (SMQ).
