/** Counters for one run. Every field is a plain number or string map, so it serialises as is. */
export interface RunMetrics {
  /** Optional so old result files remain valid. Counts attempted calls before execution. */
  shortWriteCalls?: number;
  steps: number;
  toolCalls: Record<string, number>;
  /** Tool error codes: `edit:NO_MATCH`, `read:NOT_FOUND`, `edit:schema`, and so on. */
  toolErrors: Record<string, number>;
  /** Note codes from successful and failed results, for example `edit:fuzzy-match`. */
  notes: Record<string, number>;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Characters the model sent as tool input. */
  toolInputChars: number;
}

export function emptyMetrics(): RunMetrics {
  return {
    steps: 0,
    toolCalls: {},
    toolErrors: {},
    notes: {},
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    toolInputChars: 0,
  };
}

export function totalErrors(m: RunMetrics): number {
  return Object.values(m.toolErrors).reduce((a, b) => a + b, 0);
}
