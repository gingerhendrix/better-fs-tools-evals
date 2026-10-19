import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import { codexOAuthModel, parseCodexModelId } from "./codex-oauth/model.ts";
import { loggingFetch } from "./http-log.ts";

export const COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1";

/**
 * The model for a harness model id. `codex-oauth:<model>[:<effort>]` runs a
 * GPT model on the ChatGPT subscription. Any other id is a Command Code id.
 */
export function evalModel(modelId: string, httpLog?: string): LanguageModel {
  const codex = parseCodexModelId(modelId);
  return codex === null ? commandCodeModel(modelId, httpLog) : codexOAuthModel(codex, httpLog);
}

export function commandCodeApiKey(): string {
  const key = process.env.COMMANDCODE_API_KEY ?? process.env.AA_COMMANDCODE_API_KEY;
  if (key === undefined || key === "") {
    throw new Error("set COMMANDCODE_API_KEY (or AA_COMMANDCODE_API_KEY)");
  }
  return key;
}

/**
 * A Command Code chat-completions model. When `httpLog` is set, every request
 * and response body goes to that JSONL file, so a run can be audited later.
 */
export function commandCodeModel(modelId: string, httpLog?: string): LanguageModel {
  const provider = createOpenAICompatible({
    name: "commandcode",
    baseURL: COMMAND_CODE_BASE_URL,
    apiKey: commandCodeApiKey(),
    includeUsage: true,
    ...(httpLog === undefined ? {} : { fetch: loggingFetch(httpLog) }),
  });
  return provider.chatModel(modelId);
}
