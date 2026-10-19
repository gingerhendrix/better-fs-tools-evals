import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadTask } from "@bfe/core";
import { verifyExactWorkspace } from "@bfe/scorer-files";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.BFT_EVAL_TEST_ROOT ?? tmpdir(), "ee-test-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("exporter round trip preserves three byte traps and prompt identity", async () => {
  const clone = join(root, "clone");
  const source = join(clone, "src/suites/explicit-edit");
  await mkdir(source, { recursive: true });
  execFileSync("git", ["init", clone]);
  execFileSync("git", [
    "-C",
    clone,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  const tasks = ["CRLF\r\n", "tabs\there\n", "no final newline"].map((content, index) => ({
    id: `task-${index}`,
    category: "literal",
    scale: 1,
    variant: "plain",
    fixtureSha256: "fixture-hash",
    prompt: " Exact task prompt. \n",
    input: { "a.txt": `old ${content}`, "untouched.txt": "keep\n" },
    expected: { "a.txt": content, "untouched.txt": "keep\n" },
  }));
  await writeFile(
    join(source, "fixtures.ts"),
    `export function explicitEditTasks() { return ${JSON.stringify(tasks)}; }`,
  );
  const out = join(root, "exported");
  const result = Bun.spawnSync([
    "bun",
    "run",
    new URL("../src/export.ts", import.meta.url).pathname,
    "--clone",
    clone,
    "--out",
    out,
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Exported 3 tasks");
  for (const original of tasks) {
    const task = await loadTask(out, original.id);
    expect(task.prompt).toBe(original.prompt);
    expect(task.verify).toBe("exact");
    expect(task.fixtureSha256).toBe("fixture-hash");
    expect(task.upstreamCommit).toHaveLength(40);
    expect(task.files).toContain("untouched.txt");
    expect((await verifyExactWorkspace(task.expectedDir, task.inputDir)).passed).toBe(false);
    expect(await readFile(join(task.expectedDir, "a.txt"))).toEqual(
      Buffer.from(original.expected["a.txt"]),
    );
  }
});
