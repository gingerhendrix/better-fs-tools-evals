import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cellPath } from "@bfe/core";
import type { CellResult, EditTask, ScorerResolver } from "@bfe/core";
import { evalModel } from "@bfe/providers";
import { readCellResult } from "@bfe/results";
import type { Arm } from "@bfe/tools";

import { runLoop } from "./loop.ts";
import { instrumentWrites } from "./metrics.ts";
import { explicitEditSystemPrompt, systemPrompt } from "./prompts.ts";

export interface Cell {
  readonly model: string;
  readonly arm: Arm;
  readonly task: EditTask;
  readonly attempt: number;
}

export interface RunOptions {
  readonly outDir: string;
  readonly maxSteps: number;
  readonly stepTimeoutMs: number;
  readonly earlyStop: boolean;
  readonly keepWorkspace: boolean;
  /** Maps a task's scorer id to its verifier. The CLI passes the scorer registry. */
  readonly scorers: ScorerResolver;
}

export function cellDir(outDir: string, cell: Cell): string {
  return cellPath(outDir, {
    model: cell.model,
    arm: cell.arm.name,
    task: cell.task.id,
    attempt: cell.attempt,
  });
}

/** Shared by live runs and the offline byte-copy check. */
export async function copyTaskInput(inputDir: string, workspace: string): Promise<void> {
  await cp(inputDir, workspace, { recursive: true });
}

/**
 * Runs one (model, arm, task, attempt) cell: copy the fixture input to a
 * fresh workspace, run the loop with the arm's tools, verify the workspace
 * against `expected/`, and write `result.json`.
 */
export async function runCell(cell: Cell, options: RunOptions): Promise<CellResult> {
  const dir = cellDir(options.outDir, cell);
  await rm(dir, { recursive: true, force: true });
  const workspace = join(dir, "workspace");
  await mkdir(dir, { recursive: true });
  await copyTaskInput(cell.task.inputDir, workspace);

  const started = Date.now();
  const verify = () => options.scorers(cell.task.verify)(cell.task.expectedDir, workspace);
  const writes = { shortWriteCalls: 0 };
  const tools = instrumentWrites(cell.arm.tools(workspace), workspace, writes);
  const loop = await runLoop({
    model: evalModel(cell.model, join(dir, "http.jsonl")),
    system:
      cell.task.verify === "exact"
        ? explicitEditSystemPrompt(cell.arm.toolNames, cell.task.files)
        : systemPrompt(cell.arm.editTool),
    prompt: cell.task.prompt,
    tools,
    maxSteps: options.maxSteps,
    stepTimeoutMs: options.stepTimeoutMs,
    stepLog: join(dir, "steps.jsonl"),
    ...(options.earlyStop ? { isSolved: async () => (await verify()).passed } : {}),
  });
  const wallMs = Date.now() - started;
  const verification = await verify();

  const result: CellResult = {
    model: cell.model,
    arm: cell.arm.name,
    task: cell.task.id,
    attempt: cell.attempt,
    difficulty: cell.task.difficulty,
    mutationType: cell.task.mutationType,
    passed: verification.passed,
    verifyError: verification.error,
    verify: cell.task.verify ?? "omp",
    damage: verification.damage,
    linesChanged: verification.linesChanged,
    end: loop.end,
    loopError: loop.error,
    providerHttpErrors: await countHttpErrors(join(dir, "http.jsonl")),
    wallMs,
    metrics: { ...loop.metrics, shortWriteCalls: writes.shortWriteCalls },
  };
  await writeFile(join(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  if (!options.keepWorkspace) await rm(workspace, { recursive: true, force: true });
  return result;
}

async function countHttpErrors(file: string): Promise<number> {
  const text = await readFile(file, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .filter((line) => (JSON.parse(line) as { status: number }).status !== 200).length;
}

/**
 * Runs cells with a fixed number of workers. A cell with a saved result is
 * skipped, unless the saved run ended in a provider error.
 */
export async function runMatrix(
  cells: readonly Cell[],
  options: RunOptions & { readonly concurrency: number },
  onResult: (result: CellResult, skipped: boolean) => void,
): Promise<CellResult[]> {
  const results: CellResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < cells.length) {
      const cell = cells[next++]!;
      const found = await readCellResult(cellDir(options.outDir, cell));
      const saved = found !== null && found.end !== "error" ? found : null;
      const result = saved ?? (await runCell(cell, options));
      results.push(result);
      onResult(result, saved !== null);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  return results;
}
