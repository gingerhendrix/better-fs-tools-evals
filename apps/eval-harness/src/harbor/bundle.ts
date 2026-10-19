import { createAiSdkFsTools } from "@better-fs-tools/ai-sdk";
import { nodeDigest } from "@better-fs-tools/node";
import { shellEnv } from "@better-fs-tools/shell";
import type { ToolSet } from "ai";

import type { Container } from "./docker-exec.ts";
import { dockerFileSystem } from "./docker-fs.ts";
import { dockerCommandRunner } from "./docker-runner.ts";

/**
 * The tool sets a Harbor run can give the model. `default` is the bundle
 * with its defaults plus bash. The others keep bash and change which file
 * tools sit beside it, so a pair of sets answers one question.
 */
export const HARBOR_TOOL_SETS = ["default", "bash", "bash-read-edit", "bash-read-patch"] as const;
export type HarborToolSet = (typeof HARBOR_TOOL_SETS)[number];

interface ToolSetSpec {
  /** Tool names, in the order the model sees them. */
  readonly tools: readonly string[];
  /** The file-tool sentence of the bash description, or "" to drop it. */
  readonly bashFileHint: string;
  /** The file-tool sentence of the system prompt. */
  readonly promptFileHint: string;
}

const SPECS: Record<HarborToolSet, ToolSetSpec> = {
  default: {
    tools: ["read", "edit", "write", "bash"],
    bashFileHint: "Prefer the read, edit, and write tools for files.",
    promptFileHint: "Use read, edit, and write for files.",
  },
  bash: {
    tools: ["bash"],
    bashFileHint: "",
    promptFileHint: "Use bash for files too: to read, create, and change them.",
  },
  "bash-read-edit": {
    tools: ["bash", "read", "edit"],
    bashFileHint: "Prefer the read and edit tools for files.",
    promptFileHint: "Use read and edit for files.",
  },
  "bash-read-patch": {
    tools: ["bash", "read", "apply_patch"],
    bashFileHint: "Prefer the read and apply_patch tools for files.",
    promptFileHint: "Use read and apply_patch for files.",
  },
};

const BASH_FILE_HINT = "Prefer the read, edit, and write tools for files.";
const EDIT_WRITE_HINT = "To create a file or replace all of its content, use the write tool.";

export function parseHarborToolSet(value: string): HarborToolSet {
  const found = HARBOR_TOOL_SETS.find((set) => set === value);
  if (found === undefined) {
    throw new Error(`unknown tool set "${value}". Known: ${HARBOR_TOOL_SETS.join(", ")}`);
  }
  return found;
}

/**
 * The bundle with its defaults: no read store (so no read-before-write), the
 * default matchers, and the default reply. Only the backend, the digest, and
 * bash are given, because the bundle needs them to run in a container. The
 * tool set picks which tools the model gets. A description that names a tool
 * outside the set is changed so that it names only tools in the set.
 */
export function harborTools(box: Container, cwd: string, set: HarborToolSet): ToolSet {
  const spec = SPECS[set];
  const { tools } = createAiSdkFsTools({
    fs: dockerFileSystem({ container: box, cwd }),
    digest: nodeDigest(),
    applyPatch: spec.tools.includes("apply_patch"),
    bash: { runner: dockerCommandRunner(box, cwd), env: shellEnv() },
  });
  const picked: ToolSet = {};
  for (const name of spec.tools) {
    const tool = tools[name];
    if (tool === undefined) throw new Error(`the bundle has no tool named ${name}`);
    picked[name] = {
      ...tool,
      description: describe(name, tool.description, spec),
    } as ToolSet[string];
  }
  return picked;
}

function describe(name: string, description: string, spec: ToolSetSpec): string {
  if (name === "bash") return replaceSentence(description, BASH_FILE_HINT, spec.bashFileHint);
  if (name === "edit" && !spec.tools.includes("write")) {
    return replaceSentence(description, EDIT_WRITE_HINT, "");
  }
  return description;
}

/** Throws when the sentence is missing, so a change to the bundle text is not missed. */
function replaceSentence(text: string, sentence: string, replacement: string): string {
  if (!text.includes(sentence)) throw new Error(`description has no sentence "${sentence}"`);
  if (replacement === "") return text.replace(sentence, "").replace(/ {2,}/g, " ").trim();
  return text.replace(sentence, replacement);
}

export function harborSystemPrompt(cwd: string, set: HarborToolSet = "default"): string {
  return `You are an autonomous agent working in a Linux container. Complete the task the user gives you, using your tools. No one will answer questions, so do not stop to ask for confirmation.

The working directory is ${cwd}. Relative paths resolve against it. Use bash to explore, install, build, run code, and test. ${SPECS[set].promptFileHint}

When the task is complete, reply with a short summary and no tool call.`;
}
