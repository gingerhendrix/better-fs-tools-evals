import { expect, test } from "bun:test";

import { checkFileSet, compareWithSeed, lineDiff } from "../src/relay-measures.ts";

test("checkFileSet follows upstream: globs need a match, and extras fail only with a glob", () => {
  expect(checkFileSet(["Dockerfile", "x"], ["Dockerfile"])).toEqual({
    ok: true,
    missing: [],
    extra: ["x"],
  });
  expect(checkFileSet(["Dockerfile.api", "Dockerfile.web"], ["Dockerfile.*"]).ok).toBe(true);
  expect(checkFileSet(["Dockerfile"], ["Dockerfile.*"])).toMatchObject({
    ok: false,
    missing: ["Dockerfile.*"],
  });
  expect(checkFileSet(["Dockerfile.a", "README"], ["Dockerfile.*"])).toMatchObject({
    ok: false,
    extra: ["README"],
  });
});

test("lineDiff counts added and removed lines", () => {
  expect(lineDiff("a\nb\nc\n", "a\nc\n")).toEqual({ added: 0, removed: 1 });
  expect(lineDiff("a\nb\n", "a\nB\nb\n")).toEqual({ added: 1, removed: 0 });
  expect(lineDiff("", "a")).toEqual({ added: 1, removed: 0 });
});

test("compareWithSeed counts a missing seed file as removed lines and an extra file as added", () => {
  const seed = { a: "1\n2\n" };
  expect(compareWithSeed(seed, { a: "1\n2\n" })).toMatchObject({ exact: true, lineDiff: 0 });
  const moved = compareWithSeed(seed, { b: "1\n2\n" });
  expect(moved).toMatchObject({ exact: false, exactFiles: [], linesAdded: 3, linesRemoved: 3 });
  expect(moved.lineBloat).toBe(0);
  expect(compareWithSeed(seed, { a: "1\n2\n", c: "x" }).exact).toBe(false);
  expect(compareWithSeed(seed, { a: "1\n" }).lineBloat).toBe(-50);
});
