import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolSet } from "ai";

import { D52_FINISH_REFUSED } from "../../src/relay/d52-tools.ts";
import { BFT_EDIT_ARM, D52_TOOLS_ARM, findRelayArm } from "../../src/relay/relay-arms.ts";

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "relay-arms-"));
  await writeFile(join(cwd, "Dockerfile"), "FROM debian:12\n");
});
afterEach(() => rm(cwd, { recursive: true, force: true }));

const call = (tools: ToolSet, name: string, input: unknown) =>
  tools[name]!.execute!(input as never, { toolCallId: "t", messages: [], context: undefined });

test("d52-tools delete_file removes a file and reports a missing one as upstream does", async () => {
  const s = D52_TOOLS_ARM.session(cwd);
  expect(await call(s.tools, "delete_file", { filename: "Dockerfile" })).toBe("OK");
  expect(await Bun.file(join(cwd, "Dockerfile")).exists()).toBe(false);
  expect(await call(s.tools, "delete_file", { filename: "Dockerfile" })).toBe(
    "Error: file 'Dockerfile' not found.",
  );
  expect(await call(s.tools, "delete_file", { filename: "../escape" })).toBe(
    "Error: file '../escape' not found.",
  );
  expect(s.calls().map((c) => c.error)).toEqual([null, "not-found", "not-found"]);
  expect(s.wrote()).toBe(false);
});

test("bft-edit delete_file takes a path and has the same contract", async () => {
  const s = BFT_EDIT_ARM.session(cwd);
  expect(Object.keys(s.tools).sort()).toEqual(["delete_file", "edit", "read", "write"]);
  expect(await call(s.tools, "delete_file", { path: "Dockerfile" })).toBe("OK");
  expect(await call(s.tools, "delete_file", { path: "Dockerfile" })).toBe(
    "Error: file 'Dockerfile' not found.",
  );
});

test("d52-tools read_file and write_file return the upstream strings", async () => {
  const s = D52_TOOLS_ARM.session(cwd);
  expect(await call(s.tools, "read_file", { filename: "Dockerfile" })).toBe("FROM debian:12\n");
  expect(await call(s.tools, "read_file", { filename: "nope" })).toBe(
    "Error: file 'nope' not found. Available files: Dockerfile",
  );
  expect(await call(s.tools, "write_file", { filename: "sub/a.txt", content: "x" })).toBe("OK");
  expect(await readFile(join(cwd, "sub/a.txt"), "utf8")).toBe("x");
  expect(s.calls().map((c) => [c.tool, c.file])).toEqual([
    ["read_file", "Dockerfile"],
    ["read_file", "nope"],
    ["write_file", "sub/a.txt"],
  ]);
});

test("finish is refused until a write, then accepted", async () => {
  const s = D52_TOOLS_ARM.session(cwd);
  expect(await call(s.tools, "finish", {})).toBe(D52_FINISH_REFUSED);
  expect(s.finished()).toBe(false);
  await call(s.tools, "write_file", { filename: "Dockerfile", content: "FROM alpine\n" });
  expect(s.wrote()).toBe(true);
  expect(await call(s.tools, "finish", {})).toBe("DONE");
  expect(s.finished()).toBe(true);
});

test("bft-edit counts write as a write and has no finish tool", async () => {
  const s = BFT_EDIT_ARM.session(cwd);
  expect(s.tools.finish).toBeUndefined();
  await call(s.tools, "write", { path: "Dockerfile", content: "FROM alpine\n" });
  expect(s.wrote()).toBe(true);
  expect(await readFile(join(cwd, "Dockerfile"), "utf8")).toBe("FROM alpine\n");
});

test("prompts name the targets and the read tool", () => {
  expect(D52_TOOLS_ARM.system(["Dockerfile", "COMMENTS.md"])).toContain(
    "must contain exactly these files: Dockerfile, COMMENTS.md",
  );
  expect(D52_TOOLS_ARM.system([])).toContain("programmatically or directly");
  expect(BFT_EDIT_ARM.system(["Dockerfile"])).not.toContain("programmatically");
  expect(BFT_EDIT_ARM.user(["b", "a"], "Do it.")).toBe(
    "Your workspace contains the following files:\n  - a\n  - b\n\nUse read to inspect any files you need before editing.\n\nTASK:\nDo it.",
  );
  expect(() => findRelayArm("bft-write")).toThrow("d52-tools, bft-edit");
});

// Opt in: BFT_BWRAP_TESTS=1 needs Linux user namespaces and /usr/bin/bwrap.
test.skipIf(process.env.BFT_BWRAP_TESTS !== "1")(
  "run_python edits, creates, and deletes workspace files, with no network",
  async () => {
    const s = D52_TOOLS_ARM.session(cwd);
    await writeFile(join(cwd, "old.txt"), "old");
    const out = await call(s.tools, "run_python", {
      code: [
        "import os, socket",
        "p = './workspace/Dockerfile'",
        "text = open(p).read()",
        "open(p, 'w').write(text.replace('debian:12', 'alpine'))",
        "open('./workspace/new.txt', 'w').write('new')",
        "os.remove('./workspace/old.txt')",
        "try:",
        "    socket.create_connection(('1.1.1.1', 53), timeout=2); print('net')",
        "except OSError:",
        "    print('no-net')",
      ].join("\n"),
    });
    expect(out).toBe("no-net\n");
    expect(await readFile(join(cwd, "Dockerfile"), "utf8")).toBe("FROM alpine\n");
    expect(await readFile(join(cwd, "new.txt"), "utf8")).toBe("new");
    expect(await Bun.file(join(cwd, "old.txt")).exists()).toBe(false);
    expect(s.wrote()).toBe(true);
    const failed = await call(s.tools, "run_python", { code: "raise SystemExit(3)" });
    expect(failed).toEndWith("\n(exit code 3)");
    expect(s.calls().at(-1)?.error).toBe("exit");
  },
  60_000,
);
