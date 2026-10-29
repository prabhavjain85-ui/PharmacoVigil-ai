"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { runAnalysis } from "@/lib/pipeline/analyze";
import { fetchCsv } from "@/lib/pipeline/parseCsv";
import type { AnalysisResult, FaersRow } from "@/lib/pipeline/types";

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
    names: { demo: string; drug: string; reac: string },
  ) => void;
};

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<FaersRow[]>([]);
  const [drug, setDrug] = useState<FaersRow[]>([]);
  const [reac, setReac] = useState<FaersRow[]>([]);
  const [source, setSource] = useState<"sample" | "upload">("sample");
  const [fileNames, setFileNames] = useState<AnalysisResult["meta"]["fileNames"]>();
  const [minCases, setMinCases] = useState(3);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    if (!demo.length || !drug.length || !reac.length) {
      setAnalysis(null);
      return;
    }
    try {
      setAnalysis(runAnalysis(demo, drug, reac, source, fileNames, minCases));
      setError(null);
    } catch (e) {
      setAnalysis(null);
      setError(e instanceof Error ? e.message : "Analysis failed");
    }
  }, [demo, drug, reac, source, fileNames, minCases]);

  const loadSample = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, dr, rc] = await Promise.all([
        fetchCsv("/sample/DEMO_sample.csv"),
        fetchCsv("/sample/DRUG_sample.csv"),
        fetchCsv("/sample/REAC_sample.csv"),
      ]);
      setDemo(d);
      setDrug(dr);
      setReac(rc);
      setSource("sample");
      setFileNames(undefined);
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
      names: { demo: string; drug: string; reac: string },
    ) => {
      setDemo(d);
      setDrug(dr);
      setReac(rc);
      setSource("upload");
      setFileNames(names);
      setLoading(false);
      setError(null);
    },
    [],
  );

  useEffect(() => {
    loadSample();
  }, [loadSample]);

  return (
    <DataContext.Provider
      value={{ loading, error, analysis, minCases, setMinCases, loadSample, loadUpload }}
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
