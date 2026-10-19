import { expect, test } from "bun:test";

import { findArm } from "@bfe/tools";

import { explicitEditSystemPrompt } from "../src/prompts.ts";

test("neutral Explicit Edit prompt", () => {
  const prompt = explicitEditSystemPrompt(findArm("patch").toolNames, ["cases/a.ts", "sample.txt"]);
  expect(prompt).toContain("read, apply_patch");
  expect(prompt).toContain("- cases/a.ts\n- sample.txt");
  expect(prompt).toContain("no tool call");
  expect(prompt).not.toContain("comments");
});
