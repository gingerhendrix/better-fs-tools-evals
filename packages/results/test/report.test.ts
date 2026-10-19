import { expect, test } from "bun:test";

import { emptyMetrics } from "@bfe/core";
import type { CellResult } from "@bfe/core";

import { markdownReport, summarise } from "../src/report.ts";

test("reports aggregate damage, unknown tools, mix, and tolerate old results", () => {
  const old: CellResult = {
    model: "test",
    arm: "edit",
    task: "task",
    attempt: 1,
    difficulty: null,
    mutationType: null,
    passed: false,
    verifyError: "mismatch",
    linesChanged: 1,
    end: "done",
    loopError: null,
    providerHttpErrors: 0,
    wallMs: 10,
    metrics: emptyMetrics(),
  };
  const current = {
    ...old,
    metrics: {
      ...emptyMetrics(),
      toolCalls: { edit: 2, write: 1 },
      toolErrors: { "bash:unknown-tool": 1 },
      shortWriteCalls: 1,
    },
    damage: [{ file: "a", kind: "collapsed" as const }],
  };
  const summary = summarise([old, current])[0]!;
  expect(summary.damageKinds).toEqual({ collapsed: 1 });
  expect(summary.unknownToolCalls).toBe(1);
  expect(summary.shortWritesPerRun).toBe(0.5);
  expect(summary.toolMixPerRun).toMatchObject({ edit: 1, write: 0.5 });
  expect(markdownReport([old, current])).toContain("collapsed: 1");
});
