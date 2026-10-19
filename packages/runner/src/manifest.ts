import { execFileSync } from "node:child_process";

import { dependencyVersions } from "@bfe/core";
import type { EditTask } from "@bfe/core";
import { providerPackageVersions } from "@bfe/providers";
import { toolPackageVersions } from "@bfe/tools";
import type { Arm } from "@bfe/tools";

/** These fields describe the code and fixture identity, not just the CLI names. */
export async function runProvenance(arms: readonly Arm[], tasks: readonly EditTask[]) {
  // The evals repository root. Tool versions are in `packageVersions`.
  const harnessGitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("../../..", import.meta.url),
    encoding: "utf8",
  }).trim();
  // The runner, provider, and tool packages hold every npm package a run calls.
  // A lookup throws when a version is missing, so the manifest never records a guess.
  const packageVersions: Record<string, string> = {
    ...(await dependencyVersions(new URL("../package.json", import.meta.url))),
    ...(await providerPackageVersions()),
    ...(await toolPackageVersions()),
  };
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
