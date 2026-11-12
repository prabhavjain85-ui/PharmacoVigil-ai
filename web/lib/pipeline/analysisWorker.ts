import { runAnalysis } from "./analyze";
import { parseCsv } from "./parseCsv";
import type { AnalysisResult, FaersRow, FileNames, OptionalTables } from "./types";

export type WorkerRequest =
  | {
      id: number;
      kind: "parse_and_analyze";
      demoText: string;
      drugText: string;
      reacText: string;
      outcText?: string | null;
      indiText?: string | null;
      therText?: string | null;
      source: "sample" | "upload";
      fileNames?: FileNames;
      minCases: number;
      excludeFlaggedDuplicates: boolean;
    }
  | {
      id: number;
      kind: "analyze_tables";
      demo: FaersRow[];
      drug: FaersRow[];
      reac: FaersRow[];
      optional?: OptionalTables;
      source: "sample" | "upload";
      fileNames?: FileNames;
      minCases: number;
      excludeFlaggedDuplicates: boolean;
    };

export type WorkerResponse =
  | {
      id: number;
      type: "progress";
      step: string;
      percent: number;
    }
  | {
      id: number;
      type: "done";
      analysis: AnalysisResult;
      demo?: FaersRow[];
      drug?: FaersRow[];
      reac?: FaersRow[];
      optional?: OptionalTables;
    }
  | {
      id: number;
      type: "error";
      message: string;
    };

const ctx = typeof self !== "undefined" ? (self as unknown as Worker) : null;

if (ctx && typeof ctx.addEventListener === "function") {
  ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
    const req = event.data;
    if (!req || typeof req.id !== "number") return;

    const postProgress = (step: string, percent: number) => {
      const msg: WorkerResponse = { id: req.id, type: "progress", step, percent };
      ctx.postMessage(msg);
    };

    try {
      if (req.kind === "parse_and_analyze") {
        postProgress("Parsing DEMO table in Web Worker...", 3);
        const demo = parseCsv(req.demoText);
        postProgress(`Parsed DEMO (${demo.length.toLocaleString()} rows). Parsing DRUG...`, 6);
        const drug = parseCsv(req.drugText);
        postProgress(`Parsed DRUG (${drug.length.toLocaleString()} rows). Parsing REAC...`, 9);
        const reac = parseCsv(req.reacText);

        const optional: OptionalTables = {
          outc: req.outcText ? parseCsv(req.outcText) : undefined,
          indi: req.indiText ? parseCsv(req.indiText) : undefined,
          ther: req.therText ? parseCsv(req.therText) : undefined,
        };

        const analysis = runAnalysis(
          demo,
          drug,
          reac,
          req.source,
          req.fileNames,
          req.minCases,
          optional,
          {
            excludeFlaggedDuplicates: req.excludeFlaggedDuplicates,
            onProgress: postProgress,
          },
        );

        const doneMsg: WorkerResponse = {
          id: req.id,
          type: "done",
          analysis,
          demo,
          drug,
          reac,
          optional,
        };
        ctx.postMessage(doneMsg);
      } else if (req.kind === "analyze_tables") {
        const analysis = runAnalysis(
          req.demo,
          req.drug,
          req.reac,
          req.source,
          req.fileNames,
          req.minCases,
          req.optional,
          {
            excludeFlaggedDuplicates: req.excludeFlaggedDuplicates,
            onProgress: postProgress,
          },
        );

        const doneMsg: WorkerResponse = {
          id: req.id,
          type: "done",
          analysis,
        };
        ctx.postMessage(doneMsg);
      }
    } catch (err) {
      const errMsg: WorkerResponse = {
        id: req.id,
        type: "error",
        message: err instanceof Error ? err.message : "Worker analysis failed",
      };
      ctx.postMessage(errMsg);
    }
  });
}
