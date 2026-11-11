export type FaersRow = Record<string, string>;

export type PriorityExplain = {
  feature: string;
  label: string;
  value: number;
  contribution: number;
};

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
  source: "sample" | "upload";
  case_count: number;
  demo_rows: number;
  drug_rows: number;
  reac_rows: number;
  outc_rows?: number;
  indi_rows?: number;
  ther_rows?: number;
  pair_count: number;
  drug_count: number;
  fileNames?: FileNames;
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
};
