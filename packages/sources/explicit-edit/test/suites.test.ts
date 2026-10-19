import { expect, test } from "bun:test";

import { EXPLICIT_EDIT_SUITES as SUITES } from "../src/suites.ts";

test("suites", () => {
  expect(SUITES["ee-smoke"]).toHaveLength(4);
  expect(SUITES["ee-hard-40"]).toHaveLength(40);
  expect(new Set(SUITES["ee-hard-40"]).size).toBe(40);
  for (const id of SUITES["ee-smoke"]!) expect(SUITES["ee-hard-40"]).toContain(id);
});
