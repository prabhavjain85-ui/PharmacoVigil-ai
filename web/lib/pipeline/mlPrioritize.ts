import rawModel from "./prioritizerModel.json";
import type { FeatureMap } from "./pairFeatures";
import type { ModelFeature, PrioritizerModel, PriorityExplain } from "./types";

export const SERIOUS_EVENTS = new Set([
  "GASTROINTESTINAL HAEMORRHAGE",
  "ANAPHYLACTIC REACTION",
  "HEPATIC FAILURE",
  "RHABDOMYOLYSIS",
  "ANGIOEDEMA",
  "DYSPNOEA",
]);

const TOP_DRIVERS = 3;

export function getPrioritizerModel(): PrioritizerModel {
  return rawModel as unknown as PrioritizerModel;
}

export function scoreFeatureFrames(
  frames: FeatureMap[],
  model: PrioritizerModel = getPrioritizerModel(),
): {
  priority_score: number;
  priority_explain: PriorityExplain[];
}[] {
  const usedFeatures: ModelFeature[] = model.features.filter((f) => f.used);

  return frames.map((row) => {
    const contribs: { feat: ModelFeature; value: number | null; contribution: number }[] =
      usedFeatures.map((feat) => {
        const raw = row[feat.name];
        if (raw === null || raw === undefined || Number.isNaN(raw)) {
          return { feat, value: null, contribution: 0 };
        }
        const z = (raw - feat.mean) / (feat.std || 1.0);
        return { feat, value: raw, contribution: feat.weight * z };
      });

    let logit = model.intercept;
    for (const c of contribs) {
      logit += c.contribution;
    }
    const prob = 1.0 / (1.0 + Math.exp(-logit));

    const ordered = contribs
      .map((item, idx) => ({ ...item, idx }))
      .sort((a, b) => {
        const diff = Math.abs(b.contribution) - Math.abs(a.contribution);
        return diff !== 0 ? diff : a.idx - b.idx;
      })
      .slice(0, TOP_DRIVERS);

    const explain: PriorityExplain[] = [];
    for (const item of ordered) {
      if (item.value === null || Number.isNaN(item.value) || item.contribution === 0) {
        continue;
      }
      explain.push({
        feature: item.feat.name,
        label: item.feat.label,
        value: round4(item.value),
        contribution: round4(item.contribution),
      });
    }

    return {
      priority_score: round4(prob),
      priority_explain: explain,
    };
  });
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
