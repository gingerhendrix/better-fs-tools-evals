import { join } from "node:path";

import type { RunMetrics } from "./metrics.ts";
import type { FileDamage, ScorerId } from "./score.ts";

export type EndState = "done" | "matched" | "max-steps" | "error";

/** The `result.json` of one cell. Run folders from 2026-09-28 onward use this shape. */
export interface CellResult {
  readonly model: string;
  readonly arm: string;
  readonly task: string;
  readonly attempt: number;
  readonly difficulty: string | null;
  readonly mutationType: string | null;
  readonly passed: boolean;
  readonly verifyError: string | null;
  readonly verify?: ScorerId;
  readonly damage?: readonly FileDamage[];
  readonly linesChanged: number;
  readonly end: EndState;
  readonly loopError: string | null;
  /** Non-200 HTTP responses. AI SDK retried them; they add wall time but no tokens. */
  readonly providerHttpErrors: number;
  readonly wallMs: number;
  readonly metrics: RunMetrics;
}

/** The names that place one cell in a run folder. */
export interface CellKey {
  readonly model: string;
  readonly arm: string;
  readonly task: string;
  readonly attempt: number;
}

/** A model id as a folder name: every character outside `[a-zA-Z0-9._-]` becomes `_`. */
export function modelDirName(model: string): string {
  return model.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** `<outDir>/runs/<model>/<arm>/<task>/a<attempt>`. */
export function cellPath(outDir: string, key: CellKey): string {
  return join(outDir, "runs", modelDirName(key.model), key.arm, key.task, `a${key.attempt}`);
}
