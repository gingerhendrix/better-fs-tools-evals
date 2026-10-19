import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { ScorerId } from "./score.ts";

/**
 * One fixture folder: `prompt.md`, `input/`, `expected/`, and `metadata.json`.
 * The Oh My Pi `typescript-edit-benchmark` uses this layout, and the Explicit Edit
 * exporter writes it too. `verify` names the scorer that grades the task.
 */
export interface EditTask {
  readonly id: string;
  readonly verify?: ScorerId;
  readonly upstreamCommit?: string;
  readonly fixtureSha256?: string;
  readonly family?: string;
  readonly scale?: number;
  readonly variant?: string;
  readonly prompt: string;
  readonly inputDir: string;
  readonly expectedDir: string;
  readonly files: readonly string[];
  readonly difficulty: string | null;
  readonly mutationType: string | null;
  readonly fileLines: number | null;
}

export async function listFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, full)));
    else if (entry.isFile()) out.push(relative(root, full));
  }
  return out.sort();
}

export async function loadTask(fixturesDir: string, id: string): Promise<EditTask> {
  const dir = join(fixturesDir, id);
  const prompt = await readFile(join(dir, "prompt.md"), "utf8");
  const meta = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8")) as {
    verify?: ScorerId;
    upstreamCommit?: string;
    fixtureSha256?: string;
    family?: string;
    scale?: number;
    variant?: string;
    difficulty?: string;
    mutation_type?: string;
    context?: { file_lines?: number };
  };
  if (meta.verify !== undefined && meta.verify !== "omp" && meta.verify !== "exact")
    throw new Error(`unknown verifier: ${meta.verify}`);
  const inputDir = join(dir, "input");
  return {
    id,
    verify: meta.verify ?? "omp",
    upstreamCommit: meta.upstreamCommit,
    fixtureSha256: meta.fixtureSha256,
    family: meta.family,
    scale: meta.scale,
    variant: meta.variant,
    prompt: meta.verify === "exact" ? prompt : prompt.trim(),
    inputDir,
    expectedDir: join(dir, "expected"),
    files: await listFiles(inputDir),
    difficulty: meta.difficulty ?? null,
    mutationType: meta.mutation_type ?? null,
    fileLines: meta.context?.file_lines ?? null,
  };
}

/** Loads every fixture, or the named ones in the given order. */
export async function loadTasks(fixturesDir: string, ids?: readonly string[]): Promise<EditTask[]> {
  const names =
    ids ??
    (await readdir(fixturesDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  return Promise.all(names.map((id) => loadTask(fixturesDir, id)));
}
