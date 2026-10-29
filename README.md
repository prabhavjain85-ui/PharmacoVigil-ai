# PharmacoVigil AI

**PharmacoVigil AI** is a browser-based workspace for applying **AI and machine learning in pharmacovigilance**: FAERS-style disproportionality (PRR, ROR, χ², BCPNN, EBGM), in-browser ML triage ranking, narrative entity extraction, drug comparison, and simple time trends.

All analysis runs **client-side** on Vercel (no server required). Python code in this repo regenerates parity fixtures and supports optional local API use.

## App (Vercel)

| Area | Route | Function |
|------|-------|----------|
| Dashboard | `/` | Dataset overview, signal counts |
| Data | `/upload` | Upload DEMO/DRUG/REAC CSV or reset sample |
| Signals | `/signals` | Table, filters, export CSV |
| ML priority | `/ml` | Scores, feature weights, explanations |
| Narratives | `/nlp` | Rule-based drug/reaction/onset extraction |
| Compare | `/compare` | 2–3 drug PRR matrix |
| Trends | `/trends` | Monthly counts from `event_dt` |

```bash
cd web && npm install && npm run dev
cd web && npm run build   # static export → web/out
```

## Regenerate Python parity fixture

```bash
pip install -r requirements.txt
PYTHONPATH=. python3 scripts/export_parity_fixture.py
pytest tests/
```

## Optional API

```bash
uvicorn main:app --port 8000
```

## Honesty

- Default/sample data is **synthetic** (~200 cases).
- ML uses **weak labels** (demo + literature reference pairs) — triage only, not validated.
- NLP is **keyword/rule-based**, not clinical-grade NLP.
