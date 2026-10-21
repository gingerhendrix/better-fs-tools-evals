import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { FileMap, RelaySample, RelayState } from "@bfe/core";

/** One line of `delegate52.jsonl` (microsoft/delegate52 on Hugging Face). */
interface Row {
  readonly sample_id: string;
  readonly sample_type: string;
  readonly sample_name?: string;
  readonly metadata: {
    readonly start_state: string;
    readonly context_license?: string;
  };
  readonly states: readonly {
    readonly state_id: string;
    readonly solution_folder?: string;
    /** Target file names. Upstream reads it with `list(...)`, so an object gives its keys. */
    readonly context: readonly string[] | Readonly<Record<string, unknown>>;
    readonly prompts: readonly { readonly target_state: string; readonly prompt: string }[];
  }[];
  /** `<folder>/<file>`: the start state's `solution_folder`, or `distractor_context`. */
  readonly files: Readonly<Record<string, string>>;
}

export interface SampleFilter {
  /** Keep samples whose `sample_type` is in this list. */
  readonly domains?: readonly string[];
  /** Keep these sample ids, in this order. */
  readonly samples?: readonly string[];
}

const DISTRACTOR_FOLDER = "distractor_context";

/**
 * Reads `delegate52.jsonl` and returns the samples that pass the filter.
 * With `samples`, the result keeps that order and an unknown id is an error.
 */
export async function loadDelegate52(
  path: string,
  filter: SampleFilter = {},
): Promise<RelaySample[]> {
  const text = await readFile(path, "utf8");
  const wanted = filter.samples === undefined ? null : new Set(filter.samples);
  const found = new Map<string, RelaySample>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as Row;
    if (wanted !== null && !wanted.has(row.sample_id)) continue;
    if (filter.domains !== undefined && !filter.domains.includes(row.sample_type)) continue;
    found.set(row.sample_id, toSample(row));
  }
  if (filter.samples === undefined) return [...found.values()];
  return filter.samples.map((id) => {
    const sample = found.get(id);
    if (sample === undefined)
      throw new Error(`sample "${id}" is not in ${path} (or not in --domains)`);
    return sample;
  });
}

/** The sha256 of the dataset file, for the run manifest. */
export async function datasetSha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export function toSample(row: Row): RelaySample {
  const start = row.states.find((s) => s.state_id === row.metadata.start_state);
  if (start === undefined) throw new Error(`${row.sample_id}: no start state`);
  const seedFolder = start.solution_folder ?? start.state_id;
  return {
    id: row.sample_id,
    domain: row.sample_type,
    name: row.sample_name ?? row.sample_id,
    license: row.metadata.context_license ?? null,
    startState: start.state_id,
    states: row.states.map((s): RelayState => ({
      id: s.state_id,
      targetFiles: Array.isArray(s.context) ? [...s.context] : Object.keys(s.context),
      prompts: s.prompts.map((p) => ({ targetState: p.target_state, prompt: p.prompt })),
    })),
    seedFiles: filesIn(row.files, seedFolder),
    distractorFiles: filesIn(row.files, DISTRACTOR_FOLDER),
  };
}

/** Files directly inside `folder`, keyed by their name. Upstream reads only the top level. */
function filesIn(files: Readonly<Record<string, string>>, folder: string): FileMap {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const rest = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : null;
    if (rest !== null && rest !== "" && !rest.includes("/")) out[rest] = content;
  }
  return out;
}

export type { Row as Delegate52Row };
