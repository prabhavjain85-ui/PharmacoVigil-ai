/**
 * Reproducible evaluation benchmark over the 60 gold-annotated synthetic narratives
 * in `tests/narratives/gold_narratives.json`.
 *
 * Computes precision, recall, and F1 per entity type for:
 *  1. Old Regex baseline (`extractLegacyRegex`: 10 drugs, 7 reactions, no negation)
 *  2. Local Extractor (`extractClinicalNarrativeSync`: expanded drug table + NegEx/ConText + REAC embedding similarity)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractLegacyRegex, extractClinicalNarrativeSync } from "../web/lib/nlp.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const goldPath = path.join(repoRoot, "tests", "narratives", "gold_narratives.json");
const narratives = JSON.parse(fs.readFileSync(goldPath, "utf8"));

function calcPrf(tp, fp, fn) {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    tp,
    fp,
    fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
  };
}

function evaluateExtractor(mode) {
  const counts = {
    suspect_drugs: { tp: 0, fp: 0, fn: 0 },
    concomitant_drugs: { tp: 0, fp: 0, fn: 0 },
    active_reactions: { tp: 0, fp: 0, fn: 0 },
    negated_or_historical_reactions: { tp: 0, fp: 0, fn: 0 },
    seriousness: { tp: 0, fp: 0, fn: 0 },
    demographics: { tp: 0, fp: 0, fn: 0 },
    clinical_course_and_reporter: { tp: 0, fp: 0, fn: 0 },
  };

  for (const item of narratives) {
    const gold = item.gold;
    if (mode === "legacy") {
      const res = extractLegacyRegex(item.text);
      const predSuspect = new Set(res.drugs);
      const goldSuspect = new Set(gold.suspect_drugs || []);
      for (const d of predSuspect) {
        if (goldSuspect.has(d)) counts.suspect_drugs.tp++;
        else counts.suspect_drugs.fp++;
      }
      for (const d of goldSuspect) {
        if (!predSuspect.has(d)) counts.suspect_drugs.fn++;
      }

      const goldConcom = new Set(gold.concomitant_drugs || []);
      counts.concomitant_drugs.fn += goldConcom.size;

      const predActiveReac = new Set(res.reactions);
      const goldActiveReac = new Set(gold.active_reactions || []);
      for (const r of predActiveReac) {
        if (goldActiveReac.has(r)) counts.active_reactions.tp++;
        else counts.active_reactions.fp++;
      }
      for (const r of goldActiveReac) {
        if (!predActiveReac.has(r)) counts.active_reactions.fn++;
      }

      const goldNegReac = new Set(gold.negated_or_historical_reactions || []);
      counts.negated_or_historical_reactions.fn += goldNegReac.size;
      for (const r of predActiveReac) {
        if (goldNegReac.has(r)) counts.negated_or_historical_reactions.fp++;
      }

      if (gold.serious) counts.seriousness.fn++;
      if (gold.age !== null && gold.age !== undefined) counts.demographics.fn++;
      if (gold.sex) counts.demographics.fn++;
      if (gold.reporter) counts.clinical_course_and_reporter.fn++;
      if (gold.dechallenge) counts.clinical_course_and_reporter.fn++;
      if (gold.outcome) counts.clinical_course_and_reporter.fn++;
    } else {
      const res = extractClinicalNarrativeSync(item.text);
      const predSuspect = new Set(res.suspectDrugs.map((d) => d.canonical));
      const goldSuspect = new Set(gold.suspect_drugs || []);
      for (const d of predSuspect) {
        if (goldSuspect.has(d)) counts.suspect_drugs.tp++;
        else counts.suspect_drugs.fp++;
      }
      for (const d of goldSuspect) {
        if (!predSuspect.has(d)) counts.suspect_drugs.fn++;
      }

      const predConcom = new Set(res.concomitantDrugs.map((d) => d.canonical));
      const goldConcom = new Set(gold.concomitant_drugs || []);
      for (const d of predConcom) {
        if (goldConcom.has(d)) counts.concomitant_drugs.tp++;
        else counts.concomitant_drugs.fp++;
      }
      for (const d of goldConcom) {
        if (!predConcom.has(d)) counts.concomitant_drugs.fn++;
      }

      const predActiveReac = new Set(
        res.reactions
          .filter((r) => !r.negated && !r.historical && !r.uncertain)
          .map((r) => r.mappedTerm),
      );
      const goldActiveReac = new Set(gold.active_reactions || []);
      for (const r of predActiveReac) {
        if (goldActiveReac.has(r)) counts.active_reactions.tp++;
        else counts.active_reactions.fp++;
      }
      for (const r of goldActiveReac) {
        if (!predActiveReac.has(r)) counts.active_reactions.fn++;
      }

      const predNegReac = new Set(
        res.reactions
          .filter((r) => r.negated || r.historical || r.uncertain)
          .map((r) => r.mappedTerm),
      );
      const goldNegReac = new Set(gold.negated_or_historical_reactions || []);
      for (const r of predNegReac) {
        if (goldNegReac.has(r)) counts.negated_or_historical_reactions.tp++;
        else counts.negated_or_historical_reactions.fp++;
      }
      for (const r of goldNegReac) {
        if (!predNegReac.has(r)) counts.negated_or_historical_reactions.fn++;
      }

      const predSer = Object.values(res.seriousness).some((s) => s.present);
      if (predSer && gold.serious) counts.seriousness.tp++;
      else if (predSer && !gold.serious) counts.seriousness.fp++;
      else if (!predSer && gold.serious) counts.seriousness.fn++;

      const predAge = res.patientAge?.value?.value ?? null;
      if (predAge !== null && gold.age !== null) {
        if (predAge === gold.age) counts.demographics.tp++;
        else {
          counts.demographics.fp++;
          counts.demographics.fn++;
        }
      } else if (predAge !== null) counts.demographics.fp++;
      else if (gold.age !== null) counts.demographics.fn++;

      const predSex = res.patientSex?.value ?? null;
      if (predSex !== null && gold.sex !== null) {
        if (predSex === gold.sex) counts.demographics.tp++;
        else {
          counts.demographics.fp++;
          counts.demographics.fn++;
        }
      } else if (predSex !== null) counts.demographics.fp++;
      else if (gold.sex !== null) counts.demographics.fn++;

      const predRep = res.reporterType?.value ?? null;
      if (predRep !== null && gold.reporter !== null) {
        if (predRep === gold.reporter) counts.clinical_course_and_reporter.tp++;
        else {
          counts.clinical_course_and_reporter.fp++;
          counts.clinical_course_and_reporter.fn++;
        }
      } else if (predRep !== null) counts.clinical_course_and_reporter.fp++;
      else if (gold.reporter !== null) counts.clinical_course_and_reporter.fn++;

      const predDech = res.dechallenge?.value ?? null;
      if (predDech !== null && gold.dechallenge !== null) {
        if (predDech === gold.dechallenge) counts.clinical_course_and_reporter.tp++;
        else {
          counts.clinical_course_and_reporter.fp++;
          counts.clinical_course_and_reporter.fn++;
        }
      } else if (predDech !== null) counts.clinical_course_and_reporter.fp++;
      else if (gold.dechallenge !== null) counts.clinical_course_and_reporter.fn++;

      const predOutc = res.outcome?.value ?? null;
      if (predOutc !== null && gold.outcome !== null) {
        if (predOutc === gold.outcome) counts.clinical_course_and_reporter.tp++;
        else {
          counts.clinical_course_and_reporter.fp++;
          counts.clinical_course_and_reporter.fn++;
        }
      } else if (predOutc !== null) counts.clinical_course_and_reporter.fp++;
      else if (gold.outcome !== null) counts.clinical_course_and_reporter.fn++;
    }
  }

  const metrics = {};
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  for (const [k, c] of Object.entries(counts)) {
    metrics[k] = calcPrf(c.tp, c.fp, c.fn);
    totalTp += c.tp;
    totalFp += c.fp;
    totalFn += c.fn;
  }
  metrics.micro_overall = calcPrf(totalTp, totalFp, totalFn);
  return metrics;
}

const legacy = evaluateExtractor("legacy");
const local = evaluateExtractor("local");
console.log(
  `NLP Benchmark OK: ${narratives.length} gold narratives | Legacy Micro-F1=${legacy.micro_overall.f1} | Local Micro-F1=${local.micro_overall.f1}`,
);
