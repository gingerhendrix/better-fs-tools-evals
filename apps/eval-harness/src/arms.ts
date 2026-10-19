import type { ToolSet } from "ai";

import {
  createAiSdkApplyPatchTool,
  createAiSdkEditTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "@better-fs-tools/ai-sdk";
import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { memoryStore, plainFormatter } from "@better-fs-tools/read";
import { exactMatcher, memoryLocks } from "@better-fs-tools/write";

import { sandboxBash } from "./sandbox-bash.ts";

export interface Arm {
  readonly name: string;
  readonly description: string;
  /** Retained for the OMP system prompt. */
  readonly editTool: string;
  readonly toolNames: readonly string[];
  readonly requireRead: "off";
  readonly matchers: readonly string[];
  tools(cwd: string): ToolSet;
}

type Mutation = "edit" | "apply_patch" | "write";

function buildTools(cwd: string, spec: Arm): ToolSet {
  const shared = {
    fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
    state: memoryStore(),
    digest: nodeDigest(),
  };
  const mutation = {
    ...shared,
    locks: memoryLocks(),
    preconditions: { requireRead: "off" as const },
  };
  const tools: ToolSet = {};
  for (const name of spec.toolNames) {
    const tool =
      name === "bash"
        ? sandboxBash(cwd)
        : name === "read"
          ? createAiSdkReadTool({
              ...shared,
              ...(spec.name === "edit-plain" ? { formatter: plainFormatter() } : {}),
            })
          : name === "edit"
            ? createAiSdkEditTool({
                ...mutation,
                ...(spec.name === "edit-exact" ? { matchers: [exactMatcher()] } : {}),
              })
            : name === "write"
              ? createAiSdkWriteTool(mutation)
              : createAiSdkApplyPatchTool(mutation);
    tools[name] = (
      spec.name === "bash"
        ? {
            ...tool,
            description: tool.description
              .replace("Prefer the read, edit, and write tools for files.", "")
              .trim(),
          }
        : tool
    ) as ToolSet[string];
  }
  return tools;
}

function arm(name: string, toolNames: readonly string[], mutations: readonly Mutation[]): Arm {
  const spec: Arm = {
    name,
    description: toolNames.join(" + ") + (name === "edit-plain" ? " (plain read)" : ""),
    editTool: mutations.join(" or ") || "bash",
    toolNames,
    requireRead: "off",
    matchers: toolNames.includes("edit")
      ? name === "edit-exact"
        ? ["exact"]
        : ["exact", "normalized"]
      : [],
    tools: (cwd) => buildTools(cwd, spec),
  };
  return spec;
}

/** Every edit arm includes write. The former write-only arm is removed. */
export const ARMS: readonly Arm[] = [
  arm("edit", ["read", "edit", "write"], ["edit", "write"]),
  arm("patch", ["read", "apply_patch"], ["apply_patch"]),
  arm("edit-plain", ["read", "edit", "write"], ["edit", "write"]),
  arm("bash-read-edit", ["bash", "read", "edit", "write"], ["edit", "write"]),
  arm("edit-exact", ["read", "edit", "write"], ["edit", "write"]),
  arm("bash", ["bash"], []),
];

export function findArm(name: string): Arm {
  const found = ARMS.find((a) => a.name === name);
  if (found === undefined) {
    throw new Error(`unknown arm "${name}". Known: ${ARMS.map((a) => a.name).join(", ")}`);
  }
  return found;
}
