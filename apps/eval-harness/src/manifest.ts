import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import type { Arm } from "./arms.ts";
import type { EditTask } from "./tasks.ts";

const require = createRequire(import.meta.url);

/** These fields describe the code and fixture identity, not just the CLI names. */
export async function runProvenance(arms: readonly Arm[], tasks: readonly EditTask[]) {
  const harnessGitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("../../..", import.meta.url),
    encoding: "utf8",
  }).trim();
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const packageVersions: Record<string, string> = {};
  for (const name of Object.keys(pkg.dependencies)) {
    // All harness dependencies expose package.json. Fail if an identity cannot be recorded.
    packageVersions[name] = (require(`${name}/package.json`) as { version: string }).version;
  }
  return {
    harnessGitSha,
    packageVersions,
    upstreamBenchmarkCommits: [
      ...new Set(tasks.flatMap((t) => (t.upstreamCommit ? [t.upstreamCommit] : []))),
    ],
    fixtures: tasks.map((t) => ({
      id: t.id,
      verify: t.verify ?? "omp",
      fixtureSha256: t.fixtureSha256,
    })),
    armSettings: arms.map((a) => ({
      name: a.name,
      tools: a.toolNames,
      requireRead: a.requireRead,
      matchers: a.matchers,
      sandbox: a.toolNames.includes("bash") ? "bwrap" : null,
    })),
    cachePinning: {
      provider: "codex-oauth",
      scope: "run",
      body: "prompt_cache_key",
      header: "session-id",
    },
  };
}
