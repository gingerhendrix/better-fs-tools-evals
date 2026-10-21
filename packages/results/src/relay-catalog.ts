import { join } from "node:path";

import { modelDirName } from "@bfe/core";
import type { RunMetrics } from "@bfe/core";

import { files, isRecord, num, readJson, str, subdirs, sum } from "./fs-json.ts";
import { runCostUsd } from "./pricing.ts";
import { CRITICAL_DROP } from "./relay-report.ts";
import type { Batch, BatchRead, RunRow, RunSource } from "./catalog.ts";

/** The `interaction.json` fields the viewer reads. Every field is optional, so old runs still load. */
interface Interaction {
  readonly index?: number;
  readonly roundTrip?: number;
  readonly direction?: string;
  readonly fromState?: string;
  readonly targetState?: string;
  readonly end?: string;
  readonly loopError?: string | null;
  readonly fileSet?: { ok?: boolean; missing?: string[]; extra?: string[] } | null;
  readonly score?: { score?: number | null; error?: string | null } | null;
  readonly wallMs?: number | null;
  readonly metrics?: RunMetrics;
}

/**
 * Reads a DELEGATE-52 `d52` folder. Each interaction folder `i<nn>` is one run row:
 * the task is the sample, and the attempt is the interaction number.
 */
export async function readRelayBatch(dir: string, id: string): Promise<BatchRead | null> {
  const manifest = await readJson<Record<string, unknown>>(join(dir, "manifest.json"));
  if (manifest === null || !Array.isArray(manifest.models)) return null;
  const models = manifest.models.map(String);
  const arms = Array.isArray(manifest.arms)
    ? manifest.arms.map((a) => (isRecord(a) ? String(a.name) : String(a)))
    : [];
  const samples = Array.isArray(manifest.samples)
    ? manifest.samples.map((s) => (isRecord(s) ? String(s.id) : String(s)))
    : [];
  const roundTrips = num(manifest.roundTrips);
  const loop = isRecord(manifest.loop) ? manifest.loop : {};
  const batch: Batch = {
    id,
    kind: "relays",
    dir,
    created: str(manifest.created),
    fixtures: str(manifest.data),
    models,
    arms,
    tasks: samples,
    attempts: roundTrips === null ? null : roundTrips * 2,
    maxSteps: num(loop.maxSteps),
    earlyStop: null,
  };

  const modelNames = new Map(models.map((m) => [modelDirName(m), m]));
  const runs: Array<[RunSource, RunRow]> = [];
  const relaysDir = join(dir, "relays");
  for (const modelDir of await subdirs(relaysDir)) {
    const model = modelNames.get(modelDir) ?? modelDir;
    for (const arm of await subdirs(join(relaysDir, modelDir))) {
      for (const sample of await subdirs(join(relaysDir, modelDir, arm))) {
        const relayDir = join(relaysDir, modelDir, arm, sample);
        let previous = 1;
        for (const step of await subdirs(relayDir)) {
          if (!/^i\d+$/.test(step)) continue;
          const stepDir = join(relayDir, step);
          const interaction = await readInteraction(stepDir);
          const row = toRelayRow(`${id}/${modelDir}/${arm}/${sample}/${step}`, batch, {
            model,
            arm,
            sample,
            attempt: Number(step.slice(1)),
            interaction,
            previous,
          });
          if (row.score !== null && interaction?.direction === "backward") previous = row.score;
          runs.push([{ kind: "relays", dir: stepDir }, row]);
        }
      }
    }
  }
  return { batch, runs };
}

/** The saved interaction, or the last failed attempt when no attempt finished. */
async function readInteraction(dir: string): Promise<Interaction | null> {
  const saved = await readJson<Interaction>(join(dir, "interaction.json"));
  if (saved !== null) return saved;
  const errors = (await files(dir)).filter((n) => /^error-\d+\.json$/.test(n));
  const last = errors.at(-1);
  return last === undefined ? null : readJson<Interaction>(join(dir, last));
}

/**
 * A forward step passes when it ends cleanly with the expected file set.
 * A backward step must also keep its score within `CRITICAL_DROP` of the round trip before.
 */
function toRelayRow(
  id: string,
  batch: Batch,
  cell: {
    model: string;
    arm: string;
    sample: string;
    attempt: number;
    interaction: Interaction | null;
    previous: number;
  },
): RunRow {
  const i = cell.interaction;
  const m = i?.metrics;
  const toolErrorCodes = m?.toolErrors ?? {};
  const score = typeof i?.score?.score === "number" ? i.score.score : null;
  const backward = i?.direction === "backward";
  const fail = failReason(i, score, backward, cell.previous);
  const end = i === null ? "incomplete" : (i.end ?? "done");
  return {
    id,
    kind: "relays",
    batch: batch.id,
    fixtures: batch.fixtures,
    model: cell.model,
    arm: cell.arm,
    task: cell.sample,
    attempt: cell.attempt,
    flawed: false,
    passed: i === null ? null : fail === null,
    end,
    score,
    step:
      i === null
        ? null
        : `rt${i.roundTrip ?? "?"} ${i.direction ?? "?"}: ${i.fromState ?? "?"} -> ${i.targetState ?? "?"}`,
    linesChanged: null,
    verifyError: fail,
    loopError: i?.loopError ?? null,
    difficulty: null,
    mutationType: null,
    steps: m?.steps ?? 0,
    toolCalls: sum(m?.toolCalls ?? {}),
    toolErrors: sum(toolErrorCodes),
    toolErrorCodes,
    inputTokens: m?.inputTokens ?? 0,
    outputTokens: m?.outputTokens ?? 0,
    reasoningTokens: m?.reasoningTokens ?? 0,
    wallMs: i?.wallMs ?? null,
    costUsd: m === undefined ? null : runCostUsd(cell.model, m),
  };
}

function failReason(
  i: Interaction | null,
  score: number | null,
  backward: boolean,
  previous: number,
): string | null {
  if (i === null) return null;
  if (i.loopError) return i.loopError;
  if (i.fileSet?.ok === false) {
    const missing = i.fileSet.missing ?? [];
    const extra = i.fileSet.extra ?? [];
    return `file set: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`;
  }
  if (!backward) return null;
  if (score === null) return i.score?.error ?? "no score";
  if (previous - score >= CRITICAL_DROP - 1e-9) {
    return `critical drop: ${previous.toFixed(3)} -> ${score.toFixed(3)}`;
  }
  return null;
}
