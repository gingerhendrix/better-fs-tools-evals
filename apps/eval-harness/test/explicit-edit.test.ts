import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolSet, ToolExecutionOptions } from "ai";
import { ARMS, findArm } from "../src/arms.ts";
import { runProvenance } from "../src/manifest.ts";
import { emptyMetrics, instrumentWrites } from "../src/metrics.ts";
import { explicitEditSystemPrompt } from "../src/prompts.ts";
import { markdownReport, summarise } from "../src/report.ts";
import type { CellResult } from "../src/run.ts";
import { SUITES } from "../src/suites.ts";
import { loadTask } from "../src/tasks.ts";
import { taskVerifier, verifyExactWorkspace } from "../src/verify.ts";

let root: string;
let sequence = 0;
const execution = { toolCallId: "offline", messages: [], context: undefined };
function invoke(tool: ToolSet[string], input: unknown): Promise<unknown> {
  return (
    tool as { execute(input: unknown, options: ToolExecutionOptions<unknown>): Promise<unknown> }
  ).execute(input, execution);
}
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

describe("arms", () => {
  const names = {
    edit: ["read", "edit", "write"],
    patch: ["read", "apply_patch"],
    "edit-plain": ["read", "edit", "write"],
    "bash-read-edit": ["bash", "read", "edit", "write"],
    "edit-exact": ["read", "edit", "write"],
    bash: ["bash"],
  };
  test("only the six approved arms are listed", () =>
    expect(ARMS.map((a) => a.name)).toEqual(Object.keys(names)));
  for (const [name, tools] of Object.entries(names))
    test(`${name} tools and no required read`, async () => {
      const d = await dirs();
      const arm = findArm(name);
      const built = arm.tools(d.actual);
      expect(Object.keys(built)).toEqual(tools);
      if (name === "bash") expect(built.bash!.description).not.toContain("Prefer the read");
      expect(arm.requireRead).toBe("off");
      for (const tool of tools.filter((t) => ["edit", "write", "apply_patch"].includes(t))) {
        await writeFile(join(d.actual, "a.txt"), "hello\n");
        // A new tool set ensures that no state was inherited from another mutation.
        const mutation = arm.tools(d.actual)[tool]!;
        const input =
          tool === "edit"
            ? { path: "a.txt", old_string: "hello", new_string: "world", replace_all: null }
            : tool === "write"
              ? { path: "a.txt", content: "world\n" }
              : {
                  patch:
                    "*** Begin Patch\n*** Update File: a.txt\n@@\n-hello\n+world\n*** End Patch",
                };
        const result = (await invoke(mutation, input)) as { status: string };
        expect(result.status).toBe("ok");
        expect(await readFile(join(d.actual, "a.txt"), "utf8")).toBe("world\n");
      }
    });
  test("exact arm rejects a normalized-only match", async () => {
    const d = await dirs();
    await writeFile(join(d.actual, "a.txt"), "A\u00a0B\n");
    const tool = findArm("edit-exact").tools(d.actual).edit!;
    const result = (await invoke(tool, {
      path: "a.txt",
      old_string: "A B",
      new_string: "changed",
      replace_all: null,
    })) as { error: { code: string } };
    expect(result.error.code).toBe("NO_MATCH");
  });
  test("short write counter observes the existing byte size before every call", async () => {
    const d = await dirs();
    const counts = { shortWriteCalls: 0 };
    await writeFile(join(d.actual, "a.txt"), "é".repeat(100));
    const tools = instrumentWrites(findArm("edit").tools(d.actual), d.actual, counts);
    await invoke(tools.write!, { path: "a.txt", content: "x".repeat(99) });
    await invoke(tools.write!, { path: "a.txt", content: "x".repeat(50) });
    expect(counts.shortWriteCalls).toBe(1);
  });
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
    new URL("../../../scripts/export-explicit-edit.ts", import.meta.url).pathname,
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
  const task = await loadTask(out, "task-0");
  const meta = await runProvenance([findArm("edit"), findArm("patch")], [task]);
  expect(meta.armSettings[0]).toMatchObject({
    tools: ["read", "edit", "write"],
    requireRead: "off",
    matchers: ["exact", "normalized"],
  });
  expect(meta.upstreamBenchmarkCommits).toEqual([task.upstreamCommit!]);
  expect(meta.packageVersions.ai).toBeTruthy();
});

test("suites and neutral prompt", () => {
  expect(SUITES["ee-smoke"]).toHaveLength(4);
  expect(SUITES["ee-hard-40"]).toHaveLength(40);
  expect(new Set(SUITES["ee-hard-40"]).size).toBe(40);
  for (const id of SUITES["ee-smoke"]!) expect(SUITES["ee-hard-40"]).toContain(id);
  const prompt = explicitEditSystemPrompt(findArm("patch").toolNames, ["cases/a.ts", "sample.txt"]);
  expect(prompt).toContain("read, apply_patch");
  expect(prompt).toContain("- cases/a.ts\n- sample.txt");
  expect(prompt).toContain("no tool call");
  expect(prompt).not.toContain("comments");
});

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
