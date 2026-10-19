import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { Batch, RunRow } from "../catalog.ts";
import type { TaskFlags } from "../flags.ts";

export type { Batch, RunRow, TaskFlags };

export interface IndexData {
  readonly roots: readonly string[];
  readonly scannedAt: string;
  readonly batches: readonly Batch[];
  /** Fixtures dir to its task flags, for the sets that have a `task-flags.json`. */
  readonly taskFlags: Readonly<Record<string, TaskFlags>>;
  readonly runs: readonly RunRow[];
}

interface DataState {
  readonly index: IndexData;
  /** Runs from the batches the user has ticked on the overview page. */
  readonly runs: readonly RunRow[];
  readonly selected: ReadonlySet<string>;
  readonly setSelected: (ids: ReadonlySet<string>) => void;
  readonly rescan: () => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);
const HIDDEN_KEY = "eval-viewer.hidden-batches";

export function DataProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<IndexData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]),
  );

  const load = useCallback(async (method: "GET" | "POST") => {
    try {
      setIndex(await getJson<IndexData>("/api/index", { method }));
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => void load("GET"), [load]);

  const state = useMemo<DataState | null>(() => {
    if (index === null) return null;
    const selected = new Set(index.batches.map((b) => b.id).filter((id) => !hidden.has(id)));
    return {
      index,
      runs: index.runs.filter((r) => selected.has(r.batch)),
      selected,
      setSelected: (ids) => {
        const next = new Set(index.batches.map((b) => b.id).filter((id) => !ids.has(id)));
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
        setHidden(next);
      },
      rescan: () => load("POST"),
    };
  }, [index, hidden, load]);

  if (error !== null) return <p className="error">Could not load the run index: {error}</p>;
  if (state === null) return <p className="muted">Scanning run folders...</p>;
  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const state = useContext(DataContext);
  if (state === null) throw new Error("useData outside DataProvider");
  return state;
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Loads JSON for a view and reloads when the url changes. */
export function useJson<T>(url: string | null): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({
    url: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (url === null) return;
    let live = true;
    getJson<T>(url).then(
      (data) => live && setState({ url, data, error: null }),
      (e: unknown) => live && setState({ url, data: null, error: String(e) }),
    );
    return () => {
      live = false;
    };
  }, [url]);
  return state.url === url ? state : { data: null, error: null };
}
