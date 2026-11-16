# Clinical Case Narrative Annotation Guideline

## 1. Purpose & Separation of Datasets

This repository maintains two strictly separated narrative datasets for evaluating clinical adverse-event narrative extractors:

1. **Development Set (`tests/narratives/gold_narratives.json`, $N = 60$)**:
   - Constructed during initial development to test rule coverage, NegEx/ConText negation/history/uncertainty scope, and structured ICSR field extraction.
   - Used for developing and debugging deterministic rules; **not** an independent measure of out-of-sample generalisation.

2. **Independent Open-Access PubMed Central Test Set (`tests/narratives/pmc_independent_test_set.json`, $N = 64$)**:
   - Verbatim clinical case presentation excerpts retrieved from published open-access case reports in PubMed Central (`"Case Reports"[Publication Type] AND "pubmed pmc open access"[Filter]`) via NCBI E-utilities (`esearch.fcgi` and `efetch.fcgi`).
   - Every entry records its PubMed ID (`pmid`), PubMed Central ID (`pmcid`), DOI (`doi`), journal (`journal`), publication year (`year`), article title (`title`), and Creative Commons / PMC Open Access licence (`license`).
   - Extractor rules and dictionaries were **not** tuned on this test set.

---

## 2. Entity & Field Annotation Protocol

All annotations are derived from human clinical reading of the verbatim excerpt and the published case report title/abstract metadata, independent of any extractor's output:

### 2.1 Suspect Drugs (`suspect_drugs`)
- Record the uppercase canonical generic active ingredient name (e.g., `APIXABAN`, `PEMBROLIZUMAB`, `ATORVASTATIN`, `LAMOTRIGINE`) for any medication explicitly identified in the narrative and/or case report title as inducing, triggering, or co-causing the adverse event.
- Multi-drug interactions where both agents are described as co-causative (e.g., `"Combination of atorvastatin and ticagrelor associated with rhabdomyolysis"`, `"Lamotrigine Combined With Valproic Acid"`) include both drugs in `suspect_drugs`.
- Do **not** include medications administered solely as rescue/treatment for the adverse reaction itself (e.g., corticosteroids, intravenous immunoglobulins, N-acetylcysteine, or penicillin G switched to after the reaction).

### 2.2 Concomitant Drugs (`concomitant_drugs`)
- Record the uppercase canonical generic ingredient name for medications explicitly stated in the excerpt as background, home, chronic, or co-administered therapy that are **not** implicated as causative of the adverse reaction.

### 2.3 Active Adverse Reactions (`active_reactions`)
- Record all affirmed adverse drug reactions experienced by the patient during the current clinical episode that map to the 41-term MedDRA Preferred Term (PT) reference vocabulary (`DEFAULT_REAC_PTS`).
- Standard clinical synonyms in the narrative map to their canonical PT:
  - `Toxic epidermal necrolysis (TEN)` / `Stevens-Johnson syndrome (SJS)` $\rightarrow$ `TOXIC EPIDERMAL NECROLYSIS` / `STEVENS-JOHNSON SYNDROME`
  - `Drug-induced liver injury (DILI)` / `acute liver failure` / `hepatotoxicity` / `transaminitis` / `cholestatic hepatitis` $\rightarrow$ `HEPATIC FAILURE`
  - `Acute kidney injury (AKI)` / `acute renal failure` $\rightarrow$ `ACUTE KIDNEY INJURY`
  - `Gastrointestinal bleeding` / `melena` / `hematemesis` / `upper GI bleed` $\rightarrow$ `GASTROINTESTINAL HAEMORRHAGE`
  - `Agranulocytosis` / `febrile neutropenia` / `leukopenia` $\rightarrow$ `AGRANULOCYTOSIS` / `NEUTROPENIA`
  - `Torsades de pointes` / `QTc prolongation` $\rightarrow$ `QT PROLONGATION`

### 2.4 Verbatim Reaction Mentions for Term-Mapping Evaluation (`reaction_mentions`)
- To evaluate MedDRA Preferred Term (PT) candidate ranking (`Top-1` and `Top-3` accuracy) independently of NER span boundaries, each case records `reaction_mentions: [{ "verbatim": "...", "gold_pt": "..." }]` containing the exact verbatim clinical phrase from `text` and its gold canonical PT.

### 2.5 Negated, Ruled-Out, or Historical Mentions (`negated_or_historical_reactions`)
- Record any reaction/condition from the reference vocabulary that appears in the excerpt under:
  - Explicit negation (`"no evidence of ..."`, `"without thrombocytopenia"`, `"ruled out ..."`, `"without side effects"`),
  - Prior/baseline medical history (`"history of ..."`, `"no prior history of liver disease"`), or
  - Diagnostic uncertainty (`"to rule out ..."`).
- A reaction that is negated or historical must **not** appear in `active_reactions` unless it also occurred as a new, affirmed reaction in the current episode.

### 2.6 ICH E2A Seriousness (`serious`)
- Set `serious: true` if the narrative describes death, a life-threatening event, initial or prolonged hospitalisation/admission, persistent disability, congenital anomaly, or an ICH E2A medically important condition (e.g., SJS/TEN, rhabdomyolysis, acute liver/kidney failure, agranulocytosis, pancytopenia, anaphylaxis, GI haemorrhage).

### 2.7 Demographics (`age`, `sex`)
- `age`: Integer age in years (`1`–`120`) if explicitly stated in the excerpt; `null` if omitted or stated only as a decade (`"septuagenarian"`).
- `sex`: `"M"` (male/man/boy) or `"F"` (female/woman/girl) if explicitly stated in the excerpt; `null` otherwise.

### 2.8 Clinical Course & Reporter (`reporter`, `dechallenge`, `outcome`)
- `reporter`: Annotated **only** when the excerpt itself explicitly states the reporter occupation in text (`"visited her physician"`, `"reported by ..."` $\rightarrow$ `"MD"`). If the excerpt does not contain an explicit reporter phrase, `reporter` is `null`.
- `dechallenge`: `"positive"` if the excerpt explicitly states that the reaction improved, normalized, or resolved after discontinuing/withholding the drug; `"negative"` if it persisted or worsened after stopping; `null` if not stated in the excerpt.
- `outcome`: `"recovered"` (resolved/normalized), `"recovering"` (trending down/improving), `"not_recovered"` (persisted/ongoing), or `"fatal"` (death/fatal outcome) if explicitly stated in the excerpt; `null` otherwise.
