# PharmacoVigil AI

**PharmacoVigil AI** is a browser-based workspace for **quantitative pharmacovigilance, statistical signal detection, and explainable ML triage**. It ingests FAERS-style case tables (`DEMO`, `DRUG`, `REAC`, plus optional `OUTC`, `INDI`, `THER`), executes CSV parsing and statistical analysis inside a background **Web Worker**, and maintains exact mathematical parity between the in-browser TypeScript pipeline (`web/lib/pipeline/`) and the Python reference pipeline (`faers_signal_detection.py`, `bayesian_stats.py`) — **without sending case data to a server**.

---

## Overview & Methodological Limitations

Pharmacovigilance teams screen spontaneous adverse event reports for unexpected drug–event and drug–drug–event associations. PharmacoVigil AI packages frequentist disproportionality, Bayesian shrinkage, Benjamini–Hochberg false discovery rate control, Mantel–Haenszel demographic stratification, Weibull time-to-onset hazard modelling, temporal cumulative IC & change-point detection, Norén's $\Omega$ drug–drug interaction shrinkage, and an offline-trained ML prioritisation model into one unified workspace.

**Methodological Limitations (stated on every analysis view):**
- **Spontaneous-report bias:** FAERS is a voluntary reporting system subject to severe under-reporting, stimulated reporting (the Weber effect, regulatory safety alerts, media coverage, and litigation), and selective reporting of severe outcomes.
- **No exposure denominator:** Spontaneous reports lack a denominator of total patients prescribed the drug; disproportionality ratios (PRR, ROR, IC, EBGM, $\Omega$) measure relative reporting frequency within the database, **never true clinical incidence or absolute risk**.
- **Confounding by indication & co-medication:** Underlying disease states, age/sex demographics, and polypharmacy regimens frequently induce spurious associations or mask true signals.
- **Hypotheses, not causal findings:** Every statistical flag, change-point, Weibull hazard profile, and ML priority score is a **hypothesis for clinical/QPPV case review, not proof of causation**.

---

## Features by Route

| Route | Name | What you can do |
|-------|------|-----------------|
| `/` | **Dashboard** | Deduplicated case counts, drug–event pair volume, PRR / BH-FDR / BCPNN / EBGM signal counts, and top ML-priority pairs. |
| `/upload` | **Data & Web Worker** | Upload FAERS `DEMO`, `DRUG`, `REAC` (and optional `OUTC`, `INDI`, `THER`) extracts. Runs off-main-thread in a Web Worker with live progress reporting and deduplication summary. |
| `/signals` | **Signal detection** | Sortable table with PRR, $\text{PRR}_{\text{MH}}$, ROR, $\chi^2$, exact $p$-value, Benjamini–Hochberg $q$-value, IC / $\text{IC}_{025}$, EBGM / $\text{EB}_{05}$, Weibull TTO shape $\hat{k}$, probable-duplicate review & exclusion toggle, and interactive Mantel–Haenszel + Weibull inspector. |
| `/interactions` | **Drug–drug interactions** | 3-way drug–drug–event interaction surveillance using Norén et al. (2008) $\Omega$ shrinkage measure and $\Omega_{025}$ lower 95% credible bound with a 4-cell ($00, 10, 01, 11$) contingency inspector. |
| `/ml` | **ML prioritisation** | Offline-trained L2 logistic regression on OMOP and EU-ADR reference controls, held-out grouped-CV evaluation against single-statistic baselines, signed feature weights, and per-pair log-odds explanations. |
| `/nlp` | **Case narratives** | Local browser biomedical NER (`transformers.js`), NegEx clinical context detection (negation, uncertainty, history), MedDRA PT similarity candidate ranking, RxNorm mapping, and optional de-identified server LLM extraction behind explicit consent. |
| `/compare` | **Drug comparison** | Select 2–3 drugs and compare PRR side by side across shared adverse events. |
| `/trends` | **Temporal signals** | Cumulative BCPNN IC with 95% credible intervals (`[IC025, IC975]`) by quarter or month, date $\text{IC}_{025}$ first exceeded zero, and 2-segment Poisson Log-Likelihood Ratio ($G^2$) + Page's CUSUM change-point detection on reporting rates. |

---

## Statistical Methods & Primary Literature

### 1. Case De-duplication & Probable-Duplicate Detection
- **Version de-duplication (`caseid` / `caseversion`):** FAERS re-sends updated follow-up reports under a new `primaryid`. When `DEMO` includes `caseid` and `caseversion`, both `build_case_level_table` (Python) and `buildCaseLevelTable` (TypeScript) retain only the highest `caseversion` per `caseid` (reusing the rule in `faers_loader.py`) before deduplicating on `primaryid`.
- **Cross-`caseid` probable-duplicate scoring:** Separate reporters (e.g., consumer and manufacturer) often submit the same clinical event under different `caseid`s. We score candidate report pairs sharing at least one suspect drug and reaction across six fields: suspect drug Jaccard similarity ($0.30$), reaction PT Jaccard similarity ($0.25$), `event_dt` exact or $\pm 7$-day match ($0.15$), age exact or $\pm 2$-year match ($0.12$), sex ($0.10$), and reporter country ($0.08$). Pairs scoring $\ge 0.72$ are flagged for human review with their matching fields displayed; they are **never removed automatically**, and `/signals` provides an interactive toggle to exclude flagged secondary reports and inspect how PRR, FDR, BCPNN, and EBGM signal counts change.
- **Primary reference:** Norén GN, Orre R, Bate A, Edwards IR (2007). *Duplicate detection in adverse drug reaction surveillance.* Data Mining and Knowledge Discovery, 14(3):305–328.

### 2. Frequentist Disproportionality & Benjamini–Hochberg Multiple Testing Control
For each drug–event pair with $a \ge \text{min\_cases}$, a $2 \times 2$ contingency table $(a, b, c, d)$ is constructed over deduplicated reports:
- **PRR (Proportional Reporting Ratio):** $\text{PRR} = \frac{a/(a+b)}{c/(c+d)}$ (Evans et al., 2001).
- **ROR (Reporting Odds Ratio):** $\text{ROR} = \frac{a \cdot d}{b \cdot c}$ with 95% CI $\exp(\ln(\text{ROR}) \pm 1.96\sqrt{1/a + 1/b + 1/c + 1/d})$ (Rothman et al., 2004).
- **Yates-corrected $\chi^2$ & exact $p$-value:** Both Python and TypeScript compute the 1-degree-of-freedom Yates continuity-corrected $\chi^2$ and exact upper-tail survival probability $p = 1 - P(1/2, \chi^2/2) = \text{erfc}(\sqrt{\chi^2/2})$.
- **Benjamini–Hochberg FDR $q$-values:** Screening $m$ drug–event pairs simultaneously inflates family-wise Type I error. We compute step-up Benjamini–Hochberg adjusted $q$-values $q_{(k)} = \min_{j \ge k} \frac{m \cdot p_{(j)}}{j}$ and provide an interactive FDR filter ($q < 0.05, q < 0.01, q < 0.001$).
- **Primary references:**
  - Evans SJW, Waller PC, Davis S (2001). *Use of proportional reporting ratios (PRRs) for signal generation from spontaneous adverse drug reaction reports.* Pharmacoepidemiology and Drug Safety, 10(6):483–486.
  - Rothman KJ, Lanes S, Sacks ST (2004). *The reporting odds ratio and its advantages over the proportional reporting ratio.* Pharmacoepidemiology and Drug Safety, 13(8):519–523.
  - Benjamini Y, Hochberg Y (1995). *Controlling the false discovery rate: a practical and powerful approach to multiple testing.* Journal of the Royal Statistical Society: Series B, 57(1):289–300.

### 3. Bayesian Confidence Propagation Neural Network (BCPNN / IC)
- **Information Component:** $\text{IC} = \log_2\frac{(a + 0.5)N}{(a + b + 0.5)(a + c + 0.5)}$ with posterior variance $\text{Var}(\text{IC}) \approx \frac{1}{(\ln 2)^2}\left(\frac{1}{a+0.5} + \frac{1}{b+0.5} + \frac{1}{c+0.5} + \frac{1}{d+0.5}\right)$ and 95% credible bounds $\text{IC}_{025}, \text{IC}_{975} = \text{IC} \mp 1.96\sqrt{\text{Var}(\text{IC})}$. A BCPNN signal is flagged when $\text{IC}_{025} > 0$.
- **Primary reference:** Bate A, Lindquist M, Edwards IR, Olsson S, Orre R, Lansner A, De Freitas RM (1998). *A Bayesian neural network method for adverse drug reaction signal generation.* European Journal of Clinical Pharmacology, 54(4):315–321.

### 4. Empirical Bayes Geometric Mean (EBGM / MGPS) & Browser–Python Consistency
- **Gamma–Poisson Shrinkage:** Observed count $a \sim \text{Poisson}(\mu E)$ with prior $\mu \sim \text{Gamma}(\alpha, \beta)$ fitted by maximizing the Negative Binomial marginal log-likelihood over $(\alpha, \beta) \in [0.05, 50.0]^2$.
- **Exact Browser–Python Parity:** Both Python (`scipy.optimize.minimize` L-BFGS-B + `scipy.stats.gamma.ppf`) and TypeScript (Lanczos 9-term $\ln\Gamma$, box-constrained damped Newton + pattern search over $[0.05, 50.0]^2$, and regularized incomplete gamma series/Lentz continued fraction inverted via Newton–Halley) converge to the same prior and posterior quantiles (`EBGM = 1.2731`, `EB05 = 1.0303` on the Warfarin / GI haemorrhage benchmark pair — a `0.0000` difference, verified within a strict `0.02` tolerance in `npm run parity`).
- **Primary reference:** DuMouchel W (1999). *Bayesian data mining in large frequency tables, with an application to the FDA spontaneous reporting system.* The American Statistician, 53(3):177–190.

### 5. Stratified Analysis & Mantel–Haenszel Confounding Adjustment
- **Demographic Strata:** Cases with known `DEMO.age` and `DEMO.sex` are partitioned into Age Bands (`0-17`, `18-44`, `45-64`, `65+`), Sex (`F`, `M`), and 8 joint `Age Band × Sex` strata $s = 1 \dots S$.
- **Mantel–Haenszel Adjusted Estimates:**
  - $\text{PRR}_{\text{MH}} = \frac{\sum_s a_s(c_s + d_s)/N_s}{\sum_s c_s(a_s + b_s)/N_s}$
  - $\text{ROR}_{\text{MH}} = \frac{\sum_s a_s d_s / N_s}{\sum_s b_s c_s / N_s}$
  - $\text{IC}_{\text{stratified}} = \log_2\frac{\sum_s a_s + 0.5}{\sum_s E_s + 0.5}$ where $E_s = \frac{(a_s + b_s)(a_s + c_s)}{N_s}$
- **Confounding Disagreement Detection:** Pairs where $\text{PRR}_{\text{MH}}$ and pooled PRR differ by $\ge 20\%$ ($|\ln(\text{PRR}_{\text{MH}} / \text{PRR})| \ge \ln(1.2)$) or cross the $\text{PRR} = 2.0$ decision threshold are flagged as **Demographic Confounding** (`inflated_pooled` vs. `masked_pooled`).
- **Primary reference:** Mantel N, Haenszel W (1959). *Statistical aspects of the analysis of data from retrospective studies of disease.* Journal of the National Cancer Institute, 22(4):719–748.

### 6. Temporal Signal Evolution & Change-Point Detection (`/trends`)
- **Cumulative IC Trajectory:** At each calendar month (`YYYY-MM`) or quarter (`YYYY-Q#`) $t$, cumulative counts $(A_t, B_t, C_t, D_t, N_t)$ are evaluated via BCPNN to plot $\text{IC}_t$ and its 95% credible band $[\text{IC}_{025,t}, \text{IC}_{975,t}]$, highlighting the earliest period where $\text{IC}_{025,t} > 0$.
- **Change-Point Detection & False-Alarm Behaviour:** We evaluate a 2-segment Poisson Log-Likelihood Ratio ($G^2 = 2[A_{\text{pre}}\ln(A_{\text{pre}}/E_{\text{pre}}) + A_{\text{post}}\ln(A_{\text{post}}/E_{\text{post}})]$) across all split periods $k \in [1, K-1]$ alongside Page's sequential Poisson CUSUM $S_t = \max(0, S_{t-1} + a_t - k_{\text{ref}})$. Because testing $K-1$ candidate split points inflates a naive $\alpha = 0.05$ ($\chi^2_1 = 3.84$) false-alarm rate to $\approx 1 - (1 - \alpha)^{K-1}$, we require $G^2 \ge 6.63$ (per-split $p < 0.01$) to keep family-wise false-alarm probability near $\sim 5\%$ across multi-quarter surveillance horizons.
- **Primary references:**
  - Page ES (1954). *Continuous inspection schemes.* Biometrika, 41(1/2):100–115.
  - Kulldorff M (2001). *Prospective time periodic geographical disease surveillance using a scan statistic.* Journal of the Royal Statistical Society: Series A, 164(1):61–72.

### 7. Weibull Time-to-Onset (TTO) Hazard Modelling
- **Maximum Likelihood Weibull Fit:** For every drug–event pair with $n \ge 10$ valid onset times $t_i = \text{event\_dt} - \text{start\_dt} \in [0, 3650]$ days (mapping same-day $t_i = 0 \mapsto 0.5$ days), we solve the profile score equation $\frac{1}{k} + \frac{1}{n}\sum \ln t_i - \frac{\sum t_i^k \ln t_i}{\sum t_i^k} = 0$ via Newton–Raphson to obtain shape $\hat{k}$, scale $\hat{\lambda} = (\frac{1}{n}\sum t_i^{\hat{k}})^{1/\hat{k}}$, and 95% CI $\hat{k}\exp(\pm 1.96\sqrt{6/(\pi^2 n)})$.
- **Clinical Hazard Interpretation:**
  - **Early failure ($k < 1$, 95% CI $< 1$):** Decreasing hazard — risk peaks shortly after treatment initiation (e.g., acute hypersensitivity, anaphylaxis, first-dose hypotension).
  - **Random / constant hazard (95% CI spans $1.0$):** Event rate is approximately constant over therapy duration.
  - **Wear-out ($k > 1$, 95% CI $> 1$):** Increasing hazard — risk rises with cumulative duration/dose of therapy (e.g., cumulative toxicity, fibrosis).
- **Primary reference:** Sauzet O, Carvajal A, Escudero A, Molokhia M, Cornelius VR (2013). *Illustration of the weibull shape parameter signal detection tool using electronic healthcare record data.* Drug Safety, 36(10):995–1006.

### 8. Drug–Drug Interaction (DDI) Surveillance (`/interactions`)
- **Norén's $\Omega$ Shrinkage Measure:** For drug pair $(A, B)$ and adverse event $E$, cases are partitioned into 4 mutually exclusive exposure cells: $00$ (neither $A$ nor $B$), $10$ ($A$ only), $01$ ($B$ only), and $11$ (both $A$ and $B$ co-reported). Let $f_{ij} = n_{ij1}/n_{ij}$ be the event reporting proportion in cell $ij$, and $o_{ij} = f_{ij}/(1 - f_{ij})$ its reporting odds. Under the additive baseline risk model:
  $$g_{11} = 1 - \frac{1}{\max(o_{00}, o_{10}) + \max(o_{00}, o_{01}) - o_{00} + 1}, \quad E_{111} = g_{11} \cdot n_{11}$$
  $$\Omega = \log_2\frac{n_{111} + 0.5}{E_{111} + 0.5}, \quad \Omega_{025} = \Omega - \frac{1.96}{\ln(2)\sqrt{n_{111} + 0.5}}$$
  An interaction signal is flagged when $\Omega_{025} > 0$. To keep the browser responsive on polypharmacy extracts, per-case drug combinations are capped at 12 suspect drugs and the top 200 co-reported triplets are evaluated.
- **Primary reference:** Norén GN, Sundberg R, Bate A, Edwards IR (2008). *A statistical methodology for drug–drug interaction surveillance.* Statistics in Medicine, 27(16):3057–3070.

### 9. Web Worker Off-Main-Thread Performance
- **Architecture:** `web/lib/pipeline/analysisWorker.ts` and `web/lib/pipeline/workerClient.ts` run CSV parsing (`parseCsv`) and the entire `runAnalysis` pipeline inside a dedicated Web Worker with staged progress messages (`10%` column validation & version deduplication $\rightarrow$ `22%` probable-duplicate scoring $\rightarrow$ `35%` pair table join $\rightarrow$ `50%` disproportionality, exact EBGM & BH FDR $\rightarrow$ `68%` Mantel–Haenszel & Weibull MLE $\rightarrow$ `84%` ML features & $\Omega$ DDI search $\rightarrow$ `100%` complete).
- **Largest Dataset Tested:** Benchmarked on a synthetic full-quarter FAERS stress dataset of **50,000 deduplicated DEMO cases** (`52,500` raw DEMO rows with `2,500` superseded case versions dropped), **152,500 DRUG rows**, and **152,500 REAC rows** (**300,000** suspect drug–event pair rows), completing in **11.9 seconds** (`390 ms` CSV parse + `11.5 s` full statistical, stratified, Weibull, and $\Omega$ analysis) inside the background worker without blocking the UI thread.

### 10. Supervised ML Prioritisation (`/ml`)
- **Offline Training & Reference Sets:** Trained offline by `train_prioritizer.py` on published ground-truth controls from the **OMOP** (Ryan et al., 2013) and **EU-ADR** (Coloma et al., 2013) reference sets and exported to `web/lib/pipeline/prioritizerModel.json`.
- **Primary references:**
  - Ryan PB, Schuemie MJ, Welebob E, Duke J, Valentine S, Hartzema AG (2013). *Defining a reference set to support methodological research in drug safety.* Drug Safety, 36(Suppl 1):S33–S47.
  - Coloma PM, Avillach P, Salvo F, Schuemie MJ, Ferrajolo C, Pariente A, et al. (2013). *A reference standard for evaluation of methods for drug safety signal detection using electronic healthcare record databases.* Drug Safety, 36(1):13–23.

---

## Verification & Python–Browser Parity

Run the Python unit test suite (including hand-checked arithmetic tests in `tests/test_advanced_statistics.py`):

```bash
pip install -r requirements.txt
pytest tests/
```

Regenerate and verify the Python–TypeScript parity fixture across all 110 sample pairs, 17 ML features, EBGM/EB05 (within `0.02`), $p$-values, BH $q$-values, Mantel–Haenszel estimates, Weibull TTO shapes, $\Omega$ interactions, and temporal series:

```bash
PYTHONPATH=. python3 scripts/export_parity_fixture.py
cd web && npm install && npx tsc --noEmit && npm run lint && npm run parity
```
