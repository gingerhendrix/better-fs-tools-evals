import { expect, test } from "bun:test";

import type { RelayInteraction, RelayResult } from "@bfe/core";
import { emptyMetrics } from "@bfe/core";

import { criticalErrors, relayReport, relayScores } from "../src/relay-report.ts";

function step(index: number, score: number | null): RelayInteraction {
  const backward = index % 2 === 1;
  return {
    index,
    roundTrip: Math.floor(index / 2) + 1,
    direction: backward ? "backward" : "forward",
    fromState: "a",
    targetState: "b",
    prompt: "p",
    end: "done",
    loopError: null,
    finished: true,
    budgetHit: false,
    nudges: 0,
    wrote: true,
    toolSequence: ["read_file", "write_file", "finish"],
    filesRead: ["Dockerfile"],
    distractorReads: 0,
    files: ["Dockerfile"],
    strippedDistractors: [],
    fileSet: { ok: true, missing: [], extra: [] },
    score: backward ? { score, error: null, details: {} } : null,
    seed: backward
      ? {
          exact: score === 1,
          exactFiles: [],
          lineDiff: 2,
          linesAdded: 1,
          linesRemoved: 1,
          lineBloat: 0,
          charBloat: 0,
        }
      : null,
    providerHttpErrors: 0,
    wallMs: 1,
    metrics: {
      ...emptyMetrics(),
      steps: 3,
      toolCalls: { read_file: 1, write_file: 1 },
      inputTokens: 1000,
      outputTokens: 100,
    },
  };
}

const relay = (arm: string, scores: (number | null)[]): RelayResult => ({
  schema: "relay/1",
  sample: "docker1",
  domain: "docker",
  arm,
  model: "z-ai/glm-5.3-flash",
  roundTrips: scores.length,
  seed: 52,
  distractors: true,
  forwardOrder: scores.map(() => "x"),
  complete: true,
  providerErrors: 0,
  errorAttemptMetrics: [],
  interactions: scores.flatMap((s, i) => [step(2 * i, null), step(2 * i + 1, s)]),
});

test("critical errors count round trips that drop 10 points or more, starting from 1", () => {
  const r = relay("d52-tools", [0.95, 0.85, 0.84, null, 0.5]);
  expect(relayScores(r)).toEqual([0.95, 0.85, 0.84, null, 0.5]);
  expect(criticalErrors(r)).toBe(2);
  expect(criticalErrors(relay("d52-tools", [0.9]))).toBe(1);
});

test("the report has RS@k columns, the paired difference, and card-rate cost", () => {
  const md = relayReport([relay("d52-tools", [1, 0.8]), relay("bft-edit", [1, 0.9])]);
  expect(md).toContain("| RS@2 | RS@4 |");
  expect(md).toContain("| z-ai/glm-5.3-flash | docker | bft-edit | 1 | 100.0 | 90.0 | 1 | 0 |");
  expect(md).toContain("| z-ai/glm-5.3-flash | docker1 | 80.0 | 90.0 | 10.0 |");
  expect(md).toContain("read_file 4, write_file 4");
  expect(md).toMatch(/\| 0\.0008 \|/);
});
