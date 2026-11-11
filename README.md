# PharmacoVigil AI

**PharmacoVigil AI** is a browser-based workspace for using **AI and machine learning in pharmacovigilance** day to day. It ingests FAERS-style case tables, runs disproportionality and Bayesian signal screens, ranks drug–event pairs with an explainable ML triage model, and supports narrative entity extraction, drug comparison, and simple time trends—all **without sending data to a server**.

The production app is a static **Next.js** site on Vercel. Analysis runs entirely in the client. A optional **Python** pipeline in this repository provides parity tests and an API for local experimentation.

---

## Overview

Pharmacovigilance teams screen spontaneous reports for unexpected drug–adverse event associations. PharmacoVigil AI packages common quantitative methods (frequentist and Bayesian disproportionality, ML prioritisation) and lightweight NLP helpers into one polished UI. Upload your own quarterly DEMO / DRUG / REAC extracts, or use the bundled synthetic sample to explore the workflow.

**What this is not:** a validated medical device, a full RxNorm or MedDRA service, or a replacement for qualified person (QPPV) review. Signals are hypotheses; causality requires clinical and regulatory follow-up.

---

## Features by section

| Route | Name | What you can do |
|-------|------|-----------------|
| `/` | **Dashboard** | Case counts, drug–event pair volume, PRR / BCPNN / EBGM signal counts, top ML-priority pairs for the loaded dataset. |
| `/upload` | **Data** | Upload FAERS DEMO, DRUG, and REAC files (CSV/TXT). Parse and analyse in-browser. Reset to the bundled sample dataset at any time. |
| `/signals` | **Signal detection** | Sortable table of drug–event pairs with PRR, ROR, χ², IC (BCPNN), EBGM / EB05, multi-method flags, ML rank. Filter, adjust minimum case count, **export CSV**. |
| `/ml` | **ML prioritisation** | Priority scores (0–1) from a pretrained model, its model card and held-out performance against single-statistic baselines, signed feature weights, and signed per-pair drivers. |
| `/nlp` | **Case narratives** | Paste free text; extract suspected drugs (with brand→generic mapping), reactions, onset hints, and seriousness keywords. Method labelled as rule-based. |
| `/compare` | **Drug comparison** | Select two or three drugs; view shared adverse events and PRR side by side. |
| `/trends` | **Trends** | When `event_dt` is present on DEMO, plot monthly pair counts per drug (volume trend, not a formal scan statistic). |

Dark/light theme and responsive layout are supported throughout.

---

## Methods (and honest limitations)

### Data join

Reports are joined on `primaryid` across DEMO (demographics), DRUG (products), and REAC (MedDRA preferred terms). Suspect drugs are normalized (salt stripping, demo alias map). Optional `role_cod` on DRUG: when present, only `PS` / `SS` rows are used.

### Frequentist disproportionality

For each drug–event pair a 2×2 table is built over all cases in the loaded dataset:

| | Event | Other events |
|---|--------|----------------|
| **Drug** | *a* | *b* |
| **Other drugs** | *c* | *d* |

- **PRR** = (a/(a+b)) / (c/(c+d))
- **ROR** = (a×d) / (b×c)
- **χ²** — Yates-corrected chi-square on the table

**PRR screen (default):** PRR ≥ 2, χ² ≥ 4, and case count ≥ minimum (default 3). Same convention as many agency workflows; not universal.

**Limits:** spontaneous reporting bias, confounding by indication, duplicate reports, and multiple testing are not adjusted beyond EBGM shrinkage.

### BCPNN (Information Component)

- **IC** = log₂((a·N) / ((a+b)(a+c))) with continuity correction on sparse cells
- **IC025 / IC975** — approximate 95% credibility interval on IC
- **BCPNN signal:** IC025 > 0 (WHO-UMC-style screen)

**Limits:** normal approximation on IC; may disagree with PRR on borderline cells.

### EBGM (gamma–Poisson shrinkage)

A dataset-level gamma prior is fit across all pairs (DuMouchel-style marginal likelihood, grid search in TypeScript; L-BFGS in Python). Per pair:

- **EBGM** — posterior mean reporting rate
- **EB05 / EB95** — approximate posterior percentiles
- **EBGM signal:** EB05 > 2 (FDA MGPS-style rule of thumb)

**Limits:** simplified prior vs full multi-item MGPS products. The browser fits the prior on a coarse grid and uses a Wilson–Hilferty gamma quantile, so its EBGM values differ somewhat from the Python ones.

### ML prioritisation

A pretrained **L2 logistic regression** ranks drug–event pairs. It is trained offline by `train_prioritizer.py` and shipped as `web/lib/pipeline/prioritizerModel.json`, which both the browser and the Python pipeline load. Nothing is trained on the data you upload.

**Labels.** Ground truth comes from two published reference sets (`reference_data/`): OMOP (Ryan et al. 2013; 165 positive and 234 negative drug–outcome controls) and EU-ADR (Coloma et al. 2013; 43 positive, 50 negative). Pairs outside the reference sets are unlabelled and are never treated as negatives. The reference outcomes are health outcomes of interest such as acute liver injury, so for training the MedDRA preferred terms listed in `reference_data/outcome_pt_map.json` are folded into each outcome. That mapping is a hand-written approximation, not an official SMQ; review it.

**Features.**

| Group | Features | Source |
|-------|----------|--------|
| Disproportionality | IC, IC025, log PRR, log ROR lower 95% bound, log(1 + χ²), log(1 + cases) | The 2×2 table (always available) |
| Case-level | Fatal / hospitalised or life-threatening / any serious outcome fractions | OUTC `outc_cod` |
| | Health-professional reporter fraction, female fraction, mean age | DEMO `occp_cod`, `sex`, `age`, `age_cod` |
| | Median days to onset, fraction with onset within 30 days | THER `start_dt` and DEMO `event_dt` |
| | Fraction of reports where the event is also a reported indication | INDI `indi_pt` |
| | Mean drugs per report, primary-suspect fraction | DRUG `drugname`, `role_cod` |

A case-level feature whose table or column is missing is imputed with the training mean and contributes nothing to the score. The drug's and the event's share of all reports are deliberately excluded: the reference sets cover ten outcomes with very different positive-to-negative ratios, and either share lets a model work out which outcome a row belongs to rather than how strong the signal is. EBGM is reported but is not a model feature, because the browser and Python fit the shrinkage prior differently.

**Evaluation.** Five repeats of 5-fold cross-validation grouped by drug, so no drug appears in both the training and the test fold. AUC, average precision and precision@k are reported for the logistic model with all features, with disproportionality features only, for gradient boosting, and for ranking by PRR, ROR lower bound, IC025, EB05, χ² or case count alone. With `--features auto` (default) the case-level features are exported only if they beat the disproportionality-only model by more than one standard deviation. The results are stored in the model file and shown on the `/ml` page.

**Explanations.** Signed and exact for a linear model: feature *j* contributes `weight_j × (x_j − mean_j) / std_j` to the log-odds, so each driver shows whether it raised or lowered the priority relative to an average training pair.

**Retraining on real FAERS.** Download quarterly ASCII files from the FDA, unzip them, then:

```bash
python train_prioritizer.py --faers-dir faers/24Q1/ASCII faers/24Q2/ASCII faers/24Q3/ASCII faers/24Q4/ASCII
PYTHONPATH=. python3 scripts/export_parity_fixture.py
cd web && npm run parity
```

Quarters are concatenated and reduced to the latest version of each case. Use several quarters: a control needs at least `--min-cases` reports to be scored.

**The bundled weights are placeholders.** They were fitted with `python train_prioritizer.py --synthetic` on a synthetic benchmark in which only the reporting rate depends on the ground truth, so the case-level features carry no information there and the reported metrics say nothing about real reports. The `/ml` page shows a warning until the model is retrained on FAERS.

**Limits:** triage ranking only, not validated for regulatory decisions. The controls date from 2013, cover ten outcomes, and the positives are established, labelled reactions, so the model learns what known reactions look like in spontaneous reports. It is trained on outcome groups and applied to single preferred terms.

### Narrative NLP

Keyword and regex patterns map brand names to canonical drugs and match reaction and onset phrases. **Not** a clinical NLP model—no negation, no deep learning, not suitable for regulatory submission.

---

## Data upload format

Upload the **three** required files together on the **Data** page. The three optional files add case-level ML features:

| File | Required columns | Notes |
|------|------------------|--------|
| **DEMO** | `primaryid` | Optional: `event_dt` (YYYYMMDD) for trends |
| **DRUG** | `primaryid`, `drugname` | Optional: `role_cod` (`PS`, `SS`) |
| **REAC** | `primaryid`, `pt` | MedDRA preferred term (or text treated as PT) |
| **OUTC** (optional) | `primaryid`, `outc_cod` | Outcome seriousness features for ML prioritisation |
| **INDI** (optional) | `primaryid`, `indi_pt` | Indication-overlap feature |
| **THER** (optional) | `primaryid`, `start_dt` | Time-to-onset features; `dsg_drug_seq` links to DRUG `drug_seq` when present |

**Delimiters:** comma, pipe `|`, dollar `$`, or tab (auto-detected). Headers are case-insensitive.

**Size:** practical limit is browser memory; start with a single quarter or a filtered extract for large FAERS releases.

**Sample data:** `web/public/sample/*.csv` mirrors `sample_data/` (~200 synthetic cases, all six tables) and loads by default.

Real FAERS ASCII files: [FDA FAERS quarterly data](https://www.fda.gov/drugs/questions-and-answers-fdas-adverse-event-reporting-system-faers/fda-adverse-event-reporting-system-faers-latest-quarterly-data-files).

---

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | Next.js 14 (App Router), React 18, Tailwind CSS |
| Charts | Recharts |
| Analysis | TypeScript pipeline in `web/lib/pipeline/` |
| Deploy | Vercel static export (`web/out`) |
| Parity / optional API | Python 3, pandas, scipy, scikit-learn, FastAPI |

---

## Local development

### Web app

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production build (same as Vercel):

```bash
cd web
npm run build
npx serve out   # optional: preview static export
```

### Python parity tests

The browser pipeline is mirrored in Python for regression testing:

```bash
pip install -r requirements.txt
pytest tests/
```

Regenerate the browser parity fixture after pipeline changes:

```bash
PYTHONPATH=. python3 scripts/export_parity_fixture.py
```

This writes `web/public/data/python-parity.json`: reference metrics for the WARFARIN / GI haemorrhage pair plus every model feature and priority score for every pair in the sample. Check the browser pipeline against it with:

```bash
cd web && npm run parity
```

### Optional FastAPI backend

Not required for the Vercel site. Useful for local uploads via API:

```bash
uvicorn main:app --reload --port 8000
```

Health check: `GET /api/health`.

---

## Deploy on Vercel

1. Import the GitHub repository in Vercel.
2. Root `vercel.json` runs `cd web && npm install && npm run build` and publishes **`web/out`**.
3. No environment variables or Python runtime are required for the public app.

After deploy, all routes (`/`, `/upload`, `/signals`, etc.) are static pages with client-side analysis.

---

## Project structure

```
pharmacovigil-ai/
├── web/                          # Next.js app (deployed)
│   ├── app/                      # Routes: dashboard, upload, signals, ml, nlp, compare, trends
│   ├── components/               # App shell, views, UI
│   ├── lib/
│   │   ├── pipeline/             # In-browser FAERS parse + signal + ML logic
│   │   ├── context/              # Shared dataset state
│   │   └── nlp.ts                # Rule-based narrative extraction
│   └── public/
│       ├── sample/               # Default DEMO/DRUG/REAC CSVs
│       └── data/                 # python-parity.json
├── sample_data/                  # Source CSVs for Python pipeline & fixture export
├── faers_signal_detection.py     # Python disproportionality + ML apply
├── bayesian_stats.py             # BCPNN, EBGM prior (Python)
├── ml_prioritization.py          # Loads the exported model; scoring and signed explanations
├── pair_features.py              # Feature engineering (mirrored in web/lib/pipeline/pairFeatures.ts)
├── train_prioritizer.py          # Offline training, grouped-CV evaluation, JSON export
├── reference_sets.py             # OMOP / EU-ADR labels and outcome → PT mapping
├── reference_data/               # Reference set CSVs, outcome_pt_map.json, attribution
├── faers_loader.py               # Reads real FAERS quarters, keeps latest case version
├── make_synthetic_benchmark.py   # Synthetic FAERS-shaped data for pipeline checks
├── main.py                       # Optional FastAPI
├── tests/                        # pytest (Bayesian + pipeline)
├── scripts/
│   └── export_parity_fixture.py
├── requirements.txt
└── vercel.json
```

---

## License and attribution

Use responsibly in research, teaching, and internal triage workflows. Align operational use with ICH E2B/E2E and your organisation’s pharmacovigilance quality system.

When citing methods, refer to primary literature for PRR/ROR, WHO-UMC BCPNN, FDA MGPS/EBGM, and your own validation for any ML-assisted workflow.
