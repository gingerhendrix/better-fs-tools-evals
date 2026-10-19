#!/usr/bin/env bun
/**
 * Runs one Harbor task with a Better FS Tools tool set, all acting inside the
 * task container. The default set is the bundle defaults (read, edit, write)
 * plus bash; `--tools` picks another set from `HARBOR_TOOL_SETS`. The Harbor agent
 * in `python/bft_agent.py` starts this script after Harbor starts the
 * container, and Harbor runs the verifier after it exits.
 *
 * bun run src/agent.ts --container <id> --workdir <dir> --instruction <file> --out <dir>
 *   [--model deepseek/deepseek-v4.1-flash] [--max-steps 300] [--step-timeout 600] [--user <user>] [--tools default]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { evalModel } from "@bfe/providers";
import { runCostUsd } from "@bfe/results";
import { runLoop } from "@bfe/runner";

import { harborSystemPrompt, harborTools, parseHarborToolSet } from "./bundle.ts";
import type { Container } from "./docker-exec.ts";

const { values } = parseArgs({
  options: {
    container: { type: "string" },
    workdir: { type: "string" },
    instruction: { type: "string" },
    out: { type: "string" },
    model: { type: "string", default: "deepseek/deepseek-v4.1-flash" },
    "max-steps": { type: "string", default: "300" },
    "step-timeout": { type: "string", default: "600" },
    user: { type: "string" },
    tools: { type: "string", default: "default" },
  },
});

const container: Container = {
  id: required(values.container, "--container"),
  user: values.user ?? null,
};
const workdir = required(values.workdir, "--workdir");
const outDir = required(values.out, "--out");
const toolSet = parseHarborToolSet(values.tools);
const tools = harborTools(container, workdir, toolSet);
const instruction = await readFile(required(values.instruction, "--instruction"), "utf8");

const started = Date.now();
const loop = await runLoop({
  model: evalModel(values.model, join(outDir, "http.jsonl")),
  system: harborSystemPrompt(workdir, toolSet),
  prompt: instruction,
  tools,
  maxSteps: Number(values["max-steps"]),
  stepTimeoutMs: Number(values["step-timeout"]) * 1000,
  stepLog: join(outDir, "steps.jsonl"),
});

const result = {
  model: values.model,
  toolSet,
  tools: Object.keys(tools),
  workdir,
  end: loop.end,
  loopError: loop.error,
  wallMs: Date.now() - started,
  costUsd: runCostUsd(values.model, loop.metrics),
  metrics: loop.metrics,
  finalText: loop.finalText,
};
await writeFile(join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({ end: result.end, steps: loop.metrics.steps, costUsd: result.costUsd }),
);

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === "") throw new Error(`${flag} is required`);
  return value;
}
