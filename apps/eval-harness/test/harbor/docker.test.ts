import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { runFileSystemConformance, runWritableFileSystemConformance } from "@better-fs-tools/fs";
import { createBashTool, shellEnv } from "@better-fs-tools/shell";

import { dockerExec } from "../../src/harbor/docker-exec.ts";
import type { Container } from "../../src/harbor/docker-exec.ts";
import { dockerFileSystem, parseProbe } from "../../src/harbor/docker-fs.ts";
import { dockerCommandRunner } from "../../src/harbor/docker-runner.ts";

describe("parseProbe", () => {
  test("reads an existing file record", () => {
    const parsed = parseProbe("E\tfile\t12\t1700000000\t42\t644\t1\tabc\n/app/a.txt\n");
    expect(parsed).toEqual({
      probe: {
        exists: true,
        kind: "file",
        realPath: "/app/a.txt",
        size: 12,
        mtimeMs: 1_700_000_000_000,
        inode: "42",
        mode: 0o644,
        links: 1,
        version: "12:abc",
      },
    });
  });

  test("lists missing parents outermost first", () => {
    const parsed = parseProbe("M\t/app/x/y/z.txt\nD\t/app/x/y\nD\t/app/x\n");
    expect(parsed).toEqual({
      probe: {
        exists: false,
        realPath: "/app/x/y/z.txt",
        missingDirectories: ["/app/x", "/app/x/y"],
        blockedBy: null,
      },
    });
  });
});

// Opt in: BFT_DOCKER_TESTS=1 starts a python:3.11-slim container.
const live = process.env.BFT_DOCKER_TESTS === "1";
const IMAGE = process.env.BFT_DOCKER_IMAGE ?? "python:3.11-slim";

describe.skipIf(!live)("docker backend against a live container", () => {
  let box: Container;

  beforeAll(async () => {
    const proc = Bun.spawnSync(["docker", "run", "-d", "--rm", IMAGE, "sleep", "600"]);
    box = { id: new TextDecoder().decode(proc.stdout).trim(), user: null };
    await dockerExec(box, [
      "sh",
      "-c",
      "mkdir -p /work/dir /work/scratch && printf 'hello\\n' > /work/a.txt",
    ]);
  }, 120_000);

  afterAll(() => {
    if (box !== undefined) Bun.spawnSync(["docker", "rm", "-f", box.id]);
  });

  test("keeps the read contract", async () => {
    const fs = dockerFileSystem({ container: box, cwd: "/work" });
    const report = await runFileSystemConformance(fs, {
      existingFile: { path: "a.txt", bytes: new TextEncoder().encode("hello\n") },
      missingPath: "missing.txt",
      directoryPath: "dir",
      refusedPath: "/proc/self/status",
      listDirectory: ".",
      mutate: async () => {
        await dockerExec(box, ["sh", "-c", "printf 'changed\\n' > /work/a.txt"]);
      },
    });
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
  }, 60_000);

  test("keeps the write contract", async () => {
    const fs = dockerFileSystem({ container: box, cwd: "/work" });
    const report = await runWritableFileSystemConformance(fs, {
      scratchDirectory: "scratch",
      directoryPath: "dir",
      refusedPath: "/proc/x",
    });
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
  }, 60_000);

  test("bash runs in the container cwd and stops on timeout", async () => {
    const bash = createBashTool({ runner: dockerCommandRunner(box, "/work"), env: shellEnv() });
    const ok = await bash({ command: "pwd; echo $NO_COLOR; cat a.txt" });
    expect(ok.status).toBe("ok");
    expect(ok.status !== "error" && ok.output.head).toContain("/work");
    const failed = await bash({ command: "exit 3" });
    expect(failed.status).toBe("failed");
    const started = Date.now();
    const slow = await bash({ command: "sleep 30", timeoutMs: 1000 });
    expect(slow.status).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(10_000);
    await Bun.sleep(500);
    const left = await dockerExec(box, [
      "sh",
      "-c",
      "for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null; echo; done | grep -c '^sleep 30'",
    ]);
    expect(new TextDecoder().decode(left.stdout).trim()).toBe("0");
  }, 60_000);
});
