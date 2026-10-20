/**
 * A port of the DELEGATE-52 agentic tool harness (`model_agentic.py` in
 * microsoft/DELEGATE52 at b896b80): the tool schemas, the result strings,
 * the bwrap `run_python` sandbox, and the system prompt.
 *
 * Portions copyright (c) Microsoft Corporation, used under the MIT License.
 *
 * Upstream keeps the files in memory. This port keeps them in the
 * interaction's workspace folder, so every arm reads the files back the same way.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { jsonSchema, tool } from "ai";
import type { ToolSet } from "ai";

import { insideWorkspace, workspaceFiles } from "./workspace-files.ts";

export const D52_SYSTEM_PROMPT = `You are a document editing assistant. You have a workspace containing files that you need to transform according to the user's instructions.

Available tools:
- read_file(filename): read a file's full contents
- write_file(filename, content): create or overwrite a file
- delete_file(filename): remove a file from the workspace
- run_python(code): run a Python script (workspace files are at ./workspace/<name>)
- finish(): call this when you're done editing

You can approach the task in whatever way you find most effective: programmatically or directly by writing files.

After editing, your workspace must contain exactly these files: {target_filenames}
IMPORTANT: Double-check that your output filenames match the target filenames exactly (including spelling, extensions, and casing). Incorrect filenames will cause evaluation to fail.
Do NOT create or modify files named __init__.py or testing.py — these are scaffold files managed by the evaluation harness and must not be touched.
Call finish() when you are satisfied with the result.
`;

export const D52_NUDGE =
  "You haven't made any edits yet. Please use the tools (read_file, write_file, run_python) to complete the task, then call finish().";

export const D52_FINISH_REFUSED =
  "Error: you must make at least one change (via write_file or run_python) before calling finish(). Read the files, apply the requested edits, then call finish().";

/** Upstream `run_python` limits. */
export const RUN_PYTHON_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 10_000;
const PYTHON = "/usr/bin/python3";

/** The upstream first user message: the file list only, then the task. */
export function d52UserPrompt(files: readonly string[], task: string, readTool = "read_file") {
  const list = [...files]
    .sort()
    .map((f) => `  - ${f}`)
    .join("\n");
  return `Your workspace contains the following files:\n${list}\n\nUse ${readTool} to inspect any files you need before editing.\n\nTASK:\n${task}`;
}

function schema(description: string) {
  return jsonSchema<{ filename: string }>({
    type: "object",
    properties: { filename: { type: "string", description } },
    required: ["filename"],
  });
}

export interface D52State {
  /** Set by the session wrapper after `write_file` or `run_python`. */
  wrote: boolean;
  finished: boolean;
}

/** The five upstream tools over the folder `cwd`. */
export function d52Tools(cwd: string, state: D52State): ToolSet {
  const notFound = async (name: string) =>
    `Error: file '${name}' not found. Available files: ${(await workspaceFiles(cwd)).join(", ")}`;
  return {
    read_file: tool({
      description: "Read the full contents of a file in the workspace.",
      inputSchema: schema("Name of the file to read."),
      execute: async ({ filename }) => {
        const path = insideWorkspace(cwd, filename);
        const text = path === null ? null : await readFile(path, "utf8").catch(() => null);
        return text ?? (await notFound(filename));
      },
    }),
    write_file: tool({
      description: "Create or overwrite a file with the given content.",
      inputSchema: jsonSchema<{ filename: string; content: string }>({
        type: "object",
        properties: {
          filename: { type: "string", description: "Name of the file to create or overwrite." },
          content: { type: "string", description: "Full file content to write." },
        },
        required: ["filename", "content"],
      }),
      execute: async ({ filename, content }) => {
        const path = insideWorkspace(cwd, filename);
        if (path === null) return `Error: file '${filename}' is outside the workspace.`;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
        return "OK";
      },
    }),
    delete_file: deleteFileTool(cwd, "filename"),
    run_python: tool({
      description:
        "Execute a Python script. Workspace files are accessible at './workspace/<filename>'. Write changes back to './workspace/' to update files. Use print() for any output you want to see.",
      inputSchema: jsonSchema<{ code: string }>({
        type: "object",
        properties: { code: { type: "string", description: "Python code to execute." } },
        required: ["code"],
      }),
      execute: ({ code }) => runPython(cwd, code),
    }),
    finish: tool({
      description:
        "Signal that editing is complete. The current state of all files in the workspace will be used as the final output.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        required: [],
      }),
      execute: async () => {
        if (!state.wrote) return D52_FINISH_REFUSED;
        state.finished = true;
        return "DONE";
      },
    }),
  };
}

/**
 * Upstream `delete_file`. The bft-edit arm uses the same tool with a `path`
 * argument, to match the names of our other tools.
 */
export function deleteFileTool(cwd: string, arg: "filename" | "path"): ToolSet[string] {
  return tool({
    description: "Delete a file from the workspace.",
    inputSchema: jsonSchema<Record<string, string>>({
      type: "object",
      properties: { [arg]: { type: "string", description: "Name of the file to delete." } },
      required: [arg],
    }),
    execute: async (input) => {
      const name = input[arg] ?? "";
      const path = insideWorkspace(cwd, name);
      if (path === null || !(await Bun.file(path).exists())) {
        return `Error: file '${name}' not found.`;
      }
      await rm(path);
      return "OK";
    },
  });
}

/** The upstream `_build_bwrap_cmd` flags. Python is the system interpreter in `/usr`. */
export function bwrapCommand(tmp: string, script: string): string[] {
  return [
    "/usr/bin/bwrap",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--tmpfs",
    "/tmp",
    "--bind",
    tmp,
    tmp,
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--unshare-net",
    "--die-with-parent",
    "--chdir",
    tmp,
    PYTHON,
    script,
  ];
}

/**
 * Upstream `_execute_python`: copy the files to `<tmp>/workspace`, run the
 * script in bwrap with no network and a 30 s limit, then sync the text files
 * back. A file the script deleted is deleted from the workspace too.
 */
export async function runPython(cwd: string, code: string): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), "d52-python-"));
  try {
    const ws = join(tmp, "workspace");
    await cp(cwd, ws, { recursive: true });
    const script = join(tmp, "_script.py");
    await writeFile(script, code);
    let output: string;
    try {
      const proc = Bun.spawn(bwrapCommand(tmp, script), {
        cwd: tmp,
        stdout: "pipe",
        stderr: "pipe",
        timeout: RUN_PYTHON_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (proc.signalCode === "SIGKILL") {
        output = "Error: script timed out after 30 seconds.";
      } else {
        output = stdout;
        if (stderr !== "") output += `\nSTDERR:\n${stderr}`;
        if (exit !== 0) output += `\n(exit code ${exit})`;
      }
    } catch (error) {
      output = `Error executing script: ${error instanceof Error ? error.message : String(error)}`;
    }
    await syncBack(ws, cwd);
    return output.slice(0, OUTPUT_LIMIT);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Copies text files from `from` to `to` and deletes files of `to` that `from` lacks. */
async function syncBack(from: string, to: string): Promise<void> {
  // Upstream syncs nothing when the script removed the workspace folder itself.
  const names = await workspaceFiles(from).catch(() => null);
  if (names === null) return;
  const present = new Set<string>();
  for (const name of names) {
    present.add(name);
    const bytes = await readFile(join(from, name));
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      continue; // Upstream skips binary or unreadable files.
    }
    await mkdir(dirname(join(to, name)), { recursive: true });
    await writeFile(join(to, name), text);
  }
  for (const name of await workspaceFiles(to)) {
    if (!present.has(name)) await rm(join(to, name));
  }
}
