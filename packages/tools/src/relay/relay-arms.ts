import type { ToolSet } from "ai";

import { findArm } from "../arms.ts";
import type { Arm } from "../arms.ts";
import {
  D52_NUDGE,
  D52_SYSTEM_PROMPT,
  d52Tools,
  d52UserPrompt,
  deleteFileTool,
} from "./d52-tools.ts";
import type { D52State } from "./d52-tools.ts";

/** One tool call as the session saw it. */
export interface ToolCallRecord {
  readonly tool: string;
  /** The file name argument, when the tool has one. */
  readonly file: string | null;
  /** A string result that starts with "Error", or a run_python exit code note. */
  readonly error: string | null;
}

/** The tools for one interaction, with the counters the relay reads after the loop. */
export interface RelaySession {
  readonly tools: ToolSet;
  /** A write tool ran. Upstream counts `write_file` and `run_python`, even when they fail. */
  wrote(): boolean;
  /** The model called `finish` after a write. */
  finished(): boolean;
  calls(): readonly ToolCallRecord[];
}

/**
 * An arm for relay benchmarks. It owns its prompts, because the d52-tools arm
 * is a port of the upstream harness, prompt included.
 */
export interface RelayArm extends Arm {
  readonly codeExecution: boolean;
  /** Tools that count as a write for the nudge and the finish check. */
  readonly writeTools: readonly string[];
  /** Sent once when the model stops with no tool call before any write. */
  readonly nudge: string;
  system(targetFiles: readonly string[]): string;
  user(files: readonly string[], task: string): string;
  session(cwd: string): RelaySession;
}

function track(tools: ToolSet, writeTools: readonly string[], state: D52State) {
  const calls: ToolCallRecord[] = [];
  const wrapped: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const execute = t.execute;
    if (execute === undefined) {
      wrapped[name] = t;
      continue;
    }
    wrapped[name] = {
      ...t,
      execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
        if (writeTools.includes(name)) state.wrote = true;
        const args = (input ?? {}) as { filename?: unknown; path?: unknown };
        const file =
          typeof args.filename === "string"
            ? args.filename
            : typeof args.path === "string"
              ? args.path
              : null;
        const result: unknown = await execute(input as never, options);
        calls.push({ tool: name, file, error: stringError(name, result) });
        return result;
      },
    } as ToolSet[string];
  }
  return { tools: wrapped, calls };
}

function stringError(tool: string, result: unknown): string | null {
  if (typeof result !== "string") return null;
  if (result.startsWith("Error: you must make")) return "finish-refused";
  if (result.startsWith("Error: script timed out")) return "timeout";
  if (result.startsWith("Error: file") && result.includes("not found")) return "not-found";
  if (result.startsWith("Error: file") && result.includes("outside")) return "outside";
  if (result.startsWith("Error")) return "error";
  if (tool === "run_python" && /\n\(exit code \d+\)$/.test(result)) return "exit";
  return null;
}

function session(tools: ToolSet, writeTools: readonly string[], state: D52State): RelaySession {
  const tracked = track(tools, writeTools, state);
  return {
    tools: tracked.tools,
    wrote: () => state.wrote,
    finished: () => state.finished,
    calls: () => tracked.calls,
  };
}

const D52_WRITE_TOOLS = ["write_file", "run_python"];

/** The upstream DELEGATE-52 tool harness. */
export const D52_TOOLS_ARM: RelayArm = {
  name: "d52-tools",
  description: "read_file + write_file + delete_file + run_python (bwrap) + finish (upstream port)",
  editTool: "write_file",
  toolNames: ["read_file", "write_file", "delete_file", "run_python", "finish"],
  requireRead: "off",
  matchers: [],
  codeExecution: true,
  writeTools: D52_WRITE_TOOLS,
  nudge: D52_NUDGE,
  system: (targetFiles) => D52_SYSTEM_PROMPT.replace("{target_filenames}", targetFiles.join(", ")),
  user: (files, task) => d52UserPrompt(files, task),
  session: (cwd) => {
    const state = { wrote: false, finished: false };
    return session(d52Tools(cwd, state), D52_WRITE_TOOLS, state);
  },
  tools: (cwd) => D52_TOOLS_ARM.session(cwd).tools,
};

const BFT_WRITE_TOOLS = ["edit", "write"];

/**
 * The upstream prompt with our tool names. The "programmatically or directly"
 * line is dropped, because this arm cannot run code. With no finish tool,
 * the model ends by replying with no tool call.
 */
export const BFT_EDIT_SYSTEM_PROMPT = `You are a document editing assistant. You have a workspace containing files that you need to transform according to the user's instructions.

Available tools:
- read(path): read a file's contents, with line numbers
- edit(path, ...): replace text in a file
- write(path, content): create or overwrite a file
- delete_file(path): remove a file from the workspace

After editing, your workspace must contain exactly these files: {target_filenames}
IMPORTANT: Double-check that your output filenames match the target filenames exactly (including spelling, extensions, and casing). Incorrect filenames will cause evaluation to fail.
Do NOT create or modify files named __init__.py or testing.py — these are scaffold files managed by the evaluation harness and must not be touched.
Reply without a tool call when you are satisfied with the result.
`;

/** Our `edit` arm (gutter read, edit, write, read-before-write off) plus a harness delete_file. */
export const BFT_EDIT_ARM: RelayArm = {
  name: "bft-edit",
  description: "read + edit + write (Better FS Tools, requireRead off) + delete_file (harness)",
  editTool: "edit or write",
  toolNames: ["read", "edit", "write", "delete_file"],
  requireRead: "off",
  matchers: findArm("edit").matchers,
  codeExecution: false,
  writeTools: BFT_WRITE_TOOLS,
  nudge:
    "You haven't made any edits yet. Please use the tools (read, edit, write) to complete the task, then reply without a tool call.",
  system: (targetFiles) =>
    BFT_EDIT_SYSTEM_PROMPT.replace("{target_filenames}", targetFiles.join(", ")),
  user: (files, task) => d52UserPrompt(files, task, "read"),
  session: (cwd) => {
    const state = { wrote: false, finished: false };
    const tools = { ...findArm("edit").tools(cwd), delete_file: deleteFileTool(cwd, "path") };
    return session(tools, BFT_WRITE_TOOLS, state);
  },
  tools: (cwd) => BFT_EDIT_ARM.session(cwd).tools,
};

export const RELAY_ARMS: readonly RelayArm[] = [D52_TOOLS_ARM, BFT_EDIT_ARM];

export function findRelayArm(name: string): RelayArm {
  const found = RELAY_ARMS.find((a) => a.name === name);
  if (found === undefined) {
    throw new Error(
      `unknown relay arm "${name}". Known: ${RELAY_ARMS.map((a) => a.name).join(", ")}`,
    );
  }
  return found;
}
