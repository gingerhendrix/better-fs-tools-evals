/**
 * The scorer ids that fixture metadata can name. `omp` is the Oh My Pi verifier.
 * `exact` compares file bytes. The CLI maps each id to a scorer package.
 */
export type ScorerId = "omp" | "exact";

export type DamageKind =
  | "eof-only"
  | "crlf-only"
  | "nfc-only"
  | "untouched-changed"
  | "collapsed"
  | "content"
  | "missing"
  | "extra"
  | "non-regular";

export interface FileDamage {
  readonly file: string;
  readonly kind: DamageKind;
}

export interface Verification {
  readonly damage?: readonly FileDamage[];
  readonly passed: boolean;
  readonly error: string | null;
  /** Lines that differ after formatting. 0 on a pass. */
  readonly linesChanged: number;
}

/** Compares a finished workspace with the fixture's `expected/` folder. */
export type Verifier = (expectedDir: string, actualDir: string) => Promise<Verification>;

/** Finds the verifier for a task's scorer id. The runner gets one from its caller. */
export type ScorerResolver = (id: ScorerId | undefined) => Verifier;
