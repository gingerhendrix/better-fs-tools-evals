import { randomUUID } from "node:crypto";

import { createOpenAI } from "@ai-sdk/openai";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";

import { loggingFetch } from "../http-log.ts";
import { CodexAuth } from "./auth.ts";
import { codexRequestBody, codexRequestHeaders } from "./request.ts";

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CODEX_OAUTH_PREFIX = "codex-oauth:";

const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type CodexEffort = (typeof EFFORTS)[number];

export interface CodexModelId {
  /** The Codex backend model id, for example `gpt-6-luna`. */
  readonly model: string;
  /** Unset means the backend default. */
  readonly effort: CodexEffort | null;
}

/**
 * Parses `codex-oauth:<model>` or `codex-oauth:<model>:<effort>`.
 * Returns null for any other id, so Command Code ids pass through.
 */
export function parseCodexModelId(id: string): CodexModelId | null {
  if (!id.startsWith(CODEX_OAUTH_PREFIX)) return null;
  const [model, effort, ...rest] = id.slice(CODEX_OAUTH_PREFIX.length).split(":");
  if (model === undefined || model === "" || rest.length > 0) {
    throw new Error(`bad Codex OAuth model id "${id}": use codex-oauth:<model>[:<effort>]`);
  }
  if (effort === undefined) return { model, effort: null };
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new Error(`bad reasoning effort "${effort}" in "${id}": use ${EFFORTS.join(", ")}`);
  }
  return { model, effort: effort as CodexEffort };
}

/** One shared token cache, so parallel cells do not each refresh. */
let sharedAuth: CodexAuth | null = null;

/**
 * A GPT model on the ChatGPT subscription through the Codex backend, the
 * method Auto-Agent uses. It is the Responses API with OAuth headers and a
 * rewritten body. Runs use subscription quota, not API credit, so the rate
 * card has no price for them. When `httpLog` is set, the rewritten request
 * and the response go to that JSONL file. Auth headers are not logged.
 *
 * Each call makes one model for one run, so each run gets its own cache key.
 * The key goes in the body as `prompt_cache_key`, and the fetch copies it to
 * the `session-id` header. The header pins the run to one warm cache shard.
 * Without it, the backend spreads steps across shards and most steps miss.
 */
export function codexOAuthModel(
  id: CodexModelId,
  httpLog?: string,
  cacheKey: string = randomUUID(),
): LanguageModel {
  const auth = (sharedAuth ??= new CodexAuth());
  const send = httpLog === undefined ? fetch : loggingFetch(httpLog);
  const codexFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const tokens = await auth.getTokens();
    let cacheKey: string | undefined;
    if (typeof init?.body === "string") {
      const body = codexRequestBody(JSON.parse(init.body) as Record<string, unknown>);
      cacheKey = typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : undefined;
      init = { ...init, body: JSON.stringify(body) };
    }
    return send(input, { ...init, headers: codexRequestHeaders(init?.headers, tokens, cacheKey) });
  };

  const provider = createOpenAI({
    apiKey: "codex-oauth",
    baseURL: CODEX_BASE_URL,
    fetch: codexFetch as typeof fetch,
  });
  const openai = codexProviderOptions(id, cacheKey);
  return wrapLanguageModel({
    model: provider.responses(id.model),
    middleware: defaultSettingsMiddleware({ settings: { providerOptions: { openai } } }),
  });
}

/**
 * The AI SDK OpenAI options for one Codex run. This is the same cache
 * pinning that Auto-Agent uses: a stable `promptCacheKey` for each agent.
 */
export function codexProviderOptions(
  id: CodexModelId,
  cacheKey: string,
): OpenAIResponsesProviderOptions {
  return {
    // store: false makes AI SDK ask for encrypted reasoning, which a
    // stateless multi-step loop must send back.
    store: false,
    promptCacheKey: cacheKey,
    ...(id.effort === null
      ? {}
      : {
          // The SDK type lacks "max" and "ultra". The backend takes them.
          reasoningEffort: id.effort as OpenAIResponsesProviderOptions["reasoningEffort"],
        }),
  };
}
