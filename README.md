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
| `/ml` | **ML prioritisation** | Priority scores (0–1), global feature weights, and per-pair explanation of top drivers—retrained on the **currently loaded** data. |
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

**Limits:** simplified prior vs full multi-item MGPS products; EB05 in the browser uses a fast approximation.

### ML prioritisation

Features: PRR, ROR, χ², IC, EBGM, EB05, case count, log(cases), serious-PT flag, drug/event report shares.

**Training:** logistic regression in the browser (gradient descent), with **weak labels**—pairs marked positive if they appear in a small reference set (synthetic planted signals in sample data + a few literature-aligned pairs in `reference_signals.py`). Everything else is treated as negative.

**Output:** priority score (probability-like), rank, and top feature contributions (value × normalized weight).

**Limits:** labels are incomplete and not ground truth; the model is for **triage ranking only**, not validated performance metrics. Retrain happens whenever you load new data—scores are dataset-specific.

### Narrative NLP

Keyword and regex patterns map brand names to canonical drugs and match reaction and onset phrases. **Not** a clinical NLP model—no negation, no deep learning, not suitable for regulatory submission.

---

## Data upload format

Upload **three** files together on the **Data** page:

| File | Required columns | Notes |
|------|------------------|--------|
| **DEMO** | `primaryid` | Optional: `event_dt` (YYYYMMDD) for trends |
| **DRUG** | `primaryid`, `drugname` | Optional: `role_cod` (`PS`, `SS`) |
| **REAC** | `primaryid`, `pt` | MedDRA preferred term (or text treated as PT) |

**Delimiters:** comma, pipe `|`, dollar `$`, or tab (auto-detected). Headers are case-insensitive.

**Size:** practical limit is browser memory; start with a single quarter or a filtered extract for large FAERS releases.

**Sample data:** `web/public/sample/*.csv` mirrors `sample_data/` (~200 synthetic cases) and loads by default.

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

This writes `web/public/data/python-parity.json` (reference metrics for the WARFARIN / GI haemorrhage pair on sample data).

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
├── ml_prioritization.py          # Gradient boosting (Python reference)
├── reference_signals.py          # Weak-label reference pairs
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
