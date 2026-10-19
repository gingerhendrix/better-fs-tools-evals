import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptyMetrics } from "../../src/metrics.ts";
import { scanCatalog } from "../../src/viewer/catalog.ts";

let root: string;

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "viewer-catalog-"));
  const batch = join(root, "2026-10-17-day", "full-ds");
  await writeJson(join(batch, "manifest.json"), {
    created: "2026-10-17T17:00:00.000Z",
    fixtures: "/fixtures",
    models: ["deepseek/deepseek-v4.1-flash"],
    arms: ["edit"],
    tasks: ["task-001"],
    attempts: 2,
  });
  const cell = join(batch, "runs", "deepseek_deepseek-v4.1-flash", "edit", "task-001");
  await writeJson(join(cell, "a1", "result.json"), {
    model: "deepseek/deepseek-v4.1-flash",
    arm: "edit",
    task: "task-001",
    attempt: 1,
    difficulty: "easy",
    mutationType: "flip",
    passed: true,
    verifyError: null,
    linesChanged: 0,
    end: "matched",
    loopError: null,
    providerHttpErrors: 0,
    wallMs: 1200,
    metrics: {
      ...emptyMetrics(),
      steps: 2,
      toolCalls: { read: 1, edit: 1 },
      toolErrors: { "read:NOT_FOUND": 2 },
    },
  });
  // Attempt 2 started but never wrote result.json.
  await mkdir(join(cell, "a2"), { recursive: true });
  await writeFile(join(cell, "a2", "steps.jsonl"), "");
  // A manifest with no runs/ folder is not a batch.
  await writeJson(join(root, "other", "manifest.json"), { models: [], arms: [] });
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("scanCatalog", () => {
  test("finds a batch folder below the root and names it by its relative path", async () => {
    const catalog = await scanCatalog([root]);
    expect(catalog.batches.map((b) => b.id)).toEqual(["2026-10-17-day/full-ds"]);
    expect(catalog.batches[0]!.fixtures).toBe("/fixtures");
  });

  test("flattens a result into a row and maps the folder name back to the model id", async () => {
    const catalog = await scanCatalog([root]);
    const row = catalog.runs.find((r) => r.attempt === 1)!;
    expect(row).toMatchObject({
      id: "2026-10-17-day/full-ds/deepseek_deepseek-v4.1-flash/edit/task-001/a1",
      model: "deepseek/deepseek-v4.1-flash",
      passed: true,
      end: "matched",
      toolCalls: 2,
      toolErrors: 2,
    });
    expect(catalog.runDirs.get(row.id)).toEndWith(join("task-001", "a1"));
  });

  test("keeps a cell with no result.json as an incomplete run", async () => {
    const catalog = await scanCatalog([root]);
    const row = catalog.runs.find((r) => r.attempt === 2)!;
    expect(row).toMatchObject({
      model: "deepseek/deepseek-v4.1-flash",
      passed: null,
      end: "incomplete",
    });
  });

  test("stops at the depth limit", async () => {
    const catalog = await scanCatalog([root], 1);
    expect(catalog.batches).toEqual([]);
  });
});
