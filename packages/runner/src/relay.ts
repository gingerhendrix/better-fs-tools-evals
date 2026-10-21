import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { relayPath } from "@bfe/core";
import type {
  FileMap,
  RelayDirection,
  RelayInteraction,
  RelayResult,
  RelaySample,
  RelayScore,
  RelayScorer,
} from "@bfe/core";
import { evalModel } from "@bfe/providers";
import { workspaceFiles } from "@bfe/tools";
import type { RelayArm } from "@bfe/tools";
import type { LanguageModel } from "ai";

import { runLoop } from "./loop.ts";
import { checkFileSet, compareWithSeed } from "./relay-measures.ts";
import { countHttpErrors } from "./run.ts";

export interface RelayOptions {
  readonly outDir: string;
  readonly sample: RelaySample;
  readonly arm: RelayArm;
  readonly model: string;
  /** The forward target of each round trip. Its length is the number of round trips. */
  readonly forwardOrder: readonly string[];
  /** The seed that made `forwardOrder`. Recorded only. */
  readonly seed: number;
  readonly distractors: boolean;
  readonly scorer: RelayScorer;
  /** Upstream MAX_TURNS is 25. */
  readonly maxSteps: number;
  readonly stepTimeoutMs: number;
  /** Upstream MAX_TOTAL_TOKENS is 500k: input plus output over one interaction. */
  readonly maxTotalTokens: number;
  /** Extra tries of an interaction that ends in a provider error, in the same run. */
  readonly retries: number;
  readonly keepWorkspace?: boolean;
  /** Tests pass a fake model. The default is `evalModel`. */
  readonly modelFor?: (model: string, httpLog: string) => LanguageModel;
  readonly onInteraction?: (interaction: RelayInteraction, saved: boolean) => void;
}

interface Step {
  readonly index: number;
  readonly roundTrip: number;
  readonly direction: RelayDirection;
  readonly from: string;
  readonly to: string;
}

export function relaySteps(sample: RelaySample, forwardOrder: readonly string[]): Step[] {
  return forwardOrder.flatMap((target, i) => [
    { index: 2 * i, roundTrip: i + 1, direction: "forward", from: sample.startState, to: target },
    {
      index: 2 * i + 1,
      roundTrip: i + 1,
      direction: "backward",
      from: target,
      to: sample.startState,
    },
  ]);
}

const interactionDir = (relayDir: string, index: number) =>
  join(relayDir, `i${String(index + 1).padStart(2, "0")}`);

/**
 * Runs one relay. Each interaction gets a fresh workspace with the current
 * files and the distractor files. After the loop the relay reads the files
 * back, strips the distractors, checks the file set, and scores backward
 * steps. It saves `interaction.json` and `snapshot.json` for each step.
 *
 * A saved interaction is not run again, so a second call resumes after the
 * last saved snapshot. An interaction that ends in a provider error is tried
 * `retries` more times from the same snapshot. If it still fails, the relay
 * stops and is marked incomplete; a later call resumes it.
 */
export async function runRelay(options: RelayOptions): Promise<RelayResult> {
  const { sample, arm } = options;
  const relayDir = relayPath(options.outDir, options.model, arm.name, sample.id);
  await mkdir(relayDir, { recursive: true });
  const interactions: RelayInteraction[] = [];
  let files: FileMap = sample.seedFiles;
  let complete = true;
  for (const step of relaySteps(sample, options.forwardOrder)) {
    const dir = interactionDir(relayDir, step.index);
    const saved = await readSaved(dir);
    if (saved !== null) {
      interactions.push(saved.interaction);
      files = saved.files;
      options.onInteraction?.(saved.interaction, true);
      continue;
    }
    let result: { interaction: RelayInteraction; files: FileMap } | null = null;
    for (let attempt = 0; attempt <= options.retries; attempt++) {
      result = await runInteraction(options, step, files, dir);
      if (result.interaction.end !== "error") break;
      await writeJson(join(dir, `error-${Date.now()}.json`), result.interaction);
      options.onInteraction?.(result.interaction, false);
    }
    if (result === null || result.interaction.end === "error") {
      complete = false;
      break;
    }
    await writeJson(join(dir, "snapshot.json"), { files: result.files });
    await writeJson(join(dir, "interaction.json"), result.interaction);
    interactions.push(result.interaction);
    files = result.files;
    options.onInteraction?.(result.interaction, false);
  }
  const relay: RelayResult = {
    schema: "relay/1",
    sample: sample.id,
    domain: sample.domain,
    arm: arm.name,
    model: options.model,
    roundTrips: options.forwardOrder.length,
    seed: options.seed,
    distractors: options.distractors,
    forwardOrder: options.forwardOrder,
    complete,
    ...(await errorAttempts(relayDir)),
    interactions,
  };
  await writeJson(join(relayDir, "relay.json"), relay);
  return relay;
}

async function runInteraction(
  options: RelayOptions,
  step: Step,
  files: FileMap,
  dir: string,
): Promise<{ interaction: RelayInteraction; files: FileMap }> {
  const { sample, arm } = options;
  const target = sample.states.find((s) => s.id === step.to);
  const from = sample.states.find((s) => s.id === step.from);
  const prompt = from?.prompts.find((p) => p.targetState === step.to)?.prompt;
  if (target === undefined || prompt === undefined)
    throw new Error(`${sample.id}: no prompt from ${step.from} to ${step.to}`);

  const workspace = join(dir, "workspace");
  await rm(workspace, { recursive: true, force: true });
  await rm(join(dir, "steps.jsonl"), { force: true });
  await rm(join(dir, "http.jsonl"), { force: true });
  const distractors: FileMap = options.distractors ? sample.distractorFiles : {};
  // Upstream `merge_distractor`: a distractor replaces a file with the same name.
  const start: FileMap = { ...files, ...distractors };
  for (const [name, content] of Object.entries(start)) {
    await mkdir(dirname(join(workspace, name)), { recursive: true });
    await writeFile(join(workspace, name), content);
  }
  await mkdir(workspace, { recursive: true });

  const session = arm.session(workspace);
  let nudges = 0;
  let budgetHit = false;
  const started = Date.now();
  const httpLog = join(dir, "http.jsonl");
  const loop = await runLoop({
    model: (options.modelFor ?? evalModel)(options.model, httpLog),
    system: arm.system(target.targetFiles),
    prompt: arm.user(Object.keys(start), prompt),
    tools: session.tools,
    maxSteps: options.maxSteps,
    stepTimeoutMs: options.stepTimeoutMs,
    stepLog: join(dir, "steps.jsonl"),
    onNoToolCall: () => {
      if (session.wrote() || nudges > 0) return null;
      nudges++;
      return arm.nudge;
    },
    afterToolStep: (metrics) => {
      if (session.finished()) return "done";
      if (metrics.inputTokens + metrics.outputTokens > options.maxTotalTokens) {
        budgetHit = true;
        return "max-steps";
      }
      return null;
    },
  });
  const wallMs = Date.now() - started;

  const after: Record<string, string> = {};
  const stripped: string[] = [];
  for (const name of await workspaceFiles(workspace)) {
    if (name in distractors) stripped.push(name);
    else after[name] = await readFile(join(workspace, name), "utf8");
  }
  const names = Object.keys(after).sort();
  const fileSet = checkFileSet(names, target.targetFiles);
  const backward = step.direction === "backward";
  // A failed attempt is not scored: its files are a half-done edit that the relay throws away.
  const score =
    backward && loop.end !== "error"
      ? await scoreStep(options.scorer, sample, after, fileSet)
      : null;

  const calls = session.calls();
  const toolErrors = { ...loop.metrics.toolErrors };
  for (const call of calls) {
    if (call.error === null) continue;
    const key = `${call.tool}:${call.error}`;
    toolErrors[key] = (toolErrors[key] ?? 0) + 1;
  }
  const filesRead = calls
    .filter((c) => c.tool === "read_file" || c.tool === "read")
    .flatMap((c) => (c.file === null ? [] : [c.file]));
  const interaction: RelayInteraction = {
    index: step.index,
    roundTrip: step.roundTrip,
    direction: step.direction,
    fromState: step.from,
    targetState: step.to,
    prompt,
    end: loop.end,
    loopError: loop.error,
    finished: session.finished(),
    budgetHit,
    nudges,
    wrote: session.wrote(),
    toolSequence: calls.map((c) => c.tool),
    filesRead,
    distractorReads: filesRead.filter((f) => f in distractors).length,
    files: names,
    strippedDistractors: stripped.sort(),
    fileSet,
    score,
    seed: backward ? compareWithSeed(sample.seedFiles, after) : null,
    providerHttpErrors: await countHttpErrors(httpLog),
    wallMs,
    metrics: { ...loop.metrics, toolErrors },
  };
  if (!options.keepWorkspace) await rm(workspace, { recursive: true, force: true });
  return { interaction, files: after };
}

/**
 * A backward step with a missing target file scores 0, as an upstream
 * `context_mismatch`. Otherwise the domain scorer runs. A scorer failure is
 * recorded with a null score, so the report can count unscored steps.
 */
async function scoreStep(
  scorer: RelayScorer,
  sample: RelaySample,
  files: FileMap,
  fileSet: { readonly ok: boolean; readonly missing: readonly string[] },
): Promise<RelayScore> {
  if (!fileSet.ok) {
    return {
      score: 0,
      error: fileSet.missing.length > 0 ? "context_mismatch" : "wildcard_mismatch",
      details: { ...fileSet },
    };
  }
  try {
    return await scorer(sample, files);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { score: null, error: `scorer-failed: ${text}`, details: {} };
  }
}

async function readSaved(
  dir: string,
): Promise<{ interaction: RelayInteraction; files: FileMap } | null> {
  const interaction = await readJson<RelayInteraction>(join(dir, "interaction.json"));
  const snapshot = await readJson<{ files: FileMap }>(join(dir, "snapshot.json"));
  if (interaction === null || snapshot === null || interaction.end === "error") return null;
  return { interaction, files: snapshot.files };
}

/** The `error-<ms>.json` files of a relay: how many, and the tokens each one used. */
async function errorAttempts(relayDir: string) {
  const errorAttemptMetrics: RelayInteraction["metrics"][] = [];
  for (const entry of await readdir(relayDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of (await readdir(join(relayDir, entry.name))).sort()) {
      if (!/^error-\d+\.json$/.test(name)) continue;
      const failed = await readJson<RelayInteraction>(join(relayDir, entry.name, name));
      if (failed !== null) errorAttemptMetrics.push(failed.metrics);
    }
  }
  return { providerErrors: errorAttemptMetrics.length, errorAttemptMetrics };
}

async function readJson<T>(path: string): Promise<T | null> {
  const text = await readFile(path, "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as T);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Runs relays with a fixed number of workers. Each relay resumes from its saved interactions. */
export async function runRelays(
  jobs: readonly Omit<RelayOptions, "onInteraction">[],
  concurrency: number,
  onInteraction: (
    job: Omit<RelayOptions, "onInteraction">,
    i: RelayInteraction,
    saved: boolean,
  ) => void,
): Promise<RelayResult[]> {
  const results: RelayResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      results.push(
        await runRelay({ ...job, onInteraction: (i, saved) => onInteraction(job, i, saved) }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}
