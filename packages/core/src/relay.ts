import { join } from "node:path";

import type { RunMetrics } from "./metrics.ts";
import { modelDirName } from "./result.ts";
import type { EndState } from "./result.ts";

/**
 * Contracts for relay benchmarks such as DELEGATE-52. A relay chains round
 * trips: a forward edit from the seed state to another state, then the
 * backward edit that returns to the seed. Sources supply `RelaySample`s and a
 * `RelayScorer`; the runner drives the relay and writes one folder for it.
 */

/** File name to file text. Names are relative to the workspace root. */
export type FileMap = Readonly<Record<string, string>>;

export interface RelayPrompt {
  readonly targetState: string;
  readonly prompt: string;
}

export interface RelayState {
  readonly id: string;
  /** File names the state must contain. A name with `*` or `?` is a glob. */
  readonly targetFiles: readonly string[];
  readonly prompts: readonly RelayPrompt[];
}

export interface RelaySample {
  readonly id: string;
  readonly domain: string;
  readonly name: string;
  readonly license: string | null;
  readonly startState: string;
  readonly states: readonly RelayState[];
  /** The start state's files. Backward steps are scored against these. */
  readonly seedFiles: FileMap;
  /** Unrelated files added to every interaction and stripped after it. */
  readonly distractorFiles: FileMap;
}

/** The score of one backward step. `score` is 0 to 1, or null when the scorer gives none. */
export interface RelayScore {
  readonly score: number | null;
  readonly error: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

/** Scores the files after a backward step against the sample's seed. */
export type RelayScorer = (sample: RelaySample, files: FileMap) => Promise<RelayScore>;

export type RelayDirection = "forward" | "backward";

export interface FileSetCheck {
  readonly ok: boolean;
  /** Target names (or globs) with no matching file. */
  readonly missing: readonly string[];
  /** Files that match no target name or glob. Only set when the target list has a glob. */
  readonly extra: readonly string[];
}

/** Our exact measures against the seed, beside the domain score. */
export interface SeedComparison {
  /** Every seed file is present and byte-equal, and no other file is present. */
  readonly exact: boolean;
  /** Seed files that are byte-equal to the seed. */
  readonly exactFiles: readonly string[];
  /** Lines added plus lines removed, over all files, against the seed. */
  readonly lineDiff: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  /** Line and character change against the seed, in percent. */
  readonly lineBloat: number;
  readonly charBloat: number;
}

/** `interaction.json` for one step of a relay. */
export interface RelayInteraction {
  readonly index: number;
  readonly roundTrip: number;
  readonly direction: RelayDirection;
  readonly fromState: string;
  readonly targetState: string;
  readonly prompt: string;
  readonly end: EndState;
  readonly loopError: string | null;
  /** The model called the finish tool and the call was accepted. */
  readonly finished: boolean;
  /** The total token budget stopped the loop. */
  readonly budgetHit: boolean;
  readonly nudges: number;
  readonly wrote: boolean;
  readonly toolSequence: readonly string[];
  readonly filesRead: readonly string[];
  readonly distractorReads: number;
  readonly files: readonly string[];
  readonly strippedDistractors: readonly string[];
  readonly fileSet: FileSetCheck;
  /** Backward steps only. */
  readonly score: RelayScore | null;
  /** Backward steps only. */
  readonly seed: SeedComparison | null;
  readonly providerHttpErrors: number;
  readonly wallMs: number;
  readonly metrics: RunMetrics;
}

/** `relay.json`: the summary of one relay. */
export interface RelayResult {
  readonly schema: "relay/1";
  readonly sample: string;
  readonly domain: string;
  readonly arm: string;
  readonly model: string;
  readonly roundTrips: number;
  readonly seed: number;
  readonly distractors: boolean;
  readonly forwardOrder: readonly string[];
  /** All interactions ran and none ended in a provider error. */
  readonly complete: boolean;
  /** Interactions that ended in a provider error, retries included. */
  readonly providerErrors: number;
  /** Tokens spent in those failed attempts. They count in the cost, not in the measures. */
  readonly errorAttemptMetrics: readonly RunMetrics[];
  readonly interactions: readonly RelayInteraction[];
}

/** `<outDir>/relays/<model>/<arm>/<sample>`. */
export function relayPath(outDir: string, model: string, arm: string, sample: string): string {
  return join(outDir, "relays", modelDirName(model), arm, sample);
}
