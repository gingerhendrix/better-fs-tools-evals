import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { runCostUsd } from "../pricing.ts";
import type { CellResult } from "../run.ts";
import { loadTaskFlags } from "./flags.ts";
import type { TaskFlags } from "./flags.ts";

/** One `run` output folder: a `manifest.json` beside a `runs/` tree. */
export interface Batch {
  readonly id: string;
  readonly dir: string;
  readonly created: string | null;
  readonly fixtures: string | null;
  readonly models: readonly string[];
  readonly arms: readonly string[];
  readonly tasks: readonly string[];
  readonly attempts: number | null;
  readonly maxSteps: number | null;
  readonly earlyStop: boolean | null;
}

/** One cell of a batch, flattened for tables. A cell with no `result.json` is "incomplete". */
export interface RunRow {
  readonly id: string;
  readonly batch: string;
  readonly fixtures: string | null;
  readonly model: string;
  readonly arm: string;
  readonly task: string;
  readonly attempt: number;
  /** The fixture set's `task-flags.json` marks this task as flawed. */
  readonly flawed: boolean;
  readonly passed: boolean | null;
  readonly end: string;
  readonly linesChanged: number | null;
  readonly verifyError: string | null;
  readonly loopError: string | null;
  readonly difficulty: string | null;
  readonly mutationType: string | null;
  readonly steps: number;
  readonly toolCalls: number;
  readonly toolErrors: number;
  readonly toolErrorCodes: Record<string, number>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly wallMs: number | null;
  readonly costUsd: number | null;
}

export interface Catalog {
  readonly roots: readonly string[];
  readonly batches: readonly Batch[];
  readonly runs: readonly RunRow[];
  /** Fixtures dir to its `task-flags.json`, for the sets that have one. */
  readonly taskFlags: Readonly<Record<string, TaskFlags>>;
  /** Run id to its cell folder. The server reads traces only from these folders. */
  readonly runDirs: ReadonlyMap<string, string>;
  readonly scannedAt: string;
}

const SKIP_DIRS = new Set(["node_modules", "runs", "workspace", "dist", "target"]);

/** Scans each root for batch folders, then reads every cell result. */
export async function scanCatalog(roots: readonly string[], maxDepth = 3): Promise<Catalog> {
  const batches: Batch[] = [];
  for (const root of roots) {
    const prefix = roots.length > 1 ? `${basename(root)}/` : "";
    for (const dir of await findBatchDirs(root, maxDepth)) {
      const batch = await readBatch(dir, `${prefix}${relative(root, dir) || basename(dir)}`);
      if (batch !== null) batches.push(batch);
    }
  }
  batches.sort(
    (a, b) => (a.created ?? "").localeCompare(b.created ?? "") || a.id.localeCompare(b.id),
  );

  const taskFlags: Record<string, TaskFlags> = {};
  for (const fixtures of new Set(batches.map((b) => b.fixtures))) {
    const flags = fixtures === null ? null : await loadTaskFlags(fixtures);
    if (fixtures !== null && flags !== null) taskFlags[fixtures] = flags;
  }

  const runs: RunRow[] = [];
  const runDirs = new Map<string, string>();
  for (const batch of batches) {
    const flawed = new Set(Object.keys(taskFlags[batch.fixtures ?? ""]?.flawed ?? {}));
    for (const [id, dir, row] of await readBatchRuns(batch, flawed)) {
      runs.push(row);
      runDirs.set(id, dir);
    }
  }
  return { roots, batches, runs, taskFlags, runDirs, scannedAt: new Date().toISOString() };
}

async function findBatchDirs(dir: string, depth: number): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.map((e) => e.name));
  if (names.has("manifest.json") && names.has("runs")) return [dir];
  if (depth === 0) return [];
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    found.push(...(await findBatchDirs(join(dir, entry.name), depth - 1)));
  }
  return found;
}

async function readBatch(dir: string, id: string): Promise<Batch | null> {
  const manifest = await readJson<Record<string, unknown>>(join(dir, "manifest.json"));
  if (manifest === null || !Array.isArray(manifest.models) || !Array.isArray(manifest.arms)) {
    return null;
  }
  return {
    id,
    dir,
    created: str(manifest.created),
    fixtures: str(manifest.fixtures),
    models: manifest.models.map(String),
    arms: manifest.arms.map(String),
    tasks: Array.isArray(manifest.tasks) ? manifest.tasks.map(String) : [],
    attempts: num(manifest.attempts),
    maxSteps: num(manifest.maxSteps),
    earlyStop: typeof manifest.earlyStop === "boolean" ? manifest.earlyStop : null,
  };
}

/** Walks `runs/<model>/<arm>/<task>/a<n>/`. */
async function readBatchRuns(
  batch: Batch,
  flawed: ReadonlySet<string>,
): Promise<Array<[string, string, RunRow]>> {
  const modelNames = new Map(batch.models.map((m) => [m.replace(/[^a-zA-Z0-9._-]/g, "_"), m]));
  const out: Array<[string, string, RunRow]> = [];
  const runsDir = join(batch.dir, "runs");
  for (const modelDir of await subdirs(runsDir)) {
    for (const arm of await subdirs(join(runsDir, modelDir))) {
      for (const task of await subdirs(join(runsDir, modelDir, arm))) {
        const taskDir = join(runsDir, modelDir, arm, task);
        for (const attemptDir of await subdirs(taskDir)) {
          if (!/^a\d+$/.test(attemptDir)) continue;
          const attempt = Number(attemptDir.slice(1));
          const dir = join(taskDir, attemptDir);
          const id = `${batch.id}/${modelDir}/${arm}/${task}/${attemptDir}`;
          const result = await readJson<CellResult>(join(dir, "result.json"));
          const model = result?.model ?? modelNames.get(modelDir) ?? modelDir;
          out.push([
            id,
            dir,
            toRow(id, batch, { model, arm, task, attempt, flawed: flawed.has(task) }, result),
          ]);
        }
      }
    }
  }
  return out;
}

function toRow(
  id: string,
  batch: Batch,
  cell: { model: string; arm: string; task: string; attempt: number; flawed: boolean },
  result: CellResult | null,
): RunRow {
  const m = result?.metrics;
  const toolErrorCodes = m?.toolErrors ?? {};
  return {
    id,
    batch: batch.id,
    fixtures: batch.fixtures,
    ...cell,
    passed: result?.passed ?? null,
    end: result?.end ?? "incomplete",
    linesChanged: result?.linesChanged ?? null,
    verifyError: result?.verifyError ?? null,
    loopError: result?.loopError ?? null,
    difficulty: result?.difficulty ?? null,
    mutationType: result?.mutationType ?? null,
    steps: m?.steps ?? 0,
    toolCalls: sum(m?.toolCalls ?? {}),
    toolErrors: sum(toolErrorCodes),
    toolErrorCodes,
    inputTokens: m?.inputTokens ?? 0,
    outputTokens: m?.outputTokens ?? 0,
    reasoningTokens: m?.reasoningTokens ?? 0,
    wallMs: result?.wallMs ?? null,
    costUsd: m === undefined ? null : runCostUsd(cell.model, m),
  };
}

async function subdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function readJson<T>(file: string): Promise<T | null> {
  if (!(await stat(file).catch(() => null))) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
