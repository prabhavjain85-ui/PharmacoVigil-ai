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
| `/scale` | **Scale & Masking** | Competition-bias (masking) sensitivity analysis removing top-$K$ background drugs, full-quarter `2024Q2` FAERS (`5.75M` rows) scale benchmark metrics, and time-indexed historical `event_dt` cutoff validation. |

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
- **Benjamini–Hochberg FDR $q$-values:** Screening $m$ drug–event pairs simultaneously inflates family-wise Type I error. We compute step-up Benjamini–Hochberg adjusted $q$-values $q_{(k)} = \min_{j \ge k} \frac{m \cdot p_{(j)}}{j}$ and provide an interactive FDR filter ($q < 0.05, q < 0.01, q < 0.10$).
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

### 9. Competition-Bias (Masking) Sensitivity Check (`/scale`)
- **Formulation:** In spontaneous reporting databases, a small number of ultra-high-volume drugs (often specialty biologics with manufacturer patient-support programs) can contribute a large fraction of all reports for specific MedDRA Preferred Terms, inflating the background count $c$ in the $2 \times 2$ table and suppressing disproportionality ratios ($\text{PRR}, \text{ROR}, \text{IC}_{025}, \text{EB}_{05}$) for other drugs sharing those events — a phenomenon known as **competition bias** or **masking** (Pariente et al., 2007; Maignen et al., 2014).
- **Implementation (`computeMaskingCheck` in TypeScript / `compute_masking_check` in Python):** Identifies the top-$K$ ($K=5$) drugs by distinct report volume, removes all reports containing those top-$K$ drugs from the background cohort, refits the $2 \times 2$ counts and Gamma–Poisson prior on the remaining cohort, and flags every drug–event pair whose binary signal status ($\text{PRR} \ge 2 \land \chi^2 \ge 4$, $\text{IC}_{025} > 0$, or $\text{EB}_{05} \ge 2$) flips (`unmasked_new_signal` vs. `unmasked_lost_signal`).
- **Empirical Findings on Full-Quarter `2024Q2` FAERS (`evaluation/scale_benchmark_results.json`):**
  - Removing the top 5 drugs (`DUPIXENT` `23,522` reports [`5.92%`], `EVOLOCUMAB` `9,254` [`2.33%`], `ADALIMUMAB` `8,443` [`2.13%`], `METHOTREXATE` `7,006` [`1.76%`], `CIMZIA` `6,419` [`1.62%`]) reduces the background cohort from `397,119` to `352,382` reports (`238,462` remaining pairs with $a \ge 3$).
  - Across those `238,462` pairs, **9,854 pairs change signal status**: **2,117 newly unmasked signals** emerge and **7,737 borderline pairs are de-flagged**.
  - Because `DUPIXENT` (dupilumab) accounts for `5.92%` of all `2024Q2` FAERS reports and heavily reports `DERMATITIS ATOPIC`, unmasking reveals previously suppressed `DERMATITIS ATOPIC` disproportionality signals across other immunomodulators (e.g., `HYDROCORTISONE → DERMATITIS ATOPIC`: PRR `0.861 → 5.611`, $\text{IC}_{025}$ `-1.290 → +1.370`, $\text{EB}_{05}$ `0.443 → 2.697`; `CYCLOSPORINE → DERMATITIS ATOPIC`: PRR `0.561 → 3.642`, $\text{IC}_{025}$ `-1.999 → +0.662`; `CERTOLIZUMAB PEGOL → DERMATITIS ATOPIC`: PRR `1.180 → 7.747`, $\text{EB}_{05}$ `0.661 → 4.198`).
- **Primary references:**
  - Pariente A, Gregoire F, Fourrier-Reglat A, Haramburu F, Moore N (2007). *Impact of safety alerts on measures of disproportionality in spontaneous reporting databases: the notoriety bias.* Drug Safety, 30(10):891–898.
  - Maignen F, Hauben M, Hung E, Holle LV, Dogne JM (2014). *A conceptual approach to the masking effect of measures of disproportionality.* Pharmacoepidemiology and Drug Safety, 23(2):208–217.

### 10. Full-Quarter FAERS (`2024Q2`) Scale Benchmark & Web Worker Performance
- **Web Worker Architecture:** `web/lib/pipeline/analysisWorker.ts` and `web/lib/pipeline/workerClient.ts` run CSV parsing (`parseCsv`) and the entire `runAnalysis` pipeline inside a dedicated Web Worker with monomorphic row factories, string unpinning, string interning, and contiguous integer case indexing.
- **Full Raw FDA FAERS Quarter (`2024Q2`) Benchmark (`scripts/benchmark_full_quarter.mjs` → `evaluation/scale_benchmark_results.json`):**

| Metric | Full `2024Q2` FAERS Value |
| :--- | :---: |
| Raw `DEMO24Q2` / Deduplicated Cases | `397,119` / `397,119` (`200` cross-`caseid` probable duplicates flagged) |
| Raw `DRUG24Q2` / `REAC24Q2` Rows | `1,888,937` / `1,445,044` |
| Raw `OUTC24Q2` / `INDI24Q2` / `THER24Q2` Rows | `291,572` / `1,187,626` / `539,334` |
| **Total Raw ASCII Table Rows** | **5,749,632** |
| **Deduplicated Case–Drug–Event Pairs** | **6,232,442** |
| **Evaluated Drug–Event Signals ($a \ge 3$)** | **243,664** (`186,504` PRR, `198,343` BCPNN, `172,023` EBGM, `185,763` BH-FDR) |
| Weibull TTO Fitted Pairs ($n \ge 10$) | `9,801` |
| Parse Time (all 6 ASCII tables) | **9.49 s** |
| Full Statistical + ML + Masking Analysis Time | **121.24 s** |
| **Total End-to-End Wall-Clock Time** | **130.73 s** |
| **Peak V8 Heap / Process RSS** | **2,130.9 MB / 2,501 MB** |

### 11. Time-Indexed Historical Cutoff Evaluation (`scripts/evaluate_time_indexed.py` → `evaluation/time_indexed_evaluation.json`)
- **Methodology:** Following Harpaz et al. (*Clin Pharmacol Ther* 2014;96(2):239–246), we evaluate whether disproportionality detectors and the ML prioritizer identify known positive drug–event associations strictly from reports whose adverse event occurred on or before sequential historical cutoff dates (`DEMO.event_dt <= cutoff_date`, restricted to valid 8-digit `YYYYMMDD` dates) against 60 published positive and negative controls (`reference_data/time_indexed_reference_set.csv`: 30 positives, 30 negatives).
- **Empirical Results Across Sequential `DEMO.event_dt` Cutoffs (`2024Q2` Extract):**

| Historical Cutoff (`event_dt <=`) | Pre-Cutoff Cases | Scored Controls ($a \ge 3$) | PRR ($\ge 2, \chi^2 \ge 4$) Sens / Spec / PPV | BCPNN ($\text{IC}_{025} > 0$) Sens / Spec / PPV | MGPS ($\text{EB}_{05} \ge 2$) Sens / Spec / PPV | $\text{IC}_{025}$ ROC-AUC | ML Prioritizer ROC-AUC / PR-AUC |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `20231231` | `74,643` | `36/60` (`+23 / -13`) | `95.7% / 46.2% / 75.9%` | `95.7% / 46.2% / 75.9%` | `91.3% / 69.2% / 84.0%` | `0.8428` | **0.8428 / 0.9004** |
| `20240331` | `125,253` | `39/60` (`+25 / -14`) | `92.0% / 50.0% / 76.7%` | `92.0% / 50.0% / 76.7%` | `92.0% / 64.3% / 82.1%` | `0.8886` | **0.8914 / 0.9406** |
| `20240515` | `161,412` | `40/60` (`+26 / -14`) | `88.5% / 57.1% / 79.3%` | `88.5% / 50.0% / 76.7%` | `88.5% / 64.3% / 82.1%` | `0.8819` | **0.8970 / 0.9509** |
| `20240630` | `178,263` | `41/60` (`+27 / -14`) | `85.2% / 57.1% / 79.3%` | `85.2% / 57.1% / 79.3%` | `85.2% / 64.3% / 82.1%` | `0.8677` | **0.8757 / 0.9414** |

- **Trade-offs & Limitations of `event_dt` Historical Slicing:** Filtering by `DEMO.event_dt` measures signal accumulation by true clinical onset date, but `~55%` of quarterly FAERS reports omit a complete 8-digit `YYYYMMDD` `event_dt`, and retrospective `event_dt` filtering within a later quarterly file includes delayed follow-up reports received after the cutoff (`fda_dt > event_dt`). Conversely,MGPS ($\text{EB}_{05} \ge 2$) consistently improves specificity (`64.3%–69.2%` vs. `46.2%–57.1%` for PRR/BCPNN) and PPV (`82.1%–84.0%`) by shrinking noisy low-count negative controls toward the prior.
- **Primary reference:** Harpaz R, Odgers D, Gaskin G, DuMouchel W, Winnenburg R, Bodenreider O, et al. (2014). *A time-indexed reference standard of adverse drug reactions.* Scientific Data / Clinical Pharmacology & Therapeutics, 96(2):239–246.

### 12. Supervised ML Prioritisation (`/ml`)
- **Offline Training on Real Multi-Quarter FAERS (`2023Q3–2024Q2`):** Trained by `train_prioritizer.py` across **4 consecutive FDA FAERS quarters** (`1,490,754` deduplicated cases, `135,401` superseded case versions dropped) against `215` scored controls (`127` positive, `88` negative) from the **OMOP** (Ryan et al., 2013) and **EU-ADR** (Coloma et al., 2013) reference standards and exported to `web/lib/pipeline/prioritizerModel.json`.
- **5× Repeated 5-Fold Drug-Grouped Cross-Validation (`prioritizerModel.json`):**

| Ranker / Model | Drug-Grouped CV ROC-AUC | Drug-Grouped CV PR-AUC | Precision@10 | Precision@25 | Precision@50 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **L2 Logistic Regression (All 17 Features)** | **0.8808 ± 0.0080** | **0.9104 ± 0.0093** | **0.980** | **0.976** | **0.956** |
| Gradient Boosting (All 17 Features) | `0.8800 ± 0.0042` | `0.9145 ± 0.0043` | `1.000` | `0.992` | `0.968` |
| L2 Logistic Regression (Disproportionality Only) | `0.8360 ± 0.0034` | `0.8796 ± 0.0035` | `1.000` | `0.936` | `0.940` |
| Baseline: ROR Lower 95% Bound | `0.8185` | `0.8439` | `0.800` | `0.920` | `0.900` |
| Baseline: MGPS $\text{EB}_{05}$ | `0.8177` | `0.8428` | `0.800` | `0.880` | `0.900` |
| Baseline: BCPNN $\text{IC}_{025}$ | `0.8148` | `0.8399` | `0.800` | `0.880` | `0.900` |
| Baseline: PRR | `0.7870` | `0.8090` | `0.800` | `0.840` | `0.860` |

- **Primary references:**
  - Ryan PB, Schuemie MJ, Welebob E, Duke J, Valentine S, Hartzema AG (2013). *Defining a reference set to support methodological research in drug safety.* Drug Safety, 36(Suppl 1):S33–S47.
  - Coloma PM, Avillach P, Salvo F, Schuemie MJ, Ferrajolo C, Pariente A, et al. (2013). *A reference standard for evaluation of methods for drug safety signal detection using electronic healthcare record databases.* Drug Safety, 36(1):13–23.

### 13. Optional Backend Features: Signal Assessment Drafts, "Ask Your Data" JSON Filter & Live openFDA Counts (`signal_copilot.py` & `main.py`)
- **Static-First Architecture:** The public Next.js site (`web/`) is a static export (`output: "export"`) with no server. All external-API and LLM features are **off by default** and enabled only when `NEXT_PUBLIC_API_URL` is configured. With no backend configured, the site builds and behaves identically to before, with backend buttons disabled and accompanied by an explicit explanation. API keys (`NLP_LLM_API_KEY`, `OPENFDA_API_KEY`, `NCBI_API_KEY`) live exclusively on the server (`main.py`), never in client code, the static bundle, the repo, or logs.
- **Signal Assessment Drafts (`POST /api/signals/assess`, button on each row of `/signals`):**
  - Accepts **only aggregate statistics** (`AggregatePairStatsModel` with `extra="forbid"`, rejecting any report-level data).
  - Retrieves product label sections (`boxed_warning`, `warnings`, `adverse_reactions`) from the openFDA Drug Label API and up to 20 PubMed abstracts (newest first) via NCBI E-utilities.
  - Determines `"already labelled"` deterministically (`determine_label_status`) by matching the event and its clinical synonyms against the retrieved SPL sections with a negation guard (`no evidence of`, `not associated with`), returning the verbatim label excerpt.
  - Verifies every factual sentence after generation (`verify_draft_sentences`) to ensure each cited tag (`[LABEL:...]`, `[PMID:...]`, `[STATS]`) exists in what was retrieved, drops unverified sentences, sanitizes causal language so the draft never states that the drug causes the event, records `model_name`, `prompt_version`, and `retrieval_timestamp`, and exports as Markdown (`.md`).
- **Ask Your Data (`POST /api/signals/filter-query`, search box on `/signals`):**
  - Translates natural-language questions (e.g., `"serious events for warfarin with at least 5 cases not flagged by PRR"`) into a strictly validated JSON filter (`validate_signal_filter`) over allowed fields and operators, applied with ordinary code (`apply_signal_filter`) — never executing model-written code or SQL. Displays the interpreted filter as interactive chips so the user can inspect and edit clauses.
- **Live Data from openFDA (`GET /api/openfda/live-signals`, new option on `/upload`):**
  - Queries openFDA `drug/event` count endpoints for $a$ (reports with drug & event), $a+b$ (drug total), $a+c$ (event total), and $N$ (all reports), builds the $2 \times 2$ tables, and runs the existing disproportionality pipeline (`compute_disproportionality_from_counts` / `runOpenFdaCountAnalysis`). Clearly warns that openFDA API counts are not de-duplicated quarterly FAERS extracts and marks all 11 case-level ML features as **Missing (`0%` coverage)**.
- **Rate Limiting & Spending Cap:** All routes in `main.py` are protected by `SlidingWindowRateLimiter` (default `15 RPM` per client/route) and `check_spending_cap` (`MAX_REQUEST_COST_USD = $0.02`, `MAX_OUTPUT_TOKENS = 1200`).

#### Evaluation Summary (`scripts/evaluate_signal_copilot.py` & `evaluation/copilot_evaluation_results.json`)
1. **Deterministic SPL Label-Status Check (20 drug–event pairs: 10 known labelled, 10 known unlabelled):** **20/20 (`100.0%` accuracy; `TP=10, FP=0, TN=10, FN=0`)**.
2. **Natural-Language → Validated JSON Filter (30 benchmark questions):** **30/30 (`100.0%` exact-match accuracy)**.
3. **Hand-Checked Citation Audit across 10 Generated Signal Assessment Drafts (`71/71 = 100.0%` sentences supported by cited source):**

| Draft | Drug → Adverse Event Pair | Deterministic Label Status | PubMed Abstracts | Verified Sentences | Hand-Checked Source-Supported Share |
| :--- | :--- | :--- | :---: | :---: | :---: |
| `D01` | `WARFARIN → GASTROINTESTINAL HAEMORRHAGE` | Labelled (`boxed_warning`) | 2 | 8 | **100.0% (8/8)** |
| `D02` | `ATORVASTATIN → RHABDOMYOLYSIS` | Labelled (`warnings`) | 2 | 8 | **100.0% (8/8)** |
| `D03` | `LISINOPRIL → ANGIOEDEMA` | Labelled (`warnings`) | 1 | 7 | **100.0% (7/7)** |
| `D04` | `AMOXICILLIN → ANAPHYLACTIC REACTION` | Labelled (`warnings`) | 1 | 7 | **100.0% (7/7)** |
| `D05` | `METFORMIN → LACTIC ACIDOSIS` | Labelled (`boxed_warning`) | 2 | 8 | **100.0% (8/8)** |
| `D06` | `ACETAMINOPHEN → HEPATIC FAILURE` | Labelled (`boxed_warning`) | 1 | 7 | **100.0% (7/7)** |
| `D07` | `METFORMIN → RHABDOMYOLYSIS` | Not in label (`not_found_in_label`) | 1 | 7 | **100.0% (7/7)** |
| `D08` | `LORATADINE → GASTROINTESTINAL HAEMORRHAGE` | Not in label (`not_found_in_label`) | 0 | 7 | **100.0% (7/7)** |
| `D09` | `CIPROFLOXACIN → TENDON RUPTURE` | Labelled (`boxed_warning`) | 1 | 7 | **100.0% (7/7)** |
| `D10` | `EXPERIMENTAL_COMPOUND_X99 → IDIOSYNCRATIC NEUROPATHY` | No label (`no_label_retrieved`) | 0 | 5 | **100.0% (5/5, empty-retrieval refusal)** |

---

## Verification & Python–Browser Parity

Run the Python unit test suite (including hand-checked arithmetic & masking tests in `tests/test_advanced_statistics.py`, copilot evaluation tests in `tests/test_signal_copilot.py`, and time-indexed historical evaluation):

```bash
pip install -r requirements.txt
pytest tests/
python3 scripts/evaluate_signal_copilot.py
python3 scripts/evaluate_time_indexed.py
```

Regenerate and verify the Python–TypeScript parity fixture across all 110 sample pairs, 17 ML features, EBGM/EB05 (within `0.02`), $p$-values, BH $q$-values, Mantel–Haenszel estimates, Weibull TTO shapes, $\Omega$ interactions, competition-bias masking check, and temporal series:

```bash
PYTHONPATH=. python3 scripts/export_parity_fixture.py
npx tsx scripts/parity-check.mjs
```


