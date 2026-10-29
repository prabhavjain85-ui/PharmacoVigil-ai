export type SignalRow = {
  drug: string;
  adverse_event: string;
  case_count_a: number;
  drug_total_reports: number;
  event_total_reports: number;
  PRR: number;
  ROR: number;
  chi_square: number;
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
  priority_explain?: { feature: string; label: string; value: number; contribution: number }[];
};

export type SiteBundle = {
  generated_at: string;
  disclaimer: { data: string; ml: string; nlp: string };
  dataset: {
    source: string;
    case_count: number;
    demo_rows: number;
    drug_rows: number;
    reac_rows: number;
    pair_count: number;
    drug_count: number;
  };
  ebgm_prior: { alpha: number; beta: number };
  featured_contingency: { a: number; b: number; c: number; d: number; total_reports: number };
  featured_pair: SignalRow;
  default_drug: string;
  drugs: {
    drug: string;
    report_count: number;
    pair_count: number;
    signal_count: number;
    bcpnn_count: number;
    ebgm_count: number;
  }[];
  signals_by_drug: Record<string, SignalRow[]>;
  all_signals: SignalRow[];
  priority_top: SignalRow[];
  ml_meta: {
    model: string;
    weak_label_count: number;
    weak_labels_note: string;
    global_importance: { feature: string; label: string; importance: number }[];
  };
  nlp_samples: { id: string; text: string; note: string }[];
  references: { title: string; url: string }[];
};
