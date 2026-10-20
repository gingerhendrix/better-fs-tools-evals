import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptyMetrics } from "@bfe/core";
import { scanCatalog } from "../src/catalog.ts";
import { loadTrace } from "../src/trace.ts";

let root: string;
let job: string;

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

const trialResult = (task: string, rewards: Record<string, number> | null, exception?: string) => ({
  task_name: `harbor-index/${task}`,
  config: {
    task: { path: `/tasks/${task}` },
    agent: { name: "bft_agent:BftAgent", model_name: "codex-oauth:gpt-5.6-luna:medium" },
  },
  agent_info: { name: "bft-agent" },
  agent_result: { n_input_tokens: 500, n_cache_tokens: 0, n_output_tokens: 50 },
  verifier_result: rewards === null ? null : { rewards },
  exception_info:
    exception === undefined
      ? null
      : { exception_type: exception, exception_message: "took too long" },
  agent_execution: {
    started_at: "2026-10-14T01:42:23.000Z",
    finished_at: "2026-10-14T01:43:23.000Z",
  },
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "viewer-harbor-"));
  job = join(root, "harbor-run", "jobs", "luna-bash", "2026-10-14__02-42-22");
  await writeJson(join(job, "config.json"), {
    job_name: "2026-10-14__02-42-22",
    n_attempts: 2,
    agents: [{ name: "bft_agent:BftAgent", model_name: "codex-oauth:gpt-5.6-luna:medium" }],
  });
  await writeFile(join(job, "job.log"), "");
  await writeJson(join(job, "result.json"), { started_at: "2026-10-14T02:42:23.001187" });

  const pass = join(job, "gso-speedup__aaa");
  await writeJson(
    join(pass, "result.json"),
    trialResult("gso-speedup", { reward: 1, reward_pre_threshold: 0.97 }),
  );
  await writeJson(join(pass, "agent", "result.json"), {
    toolSet: "bash",
    end: "done",
    loopError: null,
    wallMs: 106413,
    metrics: { ...emptyMetrics(), steps: 21, toolCalls: { bash: 20 }, inputTokens: 160771 },
  });
  await writeFile(
    join(pass, "agent", "steps.jsonl"),
    `${JSON.stringify({ step: 0, content: [] })}\n`,
  );
  await mkdir(join(pass, "verifier"), { recursive: true });
  await writeFile(join(pass, "verifier", "patch.diff"), "--- a/x\n+++ b/x\n");

  const fail = join(job, "gso-speedup__bbb");
  await writeJson(
    join(fail, "result.json"),
    trialResult("gso-speedup", { reward: 0, reward_pre_threshold: 0.5, reward_threshold: 0.95 }),
  );

  const timeout = join(job, "swebench-fix__ccc");
  await writeJson(
    join(timeout, "result.json"),
    trialResult("swebench-fix", null, "AgentTimeoutError"),
  );
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("scanCatalog with a Harbor job folder", () => {
  test("finds the job below the root at depth 4", async () => {
    expect((await scanCatalog([root], 3)).batches).toEqual([]);
    const catalog = await scanCatalog([root], { maxDepth: 4 });
    expect(catalog.batches).toHaveLength(1);
    expect(catalog.batches[0]).toMatchObject({
      id: "harbor-run/jobs/luna-bash/2026-10-14__02-42-22",
      kind: "harbor",
      created: "2026-10-14T02:42:23.001187",
      fixtures: "/tasks",
      models: ["codex-oauth:gpt-5.6-luna:medium"],
      arms: ["bash", "bft-agent"],
      tasks: ["gso-speedup", "swebench-fix"],
      attempts: 2,
    });
  });

  test("makes one row per trial and numbers the attempts at each task", async () => {
    const catalog = await scanCatalog([root], { maxDepth: 4 });
    const [pass, fail, timeout] = catalog.runs;
    expect(pass).toMatchObject({
      task: "gso-speedup",
      attempt: 1,
      arm: "bash",
      passed: true,
      end: "done",
      score: 0.97,
      steps: 21,
      toolCalls: 20,
      wallMs: 106413,
    });
    expect(fail).toMatchObject({
      task: "gso-speedup",
      attempt: 2,
      arm: "bft-agent",
      passed: false,
      score: 0.5,
      verifyError: "reward 0.500 under threshold 0.950",
      inputTokens: 500,
      wallMs: 60000,
    });
    expect(timeout).toMatchObject({
      task: "swebench-fix",
      attempt: 1,
      end: "error",
      passed: false,
      verifyError: "AgentTimeoutError: took too long",
    });
  });

  test("leaves out a folder whose id holds an exclude string", async () => {
    const catalog = await scanCatalog([root], { maxDepth: 4, exclude: ["luna-bash"] });
    expect(catalog.batches).toEqual([]);
  });

  test("loads the trace from agent/ and the patch from verifier/", async () => {
    const catalog = await scanCatalog([root], { maxDepth: 4 });
    const source = catalog.runDirs.get(catalog.runs[0]!.id)!;
    const trace = await loadTrace(source.dir, source.kind);
    expect(trace.steps).toHaveLength(1);
    expect(trace.result).toMatchObject({ toolSet: "bash" });
    expect(trace.patch).toBe("--- a/x\n+++ b/x\n");
    expect(trace.files).toBeNull();
  });
});
