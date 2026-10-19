import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadTrace, partsText } from "../src/trace.ts";

let dir: string;

const jsonl = (lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "viewer-trace-"));
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("loadTrace", () => {
  test("reads a Chat Completions run: system, prompt, tools, and the tool text the model saw", async () => {
    const run = join(dir, "chat");
    await Bun.write(
      join(run, "steps.jsonl"),
      jsonl([
        {
          step: 0,
          finishReason: "tool-calls",
          usage: { inputTokens: 10 },
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "read",
              input: { path: "a.js" },
              providerMetadata: { x: 1 },
            },
            { type: "tool-result", toolCallId: "c1", toolName: "read", output: { status: "ok" } },
          ],
        },
      ]),
    );
    const request = (messages: unknown[]) => ({
      at: "2026-10-17T00:00:00Z",
      ms: 5,
      status: 200,
      request: {
        messages,
        tools: [
          {
            type: "function",
            function: { name: "read", description: "Read a file", parameters: {} },
          },
        ],
      },
      response: "data: ...",
    });
    const base = [
      { role: "system", content: "Be exact." },
      { role: "user", content: "Fix the bug" },
    ];
    await Bun.write(
      join(run, "http.jsonl"),
      jsonl([
        request(base),
        request([
          ...base,
          { role: "assistant", tool_calls: [] },
          {
            role: "tool",
            tool_call_id: "c1",
            content: '[{"type":"text","text":"1|const a = 1;"}]',
          },
        ]),
        { ...request(base), status: 429, response: "rate limited" },
      ]),
    );

    const trace = await loadTrace(run);
    expect(trace.system).toBe("Be exact.");
    expect(trace.prompt).toBe("Fix the bug");
    expect(trace.tools).toEqual([{ name: "read", description: "Read a file", parameters: {} }]);
    expect(trace.toolOutputs).toEqual({ c1: "1|const a = 1;" });
    expect(trace.steps[0]!.content[0]).not.toHaveProperty("providerMetadata");
    expect(trace.http.map((h) => [h.status, h.error])).toEqual([
      [200, null],
      [200, null],
      [429, "rate limited"],
    ]);
    expect(trace.result).toBeNull();
  });

  test("reads a Codex Responses run: instructions, input_text, and function_call_output", async () => {
    const run = join(dir, "responses");
    await Bun.write(
      join(run, "http.jsonl"),
      jsonl([
        {
          status: 200,
          request: {
            instructions: "System text",
            input: [
              { role: "user", content: [{ type: "input_text", text: "Task text" }] },
              { type: "function_call", call_id: "c9", name: "write", arguments: "{}" },
              { type: "function_call_output", call_id: "c9", output: "Updated a.js" },
            ],
            tools: [{ type: "function", name: "write", description: "Write", parameters: null }],
          },
        },
      ]),
    );
    const trace = await loadTrace(run);
    expect(trace.system).toBe("System text");
    expect(trace.prompt).toBe("Task text");
    expect(trace.tools.map((t) => t.name)).toEqual(["write"]);
    expect(trace.toolOutputs).toEqual({ c9: "Updated a.js" });
    expect(trace.steps).toEqual([]);
  });

  test("skips a partial last line from a killed run", async () => {
    const run = join(dir, "partial");
    await Bun.write(
      join(run, "steps.jsonl"),
      `${JSON.stringify({ step: 0, content: [] })}\n{"step":1,"cont`,
    );
    expect((await loadTrace(run)).steps).toHaveLength(1);
  });
});

describe("partsText", () => {
  test("joins part lists and decodes a JSON-encoded part list", () => {
    expect(partsText([{ type: "text", text: "a" }, { type: "input_image" }])).toBe("a\n[image]");
    expect(partsText('[{"type":"text","text":"b"}]')).toBe("b");
  });

  test("leaves text that only looks like JSON alone", () => {
    expect(partsText("[1, 2]")).toBe("[1, 2]");
    expect(partsText('[{"a":1}]')).toBe('[{"a":1}]');
    expect(partsText("[{ not json")).toBe("[{ not json");
  });
});
