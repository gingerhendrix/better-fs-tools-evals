import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FileMap, RelayInteraction, RelaySample, RelayScorer } from "@bfe/core";
import { relayPath } from "@bfe/core";
import { BFT_EDIT_ARM, D52_TOOLS_ARM } from "@bfe/tools";
import type { RelayArm } from "@bfe/tools";
import type { LanguageModel } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";

import { runRelay } from "../src/relay.ts";
import type { RelayOptions } from "../src/relay.ts";

const SEED = "FROM debian:12\nRUN apt-get update\n";
const ALPINE = "FROM alpine:3\nRUN apk update\n";

const SAMPLE: RelaySample = {
  id: "docker1",
  domain: "docker",
  name: "fixture",
  license: null,
  startState: "basic_state",
  states: [
    {
      id: "basic_state",
      targetFiles: ["Dockerfile"],
      prompts: [{ targetState: "alpine", prompt: "GO-ALPINE" }],
    },
    {
      id: "alpine",
      targetFiles: ["Dockerfile"],
      prompts: [{ targetState: "basic_state", prompt: "GO-DEBIAN" }],
    },
  ],
  seedFiles: { Dockerfile: SEED },
  distractorFiles: { "notes.txt": "distractor\n" },
};

type Call = { tool: string; input: Record<string, unknown> } | { text: string };

const usage = {
  inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

/** A model that plays `script(task, step)` and records each prompt it gets. */
function fakeModel(script: (task: string, step: number) => Call): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const user = prompt.find((m) => m.role === "user");
      const text = JSON.stringify(user?.content ?? "");
      const task = text.includes("GO-ALPINE") ? "alpine" : "debian";
      const step = prompt.filter((m) => m.role === "assistant").length;
      const next = script(task, step);
      const parts =
        "text" in next
          ? [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: next.text },
              { type: "text-end" as const, id: "t" },
            ]
          : [
              {
                type: "tool-call" as const,
                toolCallId: `c${step}`,
                toolName: next.tool,
                input: JSON.stringify(next.input),
              },
            ];
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start" as const, warnings: [] },
          ...parts,
          {
            type: "finish" as const,
            usage,
            finishReason: { unified: "text" in next ? "stop" : "tool-calls", raw: undefined },
          },
        ]),
      };
    },
  });
}

/** d52-tools: read, write the target text, then finish. */
const d52Script = (task: string, step: number): Call =>
  [
    { tool: "read_file", input: { filename: "Dockerfile" } },
    {
      tool: "write_file",
      input: { filename: "Dockerfile", content: task === "alpine" ? ALPINE : SEED },
    },
    { tool: "finish", input: {} },
  ][step] ?? { text: "done" };

let outDir: string;
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "relay-"));
});
afterEach(() => rm(outDir, { recursive: true, force: true }));

const scored: FileMap[] = [];
const scorer: RelayScorer = async (_sample, files) => {
  scored.push(files);
  return { score: files.Dockerfile === SEED ? 1 : 0.5, error: null, details: {} };
};

function options(arm: RelayArm, model: LanguageModel, extra: Partial<RelayOptions> = {}) {
  return {
    outDir,
    sample: SAMPLE,
    arm,
    model: "fake/model",
    forwardOrder: ["alpine", "alpine"],
    seed: 52,
    distractors: true,
    scorer,
    maxSteps: 25,
    stepTimeoutMs: 10_000,
    maxTotalTokens: 500_000,
    retries: 0,
    modelFor: () => model,
    ...extra,
  } satisfies RelayOptions;
}

test("a d52-tools relay scores backward steps, strips distractors, and saves snapshots", async () => {
  scored.length = 0;
  const relay = await runRelay(options(D52_TOOLS_ARM, fakeModel(d52Script)));
  expect(relay.complete).toBe(true);
  expect(relay.interactions.map((i) => [i.direction, i.end, i.finished])).toEqual([
    ["forward", "done", true],
    ["backward", "done", true],
    ["forward", "done", true],
    ["backward", "done", true],
  ]);
  const [fwd, back] = relay.interactions as [RelayInteraction, RelayInteraction];
  expect(fwd.score).toBeNull();
  expect(fwd.strippedDistractors).toEqual(["notes.txt"]);
  expect(fwd.files).toEqual(["Dockerfile"]);
  expect(back.score?.score).toBe(1);
  expect(back.seed).toMatchObject({ exact: true, lineDiff: 0 });
  expect(back.toolSequence).toEqual(["read_file", "write_file", "finish"]);
  expect(back.metrics.inputTokens).toBe(300);
  expect(scored).toHaveLength(2);
  expect(scored.every((f) => !("notes.txt" in f))).toBe(true);

  const dir = relayPath(outDir, "fake/model", "d52-tools", "docker1");
  expect((await readdir(dir)).sort()).toEqual(["i01", "i02", "i03", "i04", "relay.json"]);
  const snapshot = JSON.parse(await readFile(join(dir, "i01", "snapshot.json"), "utf8"));
  expect(snapshot.files).toEqual({ Dockerfile: ALPINE });
});

test("a bft-edit relay gets the nudge once when it stops before a write", async () => {
  const script = (task: string, step: number): Call =>
    [
      { text: "I will look first." },
      { tool: "read", input: { path: "Dockerfile" } },
      {
        tool: "write",
        input: { path: "Dockerfile", content: task === "alpine" ? ALPINE : "FROM debian:12\n" },
      },
    ][step] ?? { text: "done" };
  const relay = await runRelay(
    options(BFT_EDIT_ARM, fakeModel(script), { forwardOrder: ["alpine"] }),
  );
  const [fwd, back] = relay.interactions as [RelayInteraction, RelayInteraction];
  expect(fwd.nudges).toBe(1);
  expect(fwd.wrote).toBe(true);
  expect(fwd.metrics.steps).toBe(4);
  expect(back.score?.score).toBe(0.5);
  expect(back.seed).toMatchObject({ exact: false, linesRemoved: 1, lineDiff: 1 });
});

test("a missing target file scores 0 as a context mismatch", async () => {
  const script = (_task: string, step: number): Call =>
    [
      { tool: "delete_file", input: { filename: "Dockerfile" } },
      { tool: "write_file", input: { filename: "Other", content: "x" } },
      { tool: "finish", input: {} },
    ][step] ?? { text: "done" };
  const relay = await runRelay(
    options(D52_TOOLS_ARM, fakeModel(script), { forwardOrder: ["alpine"] }),
  );
  const [fwd, back] = relay.interactions as [RelayInteraction, RelayInteraction];
  expect(fwd.fileSet).toEqual({ ok: false, missing: ["Dockerfile"], extra: ["Other"] });
  expect(back.score).toMatchObject({ score: 0, error: "context_mismatch" });
});

test("a provider error stops the relay, and a second run resumes from the last snapshot", async () => {
  let calls = 0;
  const broken = new MockLanguageModelV4({
    doStream: async () => {
      calls++;
      throw new Error("upstream 503");
    },
  });
  // Interaction 1 succeeds with the good model, then the provider fails.
  const good = fakeModel(d52Script);
  let n = 0;
  const flaky = (): LanguageModel => (n++ === 0 ? good : broken);
  const first = await runRelay({ ...options(D52_TOOLS_ARM, good), modelFor: flaky, retries: 1 });
  expect(first.complete).toBe(false);
  expect(first.interactions).toHaveLength(1);
  expect(first.providerErrors).toBe(2);
  expect(first.errorAttemptMetrics).toHaveLength(2);
  expect(calls).toBeGreaterThan(0);

  const second = await runRelay(options(D52_TOOLS_ARM, good));
  expect(second.complete).toBe(true);
  expect(second.interactions).toHaveLength(4);
  expect(second.providerErrors).toBe(2);
  // The resumed backward step started from the saved forward snapshot.
  expect(second.interactions[1]!.score?.score).toBe(1);
});
