/**
 * bun run eval d52 --data <delegate52.jsonl> --d52-repo <DELEGATE52 checkout> --out <dir>
 *   [--domains docker,json | --samples docker1,json1] [--arms d52-tools,bft-edit] [--models a,b]
 *   [--round-trips 5] [--seed 52] [--no-distractors] [--uv-env <dir>] [--concurrency 4]
 *   [--max-steps 25] [--max-total-tokens 500000] [--step-timeout 600] [--retries 2] [--keep-workspace]
 * bun run eval d52-report --out <dir>
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { collectRelays, interactionCostUsd, relayReport } from "@bfe/results";
import { runProvenance, runRelays } from "@bfe/runner";
import type { RelayOptions } from "@bfe/runner";
import {
  BRIDGE_DOMAINS,
  bridgeScorer,
  datasetSha256,
  DELEGATE52_SEED,
  forwardOrder,
  loadDelegate52,
} from "@bfe/source-delegate52";
import { findRelayArm } from "@bfe/tools";

const DEFAULT_MODELS = ["z-ai/glm-5.3-flash", "codex-oauth:gpt-6-luna:medium"];

export async function d52Command(argv: readonly string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      data: { type: "string", default: process.env.BFE_D52_DATA },
      "d52-repo": { type: "string", default: process.env.BFE_D52_REPO },
      "uv-env": { type: "string", default: process.env.BFE_D52_UV_ENV },
      out: { type: "string" },
      domains: { type: "string", default: BRIDGE_DOMAINS.join(",") },
      samples: { type: "string" },
      arms: { type: "string", default: "d52-tools,bft-edit" },
      models: { type: "string", default: DEFAULT_MODELS.join(",") },
      "round-trips": { type: "string", default: "5" },
      seed: { type: "string", default: String(DELEGATE52_SEED) },
      "no-distractors": { type: "boolean", default: false },
      concurrency: { type: "string", default: "4" },
      "max-steps": { type: "string", default: "25" },
      "max-total-tokens": { type: "string", default: "500000" },
      "step-timeout": { type: "string", default: "600" },
      retries: { type: "string", default: "2" },
      "keep-workspace": { type: "boolean", default: false },
    },
  });
  const outDir = required(values.out, "--out");
  if (positionals[0] === "d52-report") {
    const report = relayReport(await collectRelays(outDir));
    await writeFile(join(outDir, "report.md"), report);
    console.log(report);
    return;
  }

  const data = required(values.data, "--data (or BFE_D52_DATA)");
  const repo = required(values["d52-repo"], "--d52-repo (or BFE_D52_REPO)");
  const domains = values.domains!.split(",");
  const samples = await loadDelegate52(data, {
    domains,
    ...(values.samples === undefined ? {} : { samples: values.samples.split(",") }),
  });
  const unscorable = samples.filter((s) => !BRIDGE_DOMAINS.includes(s.domain));
  if (unscorable.length > 0)
    throw new Error(`the bridge cannot score: ${unscorable.map((s) => s.id).join(", ")}`);
  const arms = values.arms!.split(",").map(findRelayArm);
  const models = values.models!.split(",");
  const roundTrips = Number(values["round-trips"]);
  const seed = Number(values.seed);
  const distractors = !values["no-distractors"];
  const scorer = bridgeScorer({
    repo,
    ...(values["uv-env"] === undefined ? {} : { uvEnv: values["uv-env"] }),
  });

  const jobs: Omit<RelayOptions, "onInteraction">[] = [];
  for (const sample of samples) {
    const order = forwardOrder(sample, roundTrips, seed);
    for (const model of models) {
      for (const arm of arms) {
        jobs.push({
          outDir,
          sample,
          arm,
          model,
          forwardOrder: order,
          seed,
          distractors,
          scorer,
          maxSteps: Number(values["max-steps"]),
          stepTimeoutMs: Number(values["step-timeout"]) * 1000,
          maxTotalTokens: Number(values["max-total-tokens"]),
          retries: Number(values.retries),
          keepWorkspace: values["keep-workspace"]!,
        });
      }
    }
  }

  await mkdir(outDir, { recursive: true });
  const manifest = {
    created: new Date().toISOString(),
    benchmark: "delegate52",
    data,
    datasetSha256: await datasetSha256(data),
    upstreamRepo: repo,
    upstreamCommit: execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    samples: samples.map((s) => ({
      id: s.id,
      domain: s.domain,
      license: s.license,
      forwardOrder: forwardOrder(s, roundTrips, seed),
    })),
    models,
    arms: arms.map((a) => ({
      name: a.name,
      tools: a.toolNames,
      writeTools: a.writeTools,
      codeExecution: a.codeExecution,
      requireRead: a.requireRead,
    })),
    roundTrips,
    seed,
    distractors,
    loop: {
      maxSteps: Number(values["max-steps"]),
      maxTotalTokens: Number(values["max-total-tokens"]),
      stepTimeoutMs: Number(values["step-timeout"]) * 1000,
      retries: Number(values.retries),
      nudge: "once, when the model stops with no tool call before any write",
    },
    provenance: await runProvenance(arms, []),
  };
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${jobs.length} relays: ${samples.length} samples x ${models.length} models x ${arms.length} arms, ${roundTrips} round trips`,
  );

  const results = await runRelays(jobs, Number(values.concurrency), (job, i, saved) => {
    const score = i.score === null ? "" : ` score=${i.score.score ?? i.score.error}`;
    const usd = interactionCostUsd(job.model, i);
    console.log(
      `${job.model} ${job.arm.name} ${job.sample.id} i${i.index + 1} rt${i.roundTrip} ${i.direction} end=${i.end} steps=${i.metrics.steps} files=${i.files.join(",")}${score} in=${i.metrics.inputTokens} out=${i.metrics.outputTokens} usd=${usd?.toFixed(4) ?? "-"}${saved ? " (saved)" : ""}${i.loopError ? ` err=${i.loopError.slice(0, 160)}` : ""}`,
    );
  });
  const report = relayReport(await collectRelays(outDir));
  await writeFile(join(outDir, "report.md"), report);
  console.log(`\n${results.filter((r) => r.complete).length} of ${results.length} relays complete`);
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === "") throw new Error(`missing ${flag}`);
  return value;
}
