import { dependencyVersions } from "@bfe/core";

export { ARMS, findArm } from "./arms.ts";
export type { Arm } from "./arms.ts";
export { sandboxBash } from "./sandbox-bash.ts";

/** Installed versions of this package's npm dependencies, `@better-fs-tools/*` among them. */
export const toolPackageVersions = () =>
  dependencyVersions(new URL("../package.json", import.meta.url));
export {
  BFT_EDIT_ARM,
  BFT_EDIT_SYSTEM_PROMPT,
  D52_TOOLS_ARM,
  findRelayArm,
  RELAY_ARMS,
} from "./relay/relay-arms.ts";
export type { RelayArm, RelaySession, ToolCallRecord } from "./relay/relay-arms.ts";
export {
  bwrapCommand,
  D52_NUDGE,
  D52_SYSTEM_PROMPT,
  d52UserPrompt,
  deleteFileTool,
  runPython,
} from "./relay/d52-tools.ts";
export { workspaceFiles } from "./relay/workspace-files.ts";
