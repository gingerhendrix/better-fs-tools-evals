/**
 * The read side against copies of real run folders, schema version 0.
 *
 * - `omp-smoke-2026-09-28`: the first smoke run. Its results have no `verify` or `damage`.
 * - `explicit-edit-stage3-glm-2026-10-18`: an exact-scorer run at `657ff14`, with a
 *   provider error that left byte damage, and a manifest with provenance.
 *
 * The copies drop `workspace/` folders, and their manifest `fixtures` paths point at
 * folders that do not exist. test/fixtures/v0/README.md describes the copies.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { collectResults, readCellResult } from "../src/read.ts";
import { markdownReport, summarise } from "../src/report.ts";
import { scanCatalog } from "../src/catalog.ts";
import { loadTrace } from "../src/trace.ts";

const ROOT = join(import.meta.dir, "fixtures", "v0");
const OMP = join(ROOT, "omp-smoke-2026-09-28");
const EE = join(ROOT, "explicit-edit-stage3-glm-2026-10-18");
const OMP_CELL = join(OMP, "runs/xiaomi_mimo-v2.6-flash/edit/call-swap-call-args-001/a1");
const EE_FAIL = join(EE, "runs/z-ai_glm-5.3-flash/edit-exact/literal-1-crlf-plain/a1");

describe("catalog", () => {
  test("finds both batches in creation order and every cell", async () => {
    const catalog = await scanCatalog([ROOT]);
    expect(catalog.batches.map((b) => b.id)).toEqual([
      "omp-smoke-2026-09-28",
      "explicit-edit-stage3-glm-2026-10-18",
    ]);
    expect(catalog.runs).toHaveLength(6);
    expect(catalog.runDirs.size).toBe(6);
    expect(catalog.taskFlags).toEqual({});
  });

  test("reads outcomes, model ids, and costs from version 0 results", async () => {
    const { runs } = await scanCatalog([ROOT]);
    const omp = runs.filter((r) => r.batch === "omp-smoke-2026-09-28");
    expect(omp.every((r) => r.passed === true && r.end === "matched")).toBe(true);
    expect(new Set(omp.map((r) => r.model))).toEqual(
      new Set(["xiaomi/mimo-v2.6-flash", "nvidia/nemotron-3-ultra-550b-a55b"]),
    );
    expect(omp.every((r) => r.costUsd !== null && r.costUsd > 0)).toBe(true);

    const failed = runs.find((r) => r.arm === "edit-exact")!;
    expect(failed).toMatchObject({
      model: "z-ai/glm-5.3-flash",
      task: "literal-1-crlf-plain",
      passed: false,
      end: "error",
      linesChanged: 2,
      steps: 2,
    });
    expect(failed.verifyError).toContain("content: sample.txt");
  });
});

describe("trace", () => {
  test("rebuilds the OMP system prompt, tools, and steps from a 2026-09-28 cell", async () => {
    const trace = await loadTrace(OMP_CELL);
    expect(trace.system).toContain("Code-edit benchmark");
    expect(trace.prompt).not.toBeNull();
    expect(trace.tools.map((t) => t.name).sort()).toEqual(["edit", "read"]);
    expect(trace.steps).toHaveLength(2);
    expect(trace.http.every((call) => call.status === 200)).toBe(true);
  });

  test("rebuilds the Explicit Edit prompt with its file list", async () => {
    const trace = await loadTrace(EE_FAIL);
    expect(trace.system).toContain("Preserve all bytes outside the requested changes");
    expect(trace.system).toContain("Files in the working directory:");
    expect(trace.tools.map((t) => t.name).sort()).toEqual(["edit", "read", "write"]);
  });
});

describe("results and report", () => {
  test("reads a saved cell, and null for a folder with no result", async () => {
    expect((await readCellResult(OMP_CELL))?.task).toBe("call-swap-call-args-001");
    expect(await readCellResult(join(OMP, "runs"))).toBeNull();
  });

  test("reports old OMP results with zero damage and no verifier field", async () => {
    const results = await collectResults(OMP);
    expect(results).toHaveLength(4);
    const groups = summarise(results);
    expect(groups.map((g) => [g.model, g.arm, g.runs, g.passed])).toEqual([
      ["nvidia/nemotron-3-ultra-550b-a55b", "edit", 1, 1],
      ["nvidia/nemotron-3-ultra-550b-a55b", "patch", 1, 1],
      ["xiaomi/mimo-v2.6-flash", "edit", 1, 1],
      ["xiaomi/mimo-v2.6-flash", "patch", 1, 1],
    ]);
    expect(groups.every((g) => Object.keys(g.damageKinds).length === 0)).toBe(true);
    expect(markdownReport(results)).toContain("| xiaomi/mimo-v2.6-flash | patch | 1 | 1 (100%) |");
  });

  test("reports exact-scorer damage and provider errors", async () => {
    const groups = summarise(await collectResults(EE));
    const exact = groups.find((g) => g.arm === "edit-exact")!;
    expect(exact).toMatchObject({ runs: 1, passed: 0, providerErrors: 1 });
    expect(exact.damageKinds).toEqual({ content: 1 });
    expect(groups.find((g) => g.arm === "bash")).toMatchObject({ runs: 1, passed: 1 });
  });
});
