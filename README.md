# PharmacoVigil AI — seminar site + Python analysis pipeline

**PharmacoVigil AI** is a live seminar demo for *AI & Machine Learning in Pharmacovigilance*: a modern Next.js site with presentation mode, precomputed signal statistics, Bayesian screens, weak-label ML prioritisation, and an interactive narrative NLP demo.

The site runs **fully static on Vercel** (no backend required). Python code regenerates bundled JSON from synthetic FAERS-style sample data.

## Repository layout

| Path | Purpose |
|------|---------|
| `web/` | Next.js 14 + Tailwind seminar site (deployed to Vercel) |
| `web/public/data/site-bundle.json` | Precomputed stats, ML scores, NLP samples |
| `scripts/generate_site_data.py` | Regenerate `site-bundle.json` from `sample_data/` |
| `faers_signal_detection.py` | Disproportionality pipeline (PRR, BCPNN, EBGM, ML) |
| `main.py` | Optional FastAPI API for local uploads (not used by the static site) |
| `tests/` | Unit/integration tests for statistics |

## Quick start — website

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000 — use **Present** for full-screen arrow-key slides.

### Deploy (Vercel)

Root `vercel.json` builds the Next.js app in `web/` and exports static files to `web/out/`.

```bash
cd web && npm run build
```

## Regenerate demo data

After changing `sample_data/` or the Python pipeline:

```bash
pip install -r requirements.txt
PYTHONPATH=. python3 scripts/generate_site_data.py
pytest tests/
```

Commit the updated `web/public/data/site-bundle.json`.

## Optional API (local)

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Methods & honesty

- **Data:** synthetic ~200-case FAERS-shaped sample (`make_sample_data.py`), not real FDA feeds.
- **Bayesian:** BCPNN (IC025 > 0), EBGM (EB05 > 2) with dataset-level gamma–Poisson prior.
- **ML:** gradient boosting on weak reference labels (`reference_signals.py`) — triage ranking only.

## Tests

```bash
pytest tests/
```
