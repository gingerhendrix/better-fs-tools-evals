import type { RunMetrics } from "./metrics.ts";

/** USD per million tokens. Same fields as `TokenRate` in StreamOS `packages/streams/src/estimated-spend.ts`. */
export interface TokenRate {
  readonly input: number;
  readonly cacheRead: number;
  readonly output: number;
}

export interface TokenRateCard {
  readonly source: string;
  readonly asOf: string;
  /** Keyed by the exact Command Code API model id. Lookups never guess an id from its spelling. */
  readonly rates: Readonly<Record<string, TokenRate>>;
}

/**
 * Command Code prices, from the pricing page on the `asOf` date. The page
 * lists no cache-write price for these models, so cache writes are not priced.
 * Output tokens include reasoning tokens, as AI SDK reports them.
 *
 * DeepSeek V4 Flash and V4.1 Flash use the off-peak rate, as the StreamOS rate card does.
 * The V4.1 Flash rate was added from the same page on 2026-10-13.
 * The peak rate (input 0.30, output 1.20) applies 01-04 and 06-10 UTC on weekdays.
 */
export const COMMAND_CODE_RATE_CARD: TokenRateCard = {
  source: "https://commandcode.ai/docs/resources/pricing-limits",
  asOf: "2026-10-17",
  rates: {
    "xiaomi/mimo-v2.6-flash": { input: 0.14, cacheRead: 0.0028, output: 0.28 },
    "nvidia/nemotron-3-ultra-550b-a55b": { input: 0.6, cacheRead: 0.12, output: 2.4 },
    "deepseek/deepseek-v4-flash": { input: 0.15, cacheRead: 0.003, output: 0.6 },
    "deepseek/deepseek-v4.1-flash": { input: 0.15, cacheRead: 0.003, output: 0.6 },
    "Qwen/Qwen3.8-Flash": { input: 0.16, cacheRead: 0.016, output: 0.47 },
    "z-ai/glm-5.3-flash": { input: 0.15, cacheRead: 0.03, output: 0.5 },
    "google/gemini-3.8-flash": { input: 1.5, cacheRead: 0.15, output: 7.5 },
    // Friction panel models, added from the same page on 2026-10-13.
    "gpt-6-luna": { input: 0.1, cacheRead: 0.01, output: 0.5 },
    "google/gemini-3.5-flash-lite": { input: 0.3, cacheRead: 0.03, output: 2.5 },
    "stepfun/Step-3.7-Flash": { input: 0.2, cacheRead: 0.04, output: 1.15 },
  },
};

/**
 * Estimated USD for one run, or null when the card has no rate for the model.
 * `inputTokens` includes cached tokens, so the uncached part is the difference.
 */
export function runCostUsd(
  model: string,
  metrics: RunMetrics,
  card: TokenRateCard = COMMAND_CODE_RATE_CARD,
): number | null {
  const rate = card.rates[model];
  if (rate === undefined) return null;
  const cached = Math.min(metrics.cachedInputTokens, metrics.inputTokens);
  const uncached = metrics.inputTokens - cached;
  return (
    (uncached * rate.input + cached * rate.cacheRead + metrics.outputTokens * rate.output) /
    1_000_000
  );
}
