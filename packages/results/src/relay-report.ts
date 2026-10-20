import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { modelDirName } from "@bfe/core";
import type { RelayInteraction, RelayResult } from "@bfe/core";

import { runCostUsd } from "./pricing.ts";

/** A score drop of this much or more in one round trip is a critical error, as in the paper. */
export const CRITICAL_DROP = 0.1;

/**
 * Reads every `relays/<model>/<arm>/<sample>/relay.json` under a run folder.
 * A relay with no `relay.json` (its run was stopped) is rebuilt from its saved
 * interactions and the run manifest, and marked incomplete.
 */
export async function collectRelays(outDir: string): Promise<RelayResult[]> {
  const out: RelayResult[] = [];
  const root = join(outDir, "relays");
  const manifest = await readJsonFile<Manifest>(join(outDir, "manifest.json"));
  for (const model of await dirs(root)) {
    for (const arm of await dirs(join(root, model))) {
      for (const sample of await dirs(join(root, model, arm))) {
        const dir = join(root, model, arm, sample);
        const relay =
          (await readJsonFile<RelayResult>(join(dir, "relay.json"))) ??
          (manifest === null ? null : await partialRelay(dir, manifest, model, arm, sample));
        if (relay !== null) out.push(relay);
      }
    }
  }
  return out.sort((a, b) =>
    `${a.model}/${a.arm}/${a.sample}`.localeCompare(`${b.model}/${b.arm}/${b.sample}`),
  );
}

/** The fields of the `d52` manifest that a partial relay needs. */
interface Manifest {
  readonly models: readonly string[];
  readonly roundTrips: number;
  readonly seed: number;
  readonly distractors: boolean;
  readonly samples: readonly {
    readonly id: string;
    readonly domain: string;
    readonly forwardOrder: readonly string[];
  }[];
}

async function partialRelay(
  dir: string,
  manifest: Manifest,
  modelDir: string,
  arm: string,
  sampleId: string,
): Promise<RelayResult | null> {
  const sample = manifest.samples.find((s) => s.id === sampleId);
  const model = manifest.models.find((m) => modelDirName(m) === modelDir);
  if (sample === undefined || model === undefined) return null;
  const interactions: RelayInteraction[] = [];
  const errorAttemptMetrics: RelayInteraction["metrics"][] = [];
  for (const step of (await dirs(dir)).sort()) {
    const names = (await readdir(join(dir, step))).sort();
    for (const name of names.filter((n) => /^error-\d+\.json$/.test(n))) {
      const failed = await readJsonFile<RelayInteraction>(join(dir, step, name));
      if (failed !== null) errorAttemptMetrics.push(failed.metrics);
    }
    const saved = await readJsonFile<RelayInteraction>(join(dir, step, "interaction.json"));
    if (saved !== null && saved.end !== "error") interactions.push(saved);
  }
  return {
    schema: "relay/1",
    sample: sampleId,
    domain: sample.domain,
    arm,
    model,
    roundTrips: manifest.roundTrips,
    seed: manifest.seed,
    distractors: manifest.distractors,
    forwardOrder: sample.forwardOrder,
    complete: false,
    providerErrors: errorAttemptMetrics.length,
    errorAttemptMetrics,
    interactions,
  };
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  const text = await readFile(path, "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as T);
}

async function dirs(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/** The backward-step score after each round trip. null for a step that has no score. */
export function relayScores(relay: RelayResult): (number | null)[] {
  return relay.interactions
    .filter((i) => i.direction === "backward")
    .map((i) => i.score?.score ?? null);
}

/** Round trips whose score fell by `CRITICAL_DROP` or more from the one before (the seed is 1). */
export function criticalErrors(relay: RelayResult): number {
  let prev = 1;
  let count = 0;
  for (const score of relayScores(relay)) {
    if (score === null) continue;
    if (prev - score >= CRITICAL_DROP - 1e-9) count++;
    prev = score;
  }
  return count;
}

interface Group {
  readonly model: string;
  readonly arm: string;
  readonly domain: string;
  readonly relays: RelayResult[];
}

function groupBy(relays: readonly RelayResult[], byDomain: boolean): Group[] {
  const map = new Map<string, Group>();
  for (const r of relays) {
    const domain = byDomain ? r.domain : "all";
    const key = `${r.model}\u0000${r.arm}\u0000${domain}`;
    const g = map.get(key) ?? { model: r.model, arm: r.arm, domain, relays: [] };
    g.relays.push(r);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) =>
    `${a.model}/${a.domain}/${a.arm}`.localeCompare(`${b.model}/${b.domain}/${b.arm}`),
  );
}

const all = (g: Group) => g.relays.flatMap((r) => r.interactions);
const backward = (g: Group) => all(g).filter((i) => i.direction === "backward");
const mean = (xs: readonly number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (x: number | null, digits = 1) => (x === null ? "-" : x.toFixed(digits));
const pct = (n: number, d: number) => (d === 0 ? "-" : `${((100 * n) / d).toFixed(0)}%`);
const rs = (x: number | null) => (x === null ? "-" : (100 * x).toFixed(1));

/** RS@k: the mean backward score after round trip k/2, over the relays that reached it. */
function rsAt(g: Group, roundTrip: number): number | null {
  return mean(
    g.relays.flatMap((r) => {
      const s = relayScores(r)[roundTrip - 1];
      return s === undefined || s === null ? [] : [s];
    }),
  );
}

function sum(rows: readonly RelayInteraction[], f: (i: RelayInteraction) => number): number {
  return rows.reduce((a, i) => a + f(i), 0);
}

function counts(
  rows: readonly RelayInteraction[],
  f: (i: RelayInteraction) => Record<string, number>,
) {
  const out: Record<string, number> = {};
  for (const i of rows) for (const [k, v] of Object.entries(f(i))) out[k] = (out[k] ?? 0) + v;
  return out;
}

const mapText = (m: Record<string, number>) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ") || "-";

/** USD for one interaction at Command Code card rates, or null for a model with no rate. */
export function interactionCostUsd(model: string, i: RelayInteraction): number | null {
  return runCostUsd(model, i.metrics);
}

/** The Markdown report for a DELEGATE-52 run folder. */
export function relayReport(relays: readonly RelayResult[]): string {
  const maxTrips = Math.max(0, ...relays.map((r) => r.roundTrips));
  const trips = Array.from({ length: maxTrips }, (_, i) => i + 1);
  const lines: string[] = ["# DELEGATE-52 relay report", ""];
  const complete = relays.filter((r) => r.complete).length;
  lines.push(
    `${relays.length} relays, ${complete} complete, ${sum(
      relays.flatMap((r) => r.interactions),
      () => 1,
    )} interactions.`,
    "",
    "RS@k is the mean seed score (x100) after the backward step of round trip k/2. A critical error is a round trip whose score drops by 10 points or more.",
    "",
  );

  lines.push("## Domain score", "");
  lines.push(
    `| Model | Domain | Arm | Relays | ${trips.map((t) => `RS@${2 * t}`).join(" | ")} | Critical errors | Unscored |`,
    `|---|---|---|---|${trips.map(() => "---|").join("")}---|---|`,
  );
  for (const g of groupBy(relays, true)) {
    const unscored = backward(g).filter((i) => i.score === null || i.score.score === null).length;
    const crit = g.relays.reduce((a, r) => a + criticalErrors(r), 0);
    lines.push(
      `| ${g.model} | ${g.domain} | ${g.arm} | ${g.relays.length} | ${trips.map((t) => rs(rsAt(g, t))).join(" | ")} | ${crit} | ${unscored} |`,
    );
  }

  lines.push("", "## Paired difference by sample (final RS, bft-edit minus d52-tools)", "");
  lines.push("| Model | Sample | d52-tools | bft-edit | Difference |", "|---|---|---|---|---|");
  const finalOf = (r: RelayResult | undefined) => {
    const s = r === undefined ? [] : relayScores(r);
    return s.at(-1) ?? null;
  };
  const keys = [...new Set(relays.map((r) => `${r.model}\u0000${r.sample}`))].sort();
  for (const key of keys) {
    const [model, sample] = key.split("\u0000") as [string, string];
    const a = finalOf(
      relays.find((r) => r.model === model && r.sample === sample && r.arm === "d52-tools"),
    );
    const b = finalOf(
      relays.find((r) => r.model === model && r.sample === sample && r.arm === "bft-edit"),
    );
    lines.push(
      `| ${model} | ${sample} | ${rs(a)} | ${rs(b)} | ${a === null || b === null ? "-" : (100 * (b - a)).toFixed(1)} |`,
    );
  }

  lines.push("", "## Exact measures on backward steps", "");
  lines.push(
    "| Model | Domain | Arm | Backward steps | Byte-exact return | Mean line diff | Final mean line diff | Mean line bloat | File-set errors (fwd / bwd) |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const g of groupBy(relays, true)) {
    const b = backward(g);
    const exact = b.filter((i) => i.seed?.exact === true).length;
    const finals = g.relays.flatMap((r) => {
      const last = r.interactions.filter((i) => i.direction === "backward").at(-1);
      return last?.seed ? [last.seed.lineDiff] : [];
    });
    const fsFwd = all(g).filter((i) => i.direction === "forward" && !i.fileSet.ok).length;
    const fsBwd = b.filter((i) => !i.fileSet.ok).length;
    lines.push(
      `| ${g.model} | ${g.domain} | ${g.arm} | ${b.length} | ${exact} (${pct(exact, b.length)}) | ${fmt(mean(b.flatMap((i) => (i.seed ? [i.seed.lineDiff] : []))))} | ${fmt(mean(finals))} | ${fmt(mean(b.flatMap((i) => (i.seed ? [i.seed.lineBloat] : []))))}% | ${fsFwd} / ${fsBwd} |`,
    );
  }

  lines.push("", "## Process", "");
  lines.push(
    "| Model | Arm | Interactions | Mean steps | Nudges | Step-limit hits | Budget hits | Finish calls | No write | Provider errors | Incomplete relays | Distractor reads |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const g of groupBy(relays, false)) {
    const rows = all(g);
    lines.push(
      `| ${g.model} | ${g.arm} | ${rows.length} | ${fmt(mean(rows.map((i) => i.metrics.steps)))} | ${sum(rows, (i) => i.nudges)} | ${rows.filter((i) => i.end === "max-steps" && !i.budgetHit).length} | ${rows.filter((i) => i.budgetHit).length} | ${rows.filter((i) => i.finished).length} | ${rows.filter((i) => !i.wrote).length} | ${g.relays.reduce((a, r) => a + r.providerErrors, 0)} | ${g.relays.filter((r) => !r.complete).length} | ${pct(rows.filter((i) => i.distractorReads > 0).length, rows.length)} |`,
    );
  }

  lines.push("", "## Tool mix and tool errors", "");
  lines.push(
    "| Model | Arm | Tool calls per interaction | Tool calls | Tool errors |",
    "|---|---|---|---|---|",
  );
  for (const g of groupBy(relays, false)) {
    const rows = all(g);
    const calls = counts(rows, (i) => i.metrics.toolCalls);
    const total = Object.values(calls).reduce((a, b) => a + b, 0);
    lines.push(
      `| ${g.model} | ${g.arm} | ${fmt(rows.length === 0 ? null : total / rows.length)} | ${mapText(calls)} | ${mapText(counts(rows, (i) => i.metrics.toolErrors))} |`,
    );
  }
  lines.push("", "Interactions by mutation tool used:", "");
  lines.push("| Model | Arm | Mix | Interactions |", "|---|---|---|---|");
  for (const g of groupBy(relays, false)) {
    const mix: Record<string, number> = {};
    for (const i of all(g)) {
      const used = ["edit", "write", "write_file", "run_python", "delete_file"].filter(
        (t) => (i.metrics.toolCalls[t] ?? 0) > 0,
      );
      const key = used.join(" + ") || "none";
      mix[key] = (mix[key] ?? 0) + 1;
    }
    lines.push(`| ${g.model} | ${g.arm} | ${mapText(mix)} | ${all(g).length} |`);
  }

  lines.push("", "## Tokens and cost", "");
  lines.push(
    "Token totals include failed provider attempts. The means are over saved interactions only.",
    "",
    "| Model | Arm | Interactions | Failed attempts | Input | Cached input | Output | Reasoning | Mean input per interaction | Mean output per interaction | Cost (USD, card rates) |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const g of groupBy(relays, false)) {
    const rows = all(g);
    const metrics = [
      ...rows.map((i) => i.metrics),
      ...g.relays.flatMap((r) => r.errorAttemptMetrics ?? []),
    ];
    const total = (f: (m: RelayInteraction["metrics"]) => number) =>
      metrics.reduce((a, m) => a + f(m), 0);
    const costs = metrics.map((m) => runCostUsd(g.model, m));
    const cost = costs.some((c) => c === null) ? null : costs.reduce<number>((a, c) => a + c!, 0);
    lines.push(
      `| ${g.model} | ${g.arm} | ${rows.length} | ${metrics.length - rows.length} | ${total((m) => m.inputTokens)} | ${total((m) => m.cachedInputTokens)} | ${total((m) => m.outputTokens)} | ${total((m) => m.reasoningTokens)} | ${fmt(mean(rows.map((i) => i.metrics.inputTokens)), 0)} | ${fmt(mean(rows.map((i) => i.metrics.outputTokens)), 0)} | ${cost === null ? "- (quota)" : cost.toFixed(4)} |`,
    );
  }

  lines.push("", "## Relays", "");
  lines.push(
    "| Model | Arm | Sample | Forward order | Scores after each round trip | Critical | Complete |",
    "|---|---|---|---|---|---|---|",
  );
  for (const r of relays) {
    lines.push(
      `| ${r.model} | ${r.arm} | ${r.sample} | ${r.forwardOrder.join(", ")} | ${relayScores(r).map(rs).join(", ")} | ${criticalErrors(r)} | ${r.complete ? "yes" : "no"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
