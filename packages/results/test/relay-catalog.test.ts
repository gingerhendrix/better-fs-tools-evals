import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptyMetrics } from "@bfe/core";
import { scanCatalog } from "../src/catalog.ts";
import { loadTrace } from "../src/trace.ts";

let root: string;
let relay: string;

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

const step = (
  index: number,
  direction: "forward" | "backward",
  extra: Record<string, unknown> = {},
) => ({
  index,
  roundTrip: Math.floor(index / 2) + 1,
  direction,
  fromState: direction === "forward" ? "base" : "target",
  targetState: direction === "forward" ? "target" : "base",
  end: "done",
  loopError: null,
  fileSet: { ok: true, missing: [], extra: [] },
  score: null,
  wallMs: 1000,
  metrics: { ...emptyMetrics(), steps: 3, toolCalls: { read: 2, write: 1 } },
  ...extra,
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "viewer-relays-"));
  const batch = join(root, "d52-run", "main-rt2");
  await writeJson(join(batch, "manifest.json"), {
    created: "2026-10-20T00:33:51.534Z",
    benchmark: "delegate52",
    data: "/data/delegate52.jsonl",
    samples: [{ id: "docker1", domain: "docker", forwardOrder: ["target"] }],
    models: ["codex-oauth:gpt-6-luna:medium"],
    arms: [{ name: "bft-edit" }],
    roundTrips: 3,
    loop: { maxSteps: 25 },
  });
  relay = join(batch, "relays", "codex-oauth_gpt-6-luna_medium", "bft-edit", "docker1");
  await writeJson(join(relay, "i01", "interaction.json"), step(0, "forward"));
  await writeFile(join(relay, "i01", "steps.jsonl"), "");
  await writeJson(join(relay, "i01", "snapshot.json"), { files: { Dockerfile: "FROM a\n" } });
  await writeJson(
    join(relay, "i02", "interaction.json"),
    step(1, "backward", { score: { score: 0.95 } }),
  );
  await writeJson(join(relay, "i03", "interaction.json"), {
    ...step(2, "forward"),
    fileSet: { ok: false, missing: ["Dockerfile.base"], extra: [] },
  });
  await writeJson(
    join(relay, "i04", "interaction.json"),
    step(3, "backward", { score: { score: 0.8 } }),
  );
  // A step whose only attempt hit the step timeout.
  await writeJson(join(relay, "i05", "error-1792457142359.json"), {
    ...step(4, "forward"),
    end: "error",
    loopError: "TimeoutError: The operation timed out.",
  });
  // A step that started and wrote nothing.
  await mkdir(join(relay, "i06"), { recursive: true });
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("scanCatalog with a DELEGATE-52 folder", () => {
  test("finds the folder and reads the manifest's samples, arms, and dataset", async () => {
    const catalog = await scanCatalog([root]);
    expect(catalog.batches).toHaveLength(1);
    expect(catalog.batches[0]).toMatchObject({
      id: "d52-run/main-rt2",
      kind: "relays",
      fixtures: "/data/delegate52.jsonl",
      models: ["codex-oauth:gpt-6-luna:medium"],
      arms: ["bft-edit"],
      tasks: ["docker1"],
      attempts: 6,
      maxSteps: 25,
    });
  });

  test("makes one row per interaction, with the sample as the task", async () => {
    const catalog = await scanCatalog([root]);
    expect(catalog.runs.map((r) => [r.task, r.attempt])).toEqual([
      ["docker1", 1],
      ["docker1", 2],
      ["docker1", 3],
      ["docker1", 4],
      ["docker1", 5],
      ["docker1", 6],
    ]);
    expect(catalog.runs[0]).toMatchObject({
      kind: "relays",
      model: "codex-oauth:gpt-6-luna:medium",
      step: "rt1 forward: base -> target",
      steps: 3,
      toolCalls: 3,
    });
  });

  test("grades forward steps on the file set and backward steps on a critical drop", async () => {
    const catalog = await scanCatalog([root]);
    const [i1, i2, i3, i4, i5, i6] = catalog.runs;
    expect(i1).toMatchObject({ passed: true, score: null, verifyError: null });
    expect(i2).toMatchObject({ passed: true, score: 0.95, verifyError: null });
    expect(i3).toMatchObject({
      passed: false,
      verifyError: "file set: missing [Dockerfile.base], extra []",
    });
    expect(i4).toMatchObject({
      passed: false,
      score: 0.8,
      verifyError: "critical drop: 0.950 -> 0.800",
    });
    expect(i5).toMatchObject({ end: "error", loopError: "TimeoutError: The operation timed out." });
    expect(i6).toMatchObject({ end: "incomplete", passed: null });
  });

  test("loads an interaction trace with its result and the files after the step", async () => {
    const catalog = await scanCatalog([root]);
    const source = catalog.runDirs.get(catalog.runs[0]!.id)!;
    expect(source).toEqual({ kind: "relays", dir: join(relay, "i01") });
    const trace = await loadTrace(source.dir, source.kind);
    expect(trace.result).toMatchObject({ direction: "forward" });
    expect(trace.files).toEqual({ Dockerfile: "FROM a\n" });
    expect(trace.patch).toBeNull();
  });
});
