export type FaersRow = Record<string, string>;

export type PriorityExplain = {
  feature: string;
  label: string;
  value: number;
  contribution: number;
};

export type WeibullRegime = "early_failure" | "random" | "wear_out";

export type SignalRow = {
  drug: string;
  adverse_event: string;
  case_count_a: number;
  drug_total_reports: number;
  event_total_reports: number;
  PRR: number;
  ROR: number;
  ROR_95CI_low: number;
  ROR_95CI_high: number;
  chi_square: number;
  p_value: number;
  q_value: number;
  signal_fdr: boolean;
  IC: number;
  IC025: number;
  IC975: number;
  signal_bcpnn: boolean;
  EBGM: number;
  EB05: number;
  EB95: number;
  signal_ebgm: boolean;
  serious_event: boolean;
  signal_detected: boolean;
  priority_score: number | null;
  priority_rank: number | null;
  priority_explain: PriorityExplain[] | null;
  PRR_MH?: number | null;
  ROR_MH?: number | null;
  IC_stratified?: number | null;
  prr_confounding_pct?: number | null;
  confounding_flagged?: boolean;
  weibull_shape?: number | null;
  weibull_shape_ci_low?: number | null;
  weibull_shape_ci_high?: number | null;
  weibull_scale?: number | null;
  weibull_n?: number;
  weibull_regime?: WeibullRegime | null;
};

export type ProbableDuplicatePair = {
  primaryid_a: string;
  primaryid_b: string;
  caseid_a: string;
  caseid_b: string;
  score: number;
  matching_fields: string[];
  shared_drugs: string[];
  shared_reactions: string[];
  event_dt_a?: string;
  event_dt_b?: string;
  age_a?: string;
  age_b?: string;
  sex_a?: string;
  sex_b?: string;
  country_a?: string;
  country_b?: string;
};

export type DuplicateSignalCounts = {
  cases: number;
  signals_prr: number;
  signals_bcpnn: number;
  signals_ebgm: number;
  signals_fdr: number;
};

export type DuplicateSummary = {
  superseded_versions_dropped: number;
  flagged_pairs: ProbableDuplicatePair[];
  flagged_secondary_primaryids: string[];
  excluded_active: boolean;
  baseline_counts: DuplicateSignalCounts;
  excluded_counts: DuplicateSignalCounts;
};

export type StratumMetrics = {
  stratum: string;
  a: number;
  b: number;
  c: number;
  d: number;
  n_total: number;
  PRR: number | null;
  IC: number;
  IC025: number;
};

export type StratifiedPairSummary = {
  drug: string;
  adverse_event: string;
  case_count_a: number;
  pooled_PRR: number;
  adjusted_PRR_MH: number | null;
  pooled_ROR: number;
  adjusted_ROR_MH: number | null;
  pooled_IC: number;
  stratified_IC: number | null;
  prr_change_pct: number | null;
  confounding_flagged: boolean;
  direction: "inflated_pooled" | "masked_pooled" | "consistent";
  by_age_band: StratumMetrics[];
  by_sex: StratumMetrics[];
  by_age_sex: StratumMetrics[];
};

export type TemporalPeriodPoint = {
  period: string;
  period_cases_a: number;
  period_drug_reports: number;
  period_rate: number;
  cum_a: number;
  cum_b: number;
  cum_c: number;
  cum_d: number;
  cum_n: number;
  cum_ic: number;
  cum_ic025: number;
  cum_ic975: number;
  cusum_stat: number;
  llr_stat: number;
};

export type TemporalSignalSeries = {
  drug: string;
  adverse_event: string;
  granularity: "month" | "quarter";
  first_ic025_gt0_period: string | null;
  changepoint_period: string | null;
  changepoint_llr: number;
  changepoint_p_value: number;
  changepoint_detected: boolean;
  pre_rate: number;
  post_rate: number;
  points: TemporalPeriodPoint[];
};

export type WeibullCurvePoint = {
  day: number;
  density: number;
  survival: number;
  hazard: number;
  empirical_cdf: number;
  fitted_cdf: number;
};

export type WeibullTtoResult = {
  drug: string;
  adverse_event: string;
  n_cases_with_tto: number;
  median_days: number;
  iqr_low: number;
  iqr_high: number;
  shape_k: number;
  shape_ci_low: number;
  shape_ci_high: number;
  scale_lambda: number;
  regime: WeibullRegime;
  interpretation: string;
  onset_days: number[];
  curve: WeibullCurvePoint[];
};

export type InteractionSignalRow = {
  drug_a: string;
  drug_b: string;
  adverse_event: string;
  n111: number;
  n11: number;
  n101: number;
  n10: number;
  n011: number;
  n01: number;
  n001: number;
  n00: number;
  f00: number;
  f10: number;
  f01: number;
  f11: number;
  g11: number;
  expected_111: number;
  omega: number;
  omega025: number;
  omega975: number;
  signal_omega: boolean;
  prr_a: number | null;
  prr_b: number | null;
  prr_ab: number;
};

export type OptionalTables = {
  outc?: FaersRow[];
  indi?: FaersRow[];
  ther?: FaersRow[];
};

export type FileNames = {
  demo?: string;
  drug?: string;
  reac?: string;
  outc?: string;
  indi?: string;
  ther?: string;
};

export type DatasetMeta = {
  source: "sample" | "upload" | "openfda_live";
  case_count: number;
  demo_rows: number;
  superseded_versions_dropped?: number;
  probable_duplicates_flagged?: number;
  drug_rows: number;
  reac_rows: number;
  outc_rows?: number;
  indi_rows?: number;
  ther_rows?: number;
  pair_count: number;
  drug_count: number;
  fileNames?: FileNames;
  openfda_drug?: string;
  openfda_retrieved_at?: string;
  openfda_disclaimer?: string;
};

export type PairRow = {
  primaryid: string;
  drugname: string;
  pt: string;
  event_dt?: string;
  role_cod?: string;
  drug_seq?: string;
};

export type ModelFeature = {
  name: string;
  label: string;
  group: "disproportionality" | "case" | string;
  weight: number;
  mean: number;
  std: number;
  used: boolean;
};

export type CandidateMetrics = {
  auc: number;
  auc_sd: number;
  ap: number;
  ap_sd: number;
  precision_at_k: Record<string, number>;
};

export type BaselineMetrics = {
  auc: number;
  ap: number;
  precision_at_k: Record<string, number>;
};

export type ModelEvaluation = {
  protocol: string;
  n_labelled: number;
  n_positive: number;
  n_negative: number;
  prevalence: number;
  candidates: Record<string, CandidateMetrics>;
  baselines: Record<string, BaselineMetrics>;
  selected: string;
};

export type ModelTraining = {
  data: "synthetic" | "faers" | string;
  description: string;
  quarters: string[];
  reference_sets: string[];
  label_unit: string;
  min_cases: number;
  n_cases: number;
  superseded_versions_dropped: number;
  controls_total: number;
  controls_scored: number;
};

export type PrioritizerModel = {
  schema_version: number;
  model_type: string;
  created: string;
  feature_set: string;
  training: ModelTraining;
  evaluation: ModelEvaluation;
  intercept: number;
  features: ModelFeature[];
};

export type AnalysisResult = {
  meta: DatasetMeta;
  pairs: PairRow[];
  signals: SignalRow[];
  prior: { alpha: number; beta: number };
  model: PrioritizerModel;
  featureAvailability: Record<string, number>;
  duplicates: DuplicateSummary;
  stratified: Record<string, StratifiedPairSummary>;
  weibull: Record<string, WeibullTtoResult>;
  interactions: InteractionSignalRow[];
};

export type SignalFilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "in";

export type SignalFilterClause = {
  field: string;
  op: SignalFilterOperator;
  value: string | number | boolean | string[];
};

export type SignalFilter = {
  clauses: SignalFilterClause[];
  sort_by: string | null;
  sort_dir: "asc" | "desc";
  limit: number | null;
};

export type VerifiedSentence = {
  sentence: string;
  text?: string;
  citations: string[];
  verified: boolean;
  status: string;
  causal_rewritten?: boolean;
};

export type LabelStatusResult = {
  status: string;
  is_labelled: boolean;
  already_labelled?: boolean;
  matched_section: string | null;
  matched_term: string | null;
  excerpt: string | null;
  synonyms_checked: string[];
  method: string;
  explanation: string;
};

export type PubMedArticleSummary = {
  pmid: string;
  title: string;
  year: string;
  abstract: string;
};

export type SignalAssessmentDraft = {
  is_draft_for_human_review: boolean;
  human_review_notice: string;
  model_name: string;
  prompt_version: string;
  retrieval_timestamp: string;
  provenance: {
    model_name: string;
    prompt_version: string;
    retrieval_timestamp: string;
    estimated_cost_usd: number;
    valid_sources: string[];
    sentences_total: number;
    sentences_verified: number;
  };
  drug: string;
  adverse_event: string;
  statistics: {
    drug: string;
    adverse_event: string;
    case_count_a: number;
    drug_total_reports: number;
    event_total_reports: number;
    PRR: number;
    PRR_MH?: number | null;
    ROR: number;
    ROR_95CI_low: number;
    ROR_95CI_high: number;
    chi_square: number;
    p_value: number;
    q_value: number;
    IC: number;
    IC025: number;
    EBGM: number;
    EB05: number;
    weibull_shape?: number | null;
    weibull_regime?: string | null;
  };
  label_status: LabelStatusResult;
  pubmed_articles: PubMedArticleSummary[];
  retrieval_empty: boolean;
  literature_summary: VerifiedSentence[];
  alternative_explanations: VerifiedSentence[];
  suggested_next_steps: string[];
  markdown: string;
};

export type OpenFdaCountRow = {
  drug: string;
  adverse_event: string;
  a: number;
  drug_total: number;
  event_total: number;
};

