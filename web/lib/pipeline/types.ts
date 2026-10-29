export type FaersRow = Record<string, string>;

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

export type PriorityExplain = {
  feature: string;
  label: string;
  value: number;
  contribution: number;
};

export type DatasetMeta = {
  source: "sample" | "upload";
  case_count: number;
  demo_rows: number;
  drug_rows: number;
  reac_rows: number;
  pair_count: number;
  drug_count: number;
  fileNames?: { demo?: string; drug?: string; reac?: string };
};

export type PairRow = {
  primaryid: string;
  drugname: string;
  pt: string;
  event_dt?: string;
};

export type AnalysisResult = {
  meta: DatasetMeta;
  pairs: PairRow[];
  signals: SignalRow[];
  prior: { alpha: number; beta: number };
  globalImportance: { feature: string; label: string; importance: number }[];
};
