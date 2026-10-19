import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { taskVerifier, verifyExactWorkspace } from "../src/verify.ts";

let root: string;
let sequence = 0;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.BFT_EVAL_TEST_ROOT ?? tmpdir(), "ee-test-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function dirs() {
  const dir = join(root, String(sequence++));
  const expected = join(dir, "expected");
  const actual = join(dir, "actual");
  await mkdir(expected, { recursive: true });
  await mkdir(actual);
  return { expected, actual };
}

describe("exact verification", () => {
  for (const [kind, expected, actual, file] of [
    ["eof-only", "hello\n", "hello", "a.txt"],
    ["crlf-only", "hello\r\nworld\r\n", "hello\nworld\n", "a.txt"],
    ["nfc-only", "café\n", "cafe\u0301\n", "a.txt"],
    ["untouched-changed", "keep\n", "oops\n", "untouched.txt"],
    ["collapsed", "a\nb\nc\nd\ne\n", "PLACEHOLDER", "a.txt"],
    ["content", "abc\n", "def\n", "a.txt"],
  ] as const)
    test(kind, async () => {
      const d = await dirs();
      await writeFile(join(d.expected, file), expected);
      await writeFile(join(d.actual, file), actual);
      const result = await taskVerifier("exact")(d.expected, d.actual);
      expect(result.passed).toBe(false);
      expect(result.damage).toEqual([{ file, kind }]);
    });
  test("missing, extra, empty directories, symlinks, and all damaged files are recorded", async () => {
    const d = await dirs();
    await writeFile(join(d.expected, "missing.txt"), "expected");
    await writeFile(join(d.expected, "link.txt"), "expected");
    await writeFile(join(d.actual, "extra.txt"), "extra");
    await mkdir(join(d.actual, "extra-dir"));
    await symlink(join(d.expected, "link.txt"), join(d.actual, "link.txt"));
    const result = await verifyExactWorkspace(d.expected, d.actual);
    expect(result.passed).toBe(false);
    expect(result.damage).toEqual([
      { file: "extra-dir/", kind: "extra" },
      { file: "extra.txt", kind: "extra" },
      { file: "link.txt", kind: "missing" },
      { file: "link.txt", kind: "non-regular" },
      { file: "missing.txt", kind: "missing" },
    ]);
  });
  test("byte equality, including invalid UTF-8, is required", async () => {
    const d = await dirs();
    await writeFile(join(d.expected, "a.bin"), Buffer.from([255]));
    await cp(d.expected, d.actual, { recursive: true });
    expect((await verifyExactWorkspace(d.expected, d.actual)).passed).toBe(true);
    await writeFile(join(d.actual, "a.bin"), Buffer.from([254]));
    expect((await verifyExactWorkspace(d.expected, d.actual)).damage).toEqual([
      { file: "a.bin", kind: "content" },
    ]);
  });
});
