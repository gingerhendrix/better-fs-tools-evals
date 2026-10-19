import type { RunRow } from "../catalog.ts";

export type Outcome = "pass" | "fail" | "error" | "incomplete";

/** A provider error or a run with no result is not a model fail, so it gets its own outcome. */
export function outcome(run: RunRow): Outcome {
  if (run.end === "incomplete") return "incomplete";
  if (run.end === "error") return "error";
  return run.passed ? "pass" : "fail";
}

export interface Tally {
  readonly runs: number;
  readonly pass: number;
  readonly fail: number;
  readonly error: number;
  readonly incomplete: number;
}

export function tally(runs: readonly RunRow[]): Tally {
  const t = { runs: runs.length, pass: 0, fail: 0, error: 0, incomplete: 0 };
  for (const run of runs) t[outcome(run)] += 1;
  return t;
}

/** Strict pass rate: provider errors count as fails, incomplete runs are left out. */
export function passRate(t: Tally): number | null {
  const graded = t.runs - t.incomplete;
  return graded === 0 ? null : t.pass / graded;
}

/**
 * Pass rate with provider errors left out of the denominator. The blog-era results
 * artifact reports its "Clean 49" column this way.
 */
export function passRateExcludingErrors(t: Tally): number | null {
  const graded = t.runs - t.incomplete - t.error;
  return graded === 0 ? null : t.pass / graded;
}

/** Which tasks a view counts: every task, only tasks with no flaw, or only flawed tasks. */
export type TaskScope = "all" | "clean" | "flawed";

export function parseScope(value: string | null): TaskScope {
  return value === "clean" || value === "flawed" ? value : "all";
}

export function inScope(run: RunRow, scope: TaskScope): boolean {
  if (scope === "clean") return !run.flawed;
  if (scope === "flawed") return run.flawed;
  return true;
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list === undefined) groups.set(k, [item]);
    else list.push(item);
  }
  return groups;
}

export const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

export function percent(rate: number | null): string {
  return rate === null ? "-" : `${(rate * 100).toFixed(1)}%`;
}

/** Red (0) to green (1) background for a pass-rate cell. */
export function rateColor(rate: number | null): string {
  if (rate === null) return "transparent";
  return `hsl(${Math.round(rate * 120)} 55% 32%)`;
}

/** `/a/b/scratch/2026-10-17-x/fixtures` to `2026-10-17-x/fixtures`. */
export function shortPath(path: string | null): string {
  if (path === null) return "(no fixtures)";
  const parts = path.split("/").filter(Boolean);
  const scratch = parts.lastIndexOf("scratch");
  return (scratch >= 0 ? parts.slice(scratch + 1) : parts.slice(-3)).join("/");
}

/** `codex-oauth:gpt-6-luna:medium` to `gpt-6-luna:medium`, `z-ai/glm-5.3-flash` to `glm-5.3-flash`. */
export function shortModel(model: string): string {
  return model.replace(/^codex-oauth:/, "").replace(/^[^/]+\//, "");
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");
export const fmtUsd = (n: number | null) => (n === null ? "-" : `$${n.toFixed(n < 1 ? 4 : 2)}`);
export const fmtSecs = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)}`);
