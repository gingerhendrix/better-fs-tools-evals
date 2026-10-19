import type { CodexTokens } from "./auth.ts";

/**
 * The Codex backend takes only this subset of Responses API fields. Others,
 * such as `max_output_tokens` or `temperature`, give a 400.
 * Same list as Auto-Agent `codex-oauth/provider.ts`.
 */
const ALLOWED_FIELDS = new Set([
  "model",
  "input",
  "instructions",
  "stream",
  "include",
  "tools",
  "tool_choice",
  "reasoning",
  "truncation",
  "prompt_cache_key",
]);

interface InputItem {
  readonly role?: string;
  readonly content?: unknown;
}

/**
 * Rewrites an AI SDK Responses request body for the Codex backend. The
 * backend needs `instructions`, so the first system or developer message
 * moves there. Fields outside the allowed set go, and `store` is false.
 */
export function codexRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) out[key] = value;
  }
  if (typeof out.instructions !== "string") {
    const input = Array.isArray(out.input) ? [...(out.input as InputItem[])] : [];
    const index = input.findIndex((m) => m.role === "system" || m.role === "developer");
    if (index >= 0) {
      out.instructions = input[index]!.content;
      input.splice(index, 1);
      out.input = input;
    } else {
      out.instructions = "You are a helpful assistant.";
    }
  }
  out.store = false;
  return out;
}

/** Adds the ChatGPT account auth headers that the Codex CLI sends. */
export function codexRequestHeaders(
  initial: ConstructorParameters<typeof Headers>[0],
  tokens: Pick<CodexTokens, "access_token" | "account_id">,
  promptCacheKey: string | undefined,
): Headers {
  const headers = new Headers(initial);
  headers.set("Authorization", `Bearer ${tokens.access_token}`);
  headers.set("chatgpt-account-id", tokens.account_id);
  headers.set("originator", "codex_cli_rs");
  if (promptCacheKey !== undefined) headers.set("session-id", promptCacheKey);
  return headers;
}
