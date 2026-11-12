import { runAnalysis, type AnalysisProgressCallback } from "./analyze";
import type { WorkerRequest, WorkerResponse } from "./analysisWorker";
import { parseCsv } from "./parseCsv";
import type { AnalysisResult, FaersRow, FileNames, OptionalTables } from "./types";

let workerInstance: Worker | null = null;
let nextRequestId = 1;

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL("./analysisWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      workerInstance = null;
    }
  }
  return workerInstance;
}

export async function runWorkerParseAndAnalyze(params: {
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
  onProgress?: AnalysisProgressCallback;
}): Promise<{
  analysis: AnalysisResult;
  demo: FaersRow[];
  drug: FaersRow[];
  reac: FaersRow[];
  optional: OptionalTables;
}> {
  const worker = getWorker();
  if (!worker) {
    params.onProgress?.("Parsing CSV files...", 5);
    const demo = parseCsv(params.demoText);
    const drug = parseCsv(params.drugText);
    const reac = parseCsv(params.reacText);
    const optional: OptionalTables = {
      outc: params.outcText ? parseCsv(params.outcText) : undefined,
      indi: params.indiText ? parseCsv(params.indiText) : undefined,
      ther: params.therText ? parseCsv(params.therText) : undefined,
    };
    const analysis = runAnalysis(
      demo,
      drug,
      reac,
      params.source,
      params.fileNames,
      params.minCases,
      optional,
      {
        excludeFlaggedDuplicates: params.excludeFlaggedDuplicates,
        onProgress: params.onProgress,
      },
    );
    return { analysis, demo, drug, reac, optional };
  }

  const reqId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (!msg || msg.id !== reqId) return;
      if (msg.type === "progress") {
        params.onProgress?.(msg.step, msg.percent);
      } else if (msg.type === "done") {
        worker.removeEventListener("message", handleMessage);
        resolve({
          analysis: msg.analysis,
          demo: msg.demo ?? [],
          drug: msg.drug ?? [],
          reac: msg.reac ?? [],
          optional: msg.optional ?? {},
        });
      } else if (msg.type === "error") {
        worker.removeEventListener("message", handleMessage);
        reject(new Error(msg.message));
      }
    };

    worker.addEventListener("message", handleMessage);
    const req: WorkerRequest = {
      id: reqId,
      kind: "parse_and_analyze",
      demoText: params.demoText,
      drugText: params.drugText,
      reacText: params.reacText,
      outcText: params.outcText,
      indiText: params.indiText,
      therText: params.therText,
      source: params.source,
      fileNames: params.fileNames,
      minCases: params.minCases,
      excludeFlaggedDuplicates: params.excludeFlaggedDuplicates,
    };
    worker.postMessage(req);
  });
}

export async function runWorkerAnalyzeTables(params: {
  demo: FaersRow[];
  drug: FaersRow[];
  reac: FaersRow[];
  optional?: OptionalTables;
  source: "sample" | "upload";
  fileNames?: FileNames;
  minCases: number;
  excludeFlaggedDuplicates: boolean;
  onProgress?: AnalysisProgressCallback;
}): Promise<AnalysisResult> {
  const worker = getWorker();
  if (!worker) {
    return runAnalysis(
      params.demo,
      params.drug,
      params.reac,
      params.source,
      params.fileNames,
      params.minCases,
      params.optional,
      {
        excludeFlaggedDuplicates: params.excludeFlaggedDuplicates,
        onProgress: params.onProgress,
      },
    );
  }

  const reqId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (!msg || msg.id !== reqId) return;
      if (msg.type === "progress") {
        params.onProgress?.(msg.step, msg.percent);
      } else if (msg.type === "done") {
        worker.removeEventListener("message", handleMessage);
        resolve(msg.analysis);
      } else if (msg.type === "error") {
        worker.removeEventListener("message", handleMessage);
        reject(new Error(msg.message));
      }
    };

    worker.addEventListener("message", handleMessage);
    const req: WorkerRequest = {
      id: reqId,
      kind: "analyze_tables",
      demo: params.demo,
      drug: params.drug,
      reac: params.reac,
      optional: params.optional,
      source: params.source,
      fileNames: params.fileNames,
      minCases: params.minCases,
      excludeFlaggedDuplicates: params.excludeFlaggedDuplicates,
    };
    worker.postMessage(req);
  });
}
