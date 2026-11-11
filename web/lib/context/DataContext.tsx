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
import { runAnalysis } from "@/lib/pipeline/analyze";
import { fetchCsv } from "@/lib/pipeline/parseCsv";
import type { AnalysisResult, FaersRow, FileNames, OptionalTables } from "@/lib/pipeline/types";

export interface NewCasePayload {
  demoRow: FaersRow;
  drugRows: FaersRow[];
  reacRows: FaersRow[];
  outcRows?: FaersRow[];
  indiRows?: FaersRow[];
  therRows?: FaersRow[];
}

type DataContextValue = {
  loading: boolean;
  error: string | null;
  analysis: AnalysisResult | null;
  minCases: number;
  setMinCases: (n: number) => void;
  loadSample: () => Promise<void>;
  loadUpload: (
    demo: FaersRow[],
    drug: FaersRow[],
    reac: FaersRow[],
    names: FileNames,
    optional?: OptionalTables,
  ) => void;
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
  const [source, setSource] = useState<"sample" | "upload">("sample");
  const [fileNames, setFileNames] = useState<FileNames>();
  const [minCases, setMinCases] = useState(3);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [addedCaseIds, setAddedCaseIds] = useState<string[]>([]);

  useEffect(() => {
    if (!demo.length || !drug.length || !reac.length) {
      setAnalysis(null);
      return;
    }
    try {
      setAnalysis(runAnalysis(demo, drug, reac, source, fileNames, minCases, optional));
      setError(null);
    } catch (e) {
      setAnalysis(null);
      setError(e instanceof Error ? e.message : "Analysis failed");
    }
  }, [demo, drug, reac, optional, source, fileNames, minCases]);

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
      setSource("upload");
      setFileNames(names);
      setAddedCaseIds([]);
      setLoading(false);
      setError(null);
    },
    [],
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
        minCases,
        setMinCases,
        loadSample,
        loadUpload,
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
