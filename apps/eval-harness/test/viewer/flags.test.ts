import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inScope, parseScope } from "../../src/viewer/app/stats.ts";
import type { RunRow } from "../../src/viewer/catalog.ts";
import { scanCatalog } from "../../src/viewer/catalog.ts";
import { loadTaskFlags } from "../../src/viewer/flags.ts";

let root: string;
let fixtures: string;

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "viewer-flags-"));
  fixtures = join(root, "fixtures");
  await writeJson(join(fixtures, "task-flags.json"), {
    version: 1,
    source: "results.md",
    flawed: { "task-002": "The prompt is inverted.", "task-003": 7 },
  });
  const batch = join(root, "runs-folder");
  await writeJson(join(batch, "manifest.json"), {
    fixtures,
    models: ["m"],
    arms: ["edit"],
    tasks: ["task-001", "task-002"],
    attempts: 1,
  });
  for (const task of ["task-001", "task-002"]) {
    await writeJson(join(batch, "runs", "m", "edit", task, "a1", "result.json"), {
      model: "m",
      passed: true,
      end: "matched",
    });
  }
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("loadTaskFlags", () => {
  test("reads the flawed tasks and drops entries whose reason is not text", async () => {
    const flags = await loadTaskFlags(fixtures);
    expect(flags).toEqual({
      file: join(fixtures, "task-flags.json"),
      source: "results.md",
      flawed: { "task-002": "The prompt is inverted." },
    });
  });

  test("returns null when the file is missing", async () => {
    expect(await loadTaskFlags(join(root, "nowhere"))).toBeNull();
  });

  test("returns null for bad JSON or an unknown version", async () => {
    const bad = join(root, "bad");
    await writeJson(join(bad, "task-flags.json"), "{ not json");
    expect(await loadTaskFlags(bad)).toBeNull();
    const v2 = join(root, "v2");
    await writeJson(join(v2, "task-flags.json"), { version: 2, flawed: {} });
    expect(await loadTaskFlags(v2)).toBeNull();
  });
});

describe("scanCatalog with task flags", () => {
  test("keys the flags by fixtures dir and marks only the flawed task's runs", async () => {
    const catalog = await scanCatalog([root]);
    expect(Object.keys(catalog.taskFlags)).toEqual([fixtures]);
    const flawed = Object.fromEntries(catalog.runs.map((r) => [r.task, r.flawed]));
    expect(flawed).toEqual({ "task-001": false, "task-002": true });
  });
});

describe("task scope", () => {
  const run = (flawed: boolean) => ({ flawed }) as RunRow;

  test("clean keeps unflagged tasks, flawed keeps flagged tasks, all keeps both", () => {
    expect([inScope(run(false), "clean"), inScope(run(true), "clean")]).toEqual([true, false]);
    expect([inScope(run(false), "flawed"), inScope(run(true), "flawed")]).toEqual([false, true]);
    expect([inScope(run(false), "all"), inScope(run(true), "all")]).toEqual([true, true]);
  });

  test("an unknown or missing scope means all", () => {
    expect(parseScope(null)).toBe("all");
    expect(parseScope("dirty")).toBe("all");
    expect(parseScope("clean")).toBe("clean");
  });
});
