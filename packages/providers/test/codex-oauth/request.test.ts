import { describe, expect, test } from "bun:test";

import { codexProviderOptions, parseCodexModelId } from "../../src/codex-oauth/model.ts";
import { codexRequestBody, codexRequestHeaders } from "../../src/codex-oauth/request.ts";

describe("parseCodexModelId", () => {
  test("returns null for Command Code ids", () => {
    expect(parseCodexModelId("deepseek/deepseek-v4.1-flash")).toBeNull();
    expect(parseCodexModelId("gpt-6-luna")).toBeNull();
  });

  test("reads the model and an optional effort", () => {
    expect(parseCodexModelId("codex-oauth:gpt-6-luna")).toEqual({
      model: "gpt-6-luna",
      effort: null,
    });
    expect(parseCodexModelId("codex-oauth:gpt-5.6-terra:high")).toEqual({
      model: "gpt-5.6-terra",
      effort: "high",
    });
  });

  test("rejects an empty model, an unknown effort, and extra parts", () => {
    expect(() => parseCodexModelId("codex-oauth:")).toThrow("bad Codex OAuth model id");
    expect(() => parseCodexModelId("codex-oauth:gpt-6-luna:fast")).toThrow("bad reasoning effort");
    expect(() => parseCodexModelId("codex-oauth:gpt-6-luna:low:x")).toThrow(
      "bad Codex OAuth model id",
    );
  });
});

describe("codexRequestBody", () => {
  test("moves the system message to instructions and drops unsupported fields", () => {
    const body = codexRequestBody({
      model: "gpt-6-luna",
      input: [
        { role: "system", content: "You edit files." },
        { role: "user", content: [{ type: "input_text", text: "Fix it" }] },
      ],
      tools: [],
      stream: true,
      max_output_tokens: 100,
      temperature: 0,
      store: true,
    });
    expect(body).toEqual({
      model: "gpt-6-luna",
      instructions: "You edit files.",
      input: [{ role: "user", content: [{ type: "input_text", text: "Fix it" }] }],
      tools: [],
      stream: true,
      store: false,
    });
  });

  test("keeps instructions that are already set, and adds a default when none exist", () => {
    expect(codexRequestBody({ instructions: "Set", input: [] }).instructions).toBe("Set");
    expect(codexRequestBody({ input: [{ role: "user", content: "hi" }] }).instructions).toBe(
      "You are a helpful assistant.",
    );
  });

  test("moves a developer message too", () => {
    const body = codexRequestBody({ input: [{ role: "developer", content: "Dev" }] });
    expect(body.instructions).toBe("Dev");
    expect(body.input).toEqual([]);
  });
});

describe("codexRequestHeaders", () => {
  test("sets the bearer token, account id, originator, and session id", () => {
    const headers = codexRequestHeaders(
      { "content-type": "application/json", authorization: "Bearer codex-oauth" },
      { access_token: "tok", account_id: "acct" },
      "cache-1",
    );
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("chatgpt-account-id")).toBe("acct");
    expect(headers.get("originator")).toBe("codex_cli_rs");
    expect(headers.get("session-id")).toBe("cache-1");
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("leaves out the session id with no cache key", () => {
    const headers = codexRequestHeaders(
      undefined,
      { access_token: "t", account_id: "a" },
      undefined,
    );
    expect(headers.has("session-id")).toBe(false);
  });
});

describe("codexProviderOptions", () => {
  test("sends the run cache key, so the fetch can set the session-id header", () => {
    expect(codexProviderOptions({ model: "gpt-5.6-luna", effort: null }, "run-1")).toEqual({
      store: false,
      promptCacheKey: "run-1",
    });
    expect(codexProviderOptions({ model: "gpt-5.6-terra", effort: "medium" }, "run-2")).toEqual({
      store: false,
      promptCacheKey: "run-2",
      reasoningEffort: "medium",
    });
  });
});
