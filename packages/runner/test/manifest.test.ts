import { expect, test } from "bun:test";

import type { EditTask } from "@bfe/core";
import { findArm } from "@bfe/tools";

import { runProvenance } from "../src/manifest.ts";

const task: EditTask = {
  id: "task-0",
  verify: "exact",
  upstreamCommit: "a".repeat(40),
  fixtureSha256: "fixture-hash",
  prompt: " Exact task prompt. \n",
  inputDir: "/fixtures/task-0/input",
  expectedDir: "/fixtures/task-0/expected",
  files: ["a.txt", "untouched.txt"],
  difficulty: null,
  mutationType: null,
  fileLines: null,
};

test("provenance records arm settings, upstream commits, and package versions", async () => {
  const meta = await runProvenance([findArm("edit"), findArm("patch")], [task]);
  expect(meta.armSettings[0]).toMatchObject({
    tools: ["read", "edit", "write"],
    requireRead: "off",
    matchers: ["exact", "normalized"],
  });
  expect(meta.upstreamBenchmarkCommits).toEqual([task.upstreamCommit!]);
  expect(meta.packageVersions.ai).toBeTruthy();
});

test("provenance records the published tool versions and the evals repository commit", async () => {
  const meta = await runProvenance([findArm("edit")], [task]);
  for (const name of ["ai-sdk", "node", "read", "shell", "write"]) {
    expect(meta.packageVersions[`@better-fs-tools/${name}`]).toMatch(/^\d+\.\d+\.\d+/);
  }
  expect(Object.keys(meta.packageVersions).some((name) => name.startsWith("@bfe/"))).toBe(false);
  expect(meta.harnessGitSha).toMatch(/^[0-9a-f]{40}$/);
});
