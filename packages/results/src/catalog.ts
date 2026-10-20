import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { modelDirName } from "@bfe/core";
import type { CellResult } from "@bfe/core";

import { loadTaskFlags } from "./flags.ts";
import { num, readJson, str, subdirs, sum } from "./fs-json.ts";
import { readHarborJob } from "./harbor-catalog.ts";
import { runCostUsd } from "./pricing.ts";
import { readRelayBatch } from "./relay-catalog.ts";
import type { TaskFlags } from "./flags.ts";

export { readJson } from "./fs-json.ts";

/**
 * The folder layout a batch uses:
 * - `cells`: a harness `run --out` folder, `manifest.json` beside `runs/<model>/<arm>/<task>/a<n>/`;
 * - `relays`: a DELEGATE-52 `d52` folder, `manifest.json` beside `relays/<model>/<arm>/<sample>/i<nn>/`;
 * - `harbor`: a Harbor job folder, `config.json` and `job.log` beside one folder per trial.
 */
export type BatchKind = "cells" | "relays" | "harbor";

/** One run output folder. */
export interface Batch {
  readonly id: string;
  readonly kind: BatchKind;
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
  readonly kind: BatchKind;
  readonly batch: string;
  readonly fixtures: string | null;
  readonly model: string;
  readonly arm: string;
  /** The task id. For a relay, the sample id. */
  readonly task: string;
  /** The attempt number. For a relay, the interaction number. */
  readonly attempt: number;
  /** The fixture set's `task-flags.json` marks this task as flawed. */
  readonly flawed: boolean;
  readonly passed: boolean | null;
  readonly end: string;
  /** A graded score from 0 to 1: the relay backward-step score or the Harbor reward before its threshold. */
  readonly score: number | null;
  /** A short note on what this run was, for example "rt2 backward: a -> b". */
  readonly step: string | null;
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

/** Where the server reads one run's trace from. */
export interface RunSource {
  readonly kind: BatchKind;
  readonly dir: string;
}

/** What a batch reader gives back: the batch and each run with its folder. */
export interface BatchRead {
  readonly batch: Batch;
  readonly runs: ReadonlyArray<readonly [RunSource, RunRow]>;
}

export interface Catalog {
  readonly roots: readonly string[];
  readonly batches: readonly Batch[];
  readonly runs: readonly RunRow[];
  /** Fixtures dir to its `task-flags.json`, for the sets that have one. */
  readonly taskFlags: Readonly<Record<string, TaskFlags>>;
  /** Run id to its folder. The server reads traces only from these folders. */
  readonly runDirs: ReadonlyMap<string, RunSource>;
  readonly scannedAt: string;
}

export interface ScanOptions {
  /** How many folder levels below each root to search. */
  readonly maxDepth?: number;
  /** Batch ids that hold any of these strings are left out. */
  readonly exclude?: readonly string[];
}

const SKIP_DIRS = new Set(["node_modules", "runs", "relays", "workspace", "dist", "target"]);

/** Scans each root for batch folders, then reads every run in them. */
export async function scanCatalog(
  roots: readonly string[],
  options: ScanOptions | number = {},
): Promise<Catalog> {
  const { maxDepth = 3, exclude = [] } =
    typeof options === "number" ? { maxDepth: options } : options;
  const reads: BatchRead[] = [];
  for (const root of roots) {
    const prefix = roots.length > 1 ? `${basename(root)}/` : "";
    for (const { dir, kind } of await findBatchDirs(root, maxDepth)) {
      const id = `${prefix}${relative(root, dir) || basename(dir)}`;
      if (exclude.some((part) => id.includes(part))) continue;
      const read = await readBatch(kind, dir, id);
      if (read !== null) reads.push(read);
    }
  }
  reads.sort(
    (a, b) =>
      (a.batch.created ?? "").localeCompare(b.batch.created ?? "") ||
      a.batch.id.localeCompare(b.batch.id),
  );

  const taskFlags: Record<string, TaskFlags> = {};
  for (const fixtures of new Set(reads.map((r) => r.batch.fixtures))) {
    const flags = fixtures === null ? null : await loadTaskFlags(fixtures);
    if (fixtures !== null && flags !== null) taskFlags[fixtures] = flags;
  }

  const runs: RunRow[] = [];
  const runDirs = new Map<string, RunSource>();
  for (const { batch, runs: batchRuns } of reads) {
    const flawed = new Set(Object.keys(taskFlags[batch.fixtures ?? ""]?.flawed ?? {}));
    for (const [source, row] of batchRuns) {
      runs.push(flawed.has(row.task) ? { ...row, flawed: true } : row);
      runDirs.set(row.id, source);
    }
  }
  return {
    roots,
    batches: reads.map((r) => r.batch),
    runs,
    taskFlags,
    runDirs,
    scannedAt: new Date().toISOString(),
  };
}

function readBatch(kind: BatchKind, dir: string, id: string): Promise<BatchRead | null> {
  if (kind === "relays") return readRelayBatch(dir, id);
  if (kind === "harbor") return readHarborJob(dir, id);
  return readCellBatch(dir, id);
}

async function findBatchDirs(
  dir: string,
  depth: number,
): Promise<Array<{ dir: string; kind: BatchKind }>> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.map((e) => e.name));
  if (names.has("manifest.json") && names.has("runs")) return [{ dir, kind: "cells" }];
  if (names.has("manifest.json") && names.has("relays")) return [{ dir, kind: "relays" }];
  if (names.has("config.json") && names.has("job.log")) return [{ dir, kind: "harbor" }];
  if (depth === 0) return [];
  const found: Array<{ dir: string; kind: BatchKind }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    found.push(...(await findBatchDirs(join(dir, entry.name), depth - 1)));
  }
  return found;
}

async function readCellBatch(dir: string, id: string): Promise<BatchRead | null> {
  const manifest = await readJson<Record<string, unknown>>(join(dir, "manifest.json"));
  if (manifest === null || !Array.isArray(manifest.models) || !Array.isArray(manifest.arms)) {
    return null;
  }
  const batch: Batch = {
    id,
    kind: "cells",
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
  return { batch, runs: await readCellRuns(batch) };
}

/** Walks `runs/<model>/<arm>/<task>/a<n>/`. */
async function readCellRuns(batch: Batch): Promise<Array<[RunSource, RunRow]>> {
  const modelNames = new Map(batch.models.map((m) => [modelDirName(m), m]));
  const out: Array<[RunSource, RunRow]> = [];
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
            { kind: "cells", dir },
            toRow(id, batch, { model, arm, task, attempt, flawed: false }, result),
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
    kind: "cells",
    batch: batch.id,
    fixtures: batch.fixtures,
    ...cell,
    passed: result?.passed ?? null,
    end: result?.end ?? "incomplete",
    score: null,
    step: null,
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
