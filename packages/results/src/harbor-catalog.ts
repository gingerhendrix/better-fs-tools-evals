import { basename, dirname, join } from "node:path";

import type { RunMetrics } from "@bfe/core";

import { isRecord, num, readJson, str, subdirs, sum } from "./fs-json.ts";
import { runCostUsd } from "./pricing.ts";
import type { Batch, BatchRead, RunRow, RunSource } from "./catalog.ts";

type Json = Record<string, unknown>;

/**
 * Reads a Harbor job folder. Each trial folder is one run row. The Better FS Tools
 * Harbor agent writes the harness trace files to `<trial>/agent/`.
 */
export async function readHarborJob(dir: string, id: string): Promise<BatchRead | null> {
  const config = await readJson<Json>(join(dir, "config.json"));
  if (config === null) return null;
  const job = await readJson<Json>(join(dir, "result.json"));

  const trials: Array<{ name: string; result: Json | null; agent: Json | null }> = [];
  for (const name of await subdirs(dir)) {
    const result = await readJson<Json>(join(dir, name, "result.json"));
    const trialConfig = await readJson<Json>(join(dir, name, "config.json"));
    if (result === null && trialConfig === null) continue;
    trials.push({
      name,
      result,
      agent: await readJson<Json>(join(dir, name, "agent", "result.json")),
    });
  }

  const rows: Array<[RunSource, RunRow]> = [];
  const attempts = new Map<string, number>();
  const fixtures = new Set<string>();
  for (const trial of trials) {
    const task = taskName(trial.name, trial.result);
    const attempt = (attempts.get(task) ?? 0) + 1;
    attempts.set(task, attempt);
    const taskDir = taskPath(trial.result);
    if (taskDir !== null) fixtures.add(dirname(taskDir));
    rows.push([
      { kind: "harbor", dir: join(dir, trial.name) },
      toHarborRow(`${id}/${trial.name}`, id, { ...trial, task, attempt, config }),
    ]);
  }

  const fixtureSet = fixtures.size === 1 ? [...fixtures][0]! : null;
  const batch: Batch = {
    id,
    kind: "harbor",
    dir,
    created: str(job?.started_at),
    fixtures: fixtureSet,
    models: [...new Set(rows.map(([, r]) => r.model))].sort(),
    arms: [...new Set(rows.map(([, r]) => r.arm))].sort(),
    tasks: [...attempts.keys()].sort(),
    attempts: num(config.n_attempts),
    maxSteps: null,
    earlyStop: null,
  };
  return { batch, runs: rows.map(([source, row]) => [source, { ...row, fixtures: fixtureSet }]) };
}

function toHarborRow(
  id: string,
  batch: string,
  trial: {
    name: string;
    result: Json | null;
    agent: Json | null;
    task: string;
    attempt: number;
    config: Json;
  },
): RunRow {
  const { result, agent } = trial;
  const model = modelName(result, trial.config);
  const arm = armName(result, agent, trial.config);
  const rewards = rewardsOf(result);
  const reward = num(rewards?.reward);
  const exception = isRecord(result?.exception_info) ? result.exception_info : null;
  const exceptionType = str(exception?.exception_type);
  const metrics = metricsOf(result, agent);
  const toolErrorCodes = metrics?.toolErrors ?? {};
  const end =
    result === null
      ? "incomplete"
      : rewards === null
        ? "error"
        : exceptionType === "AgentTimeoutError"
          ? "timeout"
          : (str(agent?.end) ?? "done");
  return {
    id,
    kind: "harbor",
    batch,
    fixtures: null,
    model,
    arm,
    task: trial.task,
    attempt: trial.attempt,
    flawed: false,
    passed: result === null ? null : reward !== null && reward >= 1,
    end,
    score: num(rewards?.reward_pre_threshold) ?? reward,
    step: trial.name,
    linesChanged: null,
    verifyError: verifyText(exceptionType, exception, rewards),
    loopError: str(agent?.loopError),
    difficulty: null,
    mutationType: null,
    steps: metrics?.steps ?? 0,
    toolCalls: sum(metrics?.toolCalls ?? {}),
    toolErrors: sum(toolErrorCodes),
    toolErrorCodes,
    inputTokens: metrics?.inputTokens ?? 0,
    outputTokens: metrics?.outputTokens ?? 0,
    reasoningTokens: metrics?.reasoningTokens ?? 0,
    wallMs: num(agent?.wallMs) ?? phaseMs(result, "agent_execution"),
    costUsd: metrics === null ? null : runCostUsd(model, metrics),
  };
}

function taskName(trial: string, result: Json | null): string {
  const name = str(result?.task_name);
  if (name !== null) return name.slice(name.lastIndexOf("/") + 1);
  return trial.replace(/__[^_]+$/, "");
}

function taskPath(result: Json | null): string | null {
  const config = isRecord(result?.config) ? result.config : null;
  const task = isRecord(config?.task) ? config.task : null;
  return str(task?.path);
}

function modelName(result: Json | null, config: Json): string {
  const trialConfig = isRecord(result?.config) ? result.config : null;
  const agent = isRecord(trialConfig?.agent) ? trialConfig.agent : null;
  const first =
    Array.isArray(config.agents) && isRecord(config.agents[0]) ? config.agents[0] : null;
  return str(agent?.model_name) ?? str(first?.model_name) ?? "?";
}

/** The Better FS Tools agent records its tool set. Other agents fall back to their Harbor name. */
function armName(result: Json | null, agent: Json | null, config: Json): string {
  const info = isRecord(result?.agent_info) ? result.agent_info : null;
  const first =
    Array.isArray(config.agents) && isRecord(config.agents[0]) ? config.agents[0] : null;
  return (
    str(agent?.toolSet) ??
    str(info?.name) ??
    str(first?.name) ??
    basename(String(config.job_name ?? "?"))
  );
}

function rewardsOf(result: Json | null): Json | null {
  const verifier = isRecord(result?.verifier_result) ? result.verifier_result : null;
  return isRecord(verifier?.rewards) ? verifier.rewards : null;
}

function metricsOf(result: Json | null, agent: Json | null): RunMetrics | null {
  if (isRecord(agent?.metrics)) return agent.metrics as unknown as RunMetrics;
  const usage = isRecord(result?.agent_result) ? result.agent_result : null;
  if (usage === null) return null;
  return {
    steps: 0,
    toolCalls: {},
    toolErrors: {},
    notes: {},
    inputTokens: num(usage.n_input_tokens) ?? 0,
    cachedInputTokens: num(usage.n_cache_tokens) ?? 0,
    outputTokens: num(usage.n_output_tokens) ?? 0,
    reasoningTokens: 0,
    toolInputChars: 0,
  };
}

function verifyText(
  type: string | null,
  exception: Json | null,
  rewards: Json | null,
): string | null {
  if (type !== null) return `${type}: ${String(exception?.exception_message ?? "").slice(0, 300)}`;
  const reward = num(rewards?.reward);
  const before = num(rewards?.reward_pre_threshold);
  const threshold = num(rewards?.reward_threshold);
  if (reward === null || reward >= 1) return null;
  return before !== null && threshold !== null
    ? `reward ${before.toFixed(3)} under threshold ${threshold.toFixed(3)}`
    : `reward ${reward}`;
}

function phaseMs(result: Json | null, phase: string): number | null {
  const times = isRecord(result?.[phase]) ? (result[phase] as Json) : null;
  const start = str(times?.started_at);
  const end = str(times?.finished_at);
  if (start === null || end === null) return null;
  return Date.parse(end) - Date.parse(start);
}
