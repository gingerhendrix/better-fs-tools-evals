import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { RunMetrics } from "@bfe/core";
import type { LanguageModelUsage, ToolSet } from "ai";

/** The content parts of one step that the counters read. */
export type StepPart =
  | { readonly type: "tool-call"; readonly toolName: string; readonly input: unknown }
  | { readonly type: "tool-result"; readonly toolName: string; readonly output: unknown }
  | { readonly type: "tool-error"; readonly toolName: string; readonly error: unknown }
  | { readonly type: string };

export function addUsage(m: RunMetrics, usage: LanguageModelUsage): void {
  m.inputTokens += usage.inputTokens ?? 0;
  m.cachedInputTokens += usage.inputTokenDetails?.cacheReadTokens ?? 0;
  m.outputTokens += usage.outputTokens ?? 0;
  m.reasoningTokens += usage.outputTokenDetails?.reasoningTokens ?? 0;
}

export function addStep(m: RunMetrics, parts: readonly StepPart[]): void {
  m.steps += 1;
  for (const part of parts) {
    if (part.type === "tool-call" && "toolName" in part && "input" in part) {
      bump(m.toolCalls, part.toolName);
      m.toolInputChars += JSON.stringify(part.input ?? null).length;
    } else if (part.type === "tool-result" && "output" in part) {
      countResult(m, part.toolName, part.output);
    } else if (part.type === "tool-error" && "error" in part) {
      bump(m.toolErrors, `${part.toolName}:${errorKind(part.error)}`);
    }
  }
}

/**
 * Better FS Tools results carry `status` and a code. Read failures put the
 * code on the result. Write failures put it on `error.code`.
 */
function countResult(m: RunMetrics, tool: string, output: unknown): void {
  if (output === null || typeof output !== "object") return;
  const o = output as {
    status?: string;
    code?: string;
    error?: { code?: string } | null;
    notes?: readonly { code?: string }[];
  };
  if (o.status === "error" || o.status === "unsupported") {
    bump(m.toolErrors, `${tool}:${o.error?.code ?? o.code ?? "unknown"}`);
  }
  for (const note of o.notes ?? []) {
    if (typeof note.code === "string") bump(m.notes, `${tool}:${note.code}`);
  }
}

/**
 * Errors that never reached the tool, or that the tool threw. AI SDK gives
 * an Error or its message string, so both are matched by text.
 */
export function errorKind(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/JSONParseError|JSON pars/i.test(text)) return "bad-json";
  if (/NoSuchTool/i.test(text)) return "unknown-tool";
  if (/InvalidToolInput|TypeValidation|schema|validat/i.test(text)) return "schema";
  return "thrown";
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/** Observe the current file size before write executes, including failed writes. */
export function instrumentWrites(
  tools: ToolSet,
  cwd: string,
  counters: { shortWriteCalls: number },
): ToolSet {
  const write = tools.write;
  if (!write?.execute) return tools;
  const execute = write.execute;
  return {
    ...tools,
    write: {
      ...write,
      execute: async (input, options) => {
        if (input !== null && typeof input === "object") {
          const args = input as { path?: unknown; content?: unknown };
          if (typeof args.path === "string" && typeof args.content === "string") {
            const path = await realpath(resolve(cwd, args.path)).catch(() => null);
            const rel = path === null ? ".." : relative(cwd, path);
            const size =
              rel.startsWith("..") || isAbsolute(rel) ? null : await lstat(path!).catch(() => null);
            if (size?.isFile() && Buffer.byteLength(args.content, "utf8") < size.size / 2)
              counters.shortWriteCalls++;
          }
        }
        return execute(input, options);
      },
    },
  };
}
