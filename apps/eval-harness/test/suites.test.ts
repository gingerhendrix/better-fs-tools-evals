import { describe, expect, test } from "bun:test";

import { SUITES } from "../src/suites.ts";

describe("friction-v1", () => {
  const suite = SUITES["friction-v1"]!;

  test("holds 20 friction tasks and 5 floor tasks, each once", () => {
    expect(suite).toHaveLength(25);
    expect(new Set(suite).size).toBe(25);
  });

  test("leaves out the broken fixture", () => {
    expect(suite).not.toContain("multi-composite-multi-edit-013");
  });
});
