import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readJson } from "./catalog.ts";

/** One line of `steps.jsonl`, with provider metadata removed. */
export interface TraceStep {
  readonly step: number;
  readonly finishReason: string | null;
  readonly usage: Record<string, unknown> | null;
  readonly content: ReadonlyArray<Record<string, unknown>>;
}

export interface TraceTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
}

export interface HttpCall {
  readonly at: string | null;
  readonly ms: number | null;
  readonly status: number | null;
  /** The start of the response body, for non-200 calls only. */
  readonly error: string | null;
}

export interface Trace {
  readonly result: unknown;
  readonly system: string | null;
  readonly prompt: string | null;
  readonly tools: readonly TraceTool[];
  readonly steps: readonly TraceStep[];
  /** Tool call id to the text the model received, from the next request body. */
  readonly toolOutputs: Record<string, string>;
  readonly http: readonly HttpCall[];
}

/** Reads one cell folder. Every file is optional, so a run that stopped early still shows. */
export async function loadTrace(dir: string): Promise<Trace> {
  const steps = (await readJsonLines(join(dir, "steps.jsonl"))).map(toStep);
  const requests = await readJsonLines(join(dir, "http.jsonl"));
  const first = requests[0]?.request;
  const toolOutputs: Record<string, string> = {};
  for (const line of requests) collectToolOutputs(line.request, toolOutputs);
  return {
    result: await readJson(join(dir, "result.json")),
    system: isRecord(first) ? systemText(first) : null,
    prompt: isRecord(first) ? promptText(first) : null,
    tools: isRecord(first) && Array.isArray(first.tools) ? first.tools.map(toTool) : [],
    steps,
    toolOutputs,
    http: requests.map(toHttpCall),
  };
}

async function readJsonLines(file: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(file, "utf8").catch(() => "");
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) out.push(value);
    } catch {
      // A run killed mid-write can leave a partial last line.
    }
  }
  return out;
}

function toStep(line: Record<string, unknown>): TraceStep {
  const content = Array.isArray(line.content) ? line.content.filter(isRecord) : [];
  return {
    step: typeof line.step === "number" ? line.step : 0,
    finishReason: typeof line.finishReason === "string" ? line.finishReason : null,
    usage: isRecord(line.usage) ? line.usage : null,
    content: content.map(({ providerMetadata: _drop, ...part }) => part),
  };
}

/** Chat Completions puts the system prompt in `messages`; the Codex Responses API uses `instructions`. */
function systemText(request: Record<string, unknown>): string | null {
  if (typeof request.instructions === "string") return request.instructions;
  const system = messages(request).find((m) => m.role === "system");
  return system === undefined ? null : partsText(system.content);
}

function promptText(request: Record<string, unknown>): string | null {
  const user = messages(request).find((m) => m.role === "user");
  return user === undefined ? null : partsText(user.content);
}

function collectToolOutputs(request: unknown, into: Record<string, string>): void {
  if (!isRecord(request)) return;
  for (const item of messages(request)) {
    if (item.role === "tool" && typeof item.tool_call_id === "string") {
      into[item.tool_call_id] = partsText(item.content);
    } else if (item.type === "function_call_output" && typeof item.call_id === "string") {
      into[item.call_id] = partsText(item.output);
    }
  }
}

function messages(request: Record<string, unknown>): Array<Record<string, unknown>> {
  const list = request.messages ?? request.input;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

/** Flattens a string, a JSON-encoded part list, or a part list to plain text. */
export function partsText(value: unknown): string {
  if (typeof value === "string") {
    if (!value.startsWith("[{")) return value;
    try {
      const parts: unknown = JSON.parse(value);
      const isPartList = Array.isArray(parts) && parts.every((p) => isRecord(p) && "type" in p);
      return isPartList ? partsText(parts) : value;
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(partsText).join("\n");
  if (isRecord(value)) {
    if (typeof value.text === "string") return value.text;
    if (typeof value.type === "string" && value.type.includes("image")) return "[image]";
  }
  return JSON.stringify(value);
}

function toTool(tool: unknown): TraceTool {
  const t = isRecord(tool) && isRecord(tool.function) ? tool.function : tool;
  if (!isRecord(t)) return { name: "?", description: "", parameters: null };
  return {
    name: String(t.name ?? "?"),
    description: typeof t.description === "string" ? t.description : "",
    parameters: t.parameters ?? null,
  };
}

function toHttpCall(line: Record<string, unknown>): HttpCall {
  const status = typeof line.status === "number" ? line.status : null;
  const body = typeof line.response === "string" ? line.response : JSON.stringify(line.response);
  return {
    at: typeof line.at === "string" ? line.at : null,
    ms: typeof line.ms === "number" ? line.ms : null,
    status,
    error: status !== 200 ? (body ?? "").slice(0, 2000) : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
