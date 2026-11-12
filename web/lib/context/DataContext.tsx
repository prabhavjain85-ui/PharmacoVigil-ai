"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchCsv } from "@/lib/pipeline/parseCsv";
import { runOpenFdaCountAnalysis } from "@/lib/pipeline/analyze";
import { fetchOpenFdaLiveCounts } from "@/lib/pipeline/signalCopilot";
import type {
  AnalysisResult,
  FaersRow,
  FileNames,
  OpenFdaCountRow,
  OptionalTables,
} from "@/lib/pipeline/types";
import {
  runWorkerAnalyzeTables,
  runWorkerParseAndAnalyze,
} from "@/lib/pipeline/workerClient";

export interface NewCasePayload {
  demoRow: FaersRow;
  drugRows: FaersRow[];
  reacRows: FaersRow[];
  outcRows?: FaersRow[];
  indiRows?: FaersRow[];
  therRows?: FaersRow[];
}

export interface RawUploadTexts {
  demoText: string;
  drugText: string;
  reacText: string;
  outcText?: string | null;
  indiText?: string | null;
  therText?: string | null;
  names: FileNames;
}

type OpenFdaCountPayload = {
  source: "openfda_live";
  drug: string;
  retrieved_at: string;
  total_reports: number;
  drug_total_reports: number;
  count_rows: OpenFdaCountRow[];
  disclaimer: string;
};

type DataContextValue = {
  loading: boolean;
  error: string | null;
  analysis: AnalysisResult | null;
  workerProgress: { step: string; percent: number } | null;
  minCases: number;
  setMinCases: (n: number) => void;
  excludeFlaggedDuplicates: boolean;
  setExcludeFlaggedDuplicates: (v: boolean) => void;
  loadSample: () => Promise<void>;
  loadUpload: (
    demo: FaersRow[],
    drug: FaersRow[],
    reac: FaersRow[],
    names: FileNames,
    optional?: OptionalTables,
  ) => void;
  loadUploadTexts: (payload: RawUploadTexts) => Promise<void>;
  loadOpenFdaLive: (drugName: string, maxEvents?: number) => Promise<void>;
  reacPts: string[];
  addedCaseIds: string[];
  addCaseToDataset: (payload: NewCasePayload) => string;
};

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<FaersRow[]>([]);
  const [drug, setDrug] = useState<FaersRow[]>([]);
  const [reac, setReac] = useState<FaersRow[]>([]);
  const [optional, setOptional] = useState<OptionalTables | undefined>(undefined);
  const [source, setSource] = useState<"sample" | "upload" | "openfda_live">("sample");
  const [openFdaPayload, setOpenFdaPayload] = useState<OpenFdaCountPayload | null>(null);
  const [fileNames, setFileNames] = useState<FileNames>();
  const [minCases, setMinCases] = useState(3);
  const [excludeFlaggedDuplicates, setExcludeFlaggedDuplicates] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [workerProgress, setWorkerProgress] = useState<{ step: string; percent: number } | null>(
    null,
  );
  const [addedCaseIds, setAddedCaseIds] = useState<string[]>([]);

  useEffect(() => {
    if (source === "openfda_live" && openFdaPayload) {
      setAnalysis(runOpenFdaCountAnalysis(openFdaPayload, minCases));
      return;
    }
    if (!demo.length || !drug.length || !reac.length) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    setWorkerProgress({ step: "Starting Web Worker analysis...", percent: 5 });

    runWorkerAnalyzeTables({
      demo,
      drug,
      reac,
      optional,
      source: source === "upload" ? "upload" : "sample",
      fileNames,
      minCases,
      excludeFlaggedDuplicates,
      onProgress: (step, percent) => {
        if (!cancelled) setWorkerProgress({ step, percent });
      },
    })
      .then((res) => {
        if (cancelled) return;
        setAnalysis(res);
        setError(null);
        setWorkerProgress(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setAnalysis(null);
        setError(e instanceof Error ? e.message : "Analysis failed");
        setWorkerProgress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    demo,
    drug,
    reac,
    optional,
    source,
    openFdaPayload,
    fileNames,
    minCases,
    excludeFlaggedDuplicates,
  ]);

  const reacPts = useMemo(() => {
    const pts = new Set<string>();
    for (const row of reac) {
      const pt = (row.pt || row.PT || row.reac_pt || "").trim().toUpperCase();
      if (pt) pts.add(pt);
    }
    return Array.from(pts).sort();
  }, [reac]);

  const loadSample = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, dr, rc, outc, indi, ther] = await Promise.all([
        fetchCsv("/sample/DEMO_sample.csv"),
        fetchCsv("/sample/DRUG_sample.csv"),
        fetchCsv("/sample/REAC_sample.csv"),
        fetchCsv("/sample/OUTC_sample.csv"),
        fetchCsv("/sample/INDI_sample.csv"),
        fetchCsv("/sample/THER_sample.csv"),
      ]);
      setDemo(d);
      setDrug(dr);
      setReac(rc);
      setOptional({ outc, indi, ther });
      setOpenFdaPayload(null);
      setSource("sample");
      setFileNames(undefined);
      setAddedCaseIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sample data");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUpload = useCallback(
    (
      d: FaersRow[],
      dr: FaersRow[],
      rc: FaersRow[],
      names: FileNames,
      opt?: OptionalTables,
    ) => {
      setDemo(d);
      setDrug(dr);
      setReac(rc);
      setOptional(opt);
      setOpenFdaPayload(null);
      setSource("upload");
      setFileNames(names);
      setAddedCaseIds([]);
      setLoading(false);
      setError(null);
    },
    [],
  );

  const loadUploadTexts = useCallback(
    async (payload: RawUploadTexts) => {
      setLoading(true);
      setError(null);
      setWorkerProgress({ step: "Sending files to Web Worker...", percent: 2 });
      try {
        const res = await runWorkerParseAndAnalyze({
          demoText: payload.demoText,
          drugText: payload.drugText,
          reacText: payload.reacText,
          outcText: payload.outcText,
          indiText: payload.indiText,
          therText: payload.therText,
          source: "upload",
          fileNames: payload.names,
          minCases,
          excludeFlaggedDuplicates,
          onProgress: (step, percent) => setWorkerProgress({ step, percent }),
        });
        setDemo(res.demo);
        setDrug(res.drug);
        setReac(res.reac);
        setOptional(res.optional);
        setOpenFdaPayload(null);
        setSource("upload");
        setFileNames(payload.names);
        setAnalysis(res.analysis);
        setAddedCaseIds([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to parse and analyze uploaded files");
      } finally {
        setWorkerProgress(null);
        setLoading(false);
      }
    },
    [minCases, excludeFlaggedDuplicates],
  );

  const loadOpenFdaLive = useCallback(
    async (drugName: string, maxEvents = 25) => {
      setLoading(true);
      setError(null);
      setWorkerProgress({
        step: `Querying live openFDA 2x2 counts for ${drugName.toUpperCase()}...`,
        percent: 25,
      });
      try {
        const payload = await fetchOpenFdaLiveCounts(drugName, maxEvents, minCases);
        setWorkerProgress({
          step: "Running disproportionality & empirical Bayes EBGM on openFDA 2x2 counts...",
          percent: 80,
        });
        const res = runOpenFdaCountAnalysis(payload, minCases);
        setOpenFdaPayload(payload);
        setSource("openfda_live");
        setFileNames(undefined);
        setAnalysis(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "openFDA live count query failed");
        throw e;
      } finally {
        setWorkerProgress(null);
        setLoading(false);
      }
    },
    [minCases],
  );

  const addCaseToDataset = useCallback((payload: NewCasePayload): string => {
    const primaryId =
      payload.demoRow.primaryid ||
      payload.demoRow.PRIMARYID ||
      `NLP${Date.now().toString().slice(-7)}`;
    const normalizedDemo: FaersRow = {
      ...payload.demoRow,
      primaryid: primaryId,
      caseid: payload.demoRow.caseid || primaryId,
      caseversion: payload.demoRow.caseversion || "1",
    };
    const normalizedDrugs = payload.drugRows.map((r, idx) => ({
      ...r,
      primaryid: primaryId,
      caseid: normalizedDemo.caseid,
      drug_seq: r.drug_seq || String(idx + 1),
    }));
    const normalizedReacs = payload.reacRows.map((r) => ({
      ...r,
      primaryid: primaryId,
      caseid: normalizedDemo.caseid,
    }));

    setDemo((prev) => [...prev, normalizedDemo]);
    setDrug((prev) => [...prev, ...normalizedDrugs]);
    setReac((prev) => [...prev, ...normalizedReacs]);
    setOptional((prev) => ({
      outc: payload.outcRows?.length
        ? [
            ...(prev?.outc || []),
            ...payload.outcRows.map((r) => ({
              ...r,
              primaryid: primaryId,
              caseid: normalizedDemo.caseid,
            })),
          ]
        : prev?.outc,
      indi: payload.indiRows?.length
        ? [
            ...(prev?.indi || []),
            ...payload.indiRows.map((r) => ({
              ...r,
              primaryid: primaryId,
              caseid: normalizedDemo.caseid,
            })),
          ]
        : prev?.indi,
      ther: payload.therRows?.length
        ? [
            ...(prev?.ther || []),
            ...payload.therRows.map((r) => ({
              ...r,
              primaryid: primaryId,
              caseid: normalizedDemo.caseid,
            })),
          ]
        : prev?.ther,
    }));
    setAddedCaseIds((prev) => [...prev, primaryId]);
    return primaryId;
  }, []);

  useEffect(() => {
    loadSample();
  }, [loadSample]);

  return (
    <DataContext.Provider
      value={{
        loading,
        error,
        analysis,
        workerProgress,
        minCases,
        setMinCases,
        excludeFlaggedDuplicates,
        setExcludeFlaggedDuplicates,
        loadSample,
        loadUpload,
        loadUploadTexts,
        loadOpenFdaLive,
        reacPts,
        addedCaseIds,
        addCaseToDataset,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData requires DataProvider");
  return ctx;
}
