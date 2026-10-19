import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createTwoFilesPatch } from "diff";

import { loadTask } from "../tasks.ts";

export interface FixtureView {
  readonly id: string;
  readonly prompt: string;
  readonly difficulty: string | null;
  readonly mutationType: string | null;
  readonly fileLines: number | null;
  /** Unified diff from `input/` to `expected/`: the fix the verifier wants. */
  readonly expectedDiff: string;
}

/** Reads a fixture folder. Returns null when the folder is gone. */
export async function loadFixture(fixturesDir: string, id: string): Promise<FixtureView | null> {
  const task = await loadTask(fixturesDir, id).catch(() => null);
  if (task === null) return null;
  const patches: string[] = [];
  for (const file of task.files) {
    const before = await readFile(join(task.inputDir, file), "utf8").catch(() => "");
    const after = await readFile(join(task.expectedDir, file), "utf8").catch(() => "");
    if (before !== after)
      patches.push(createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after));
  }
  return {
    id,
    prompt: task.prompt,
    difficulty: task.difficulty,
    mutationType: task.mutationType,
    fileLines: task.fileLines,
    expectedDiff: patches.join("\n"),
  };
}
