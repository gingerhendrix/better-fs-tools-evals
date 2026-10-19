import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAiSdkBashTool } from "@better-fs-tools/ai-sdk";
import { nodeCommandRunner } from "@better-fs-tools/node";
import { shellEnv } from "@better-fs-tools/shell";
import { defaultBashSignature } from "@better-fs-tools/shell/signature";

/** The wrapper is outside the workspace and is never mounted in the sandbox. */
export function sandboxBash(cwd: string) {
  cwd = resolve(cwd);
  const runner = nodeCommandRunner({
    cwd,
    shell: fileURLToPath(new URL("./sandbox-shell.sh", import.meta.url)),
    id: "bwrap",
  });
  return createAiSdkBashTool({
    runner: { ...runner, run: (request) => runner.run({ ...request, cwd }) },
    signature: defaultBashSignature({ runner: "bwrap", cwd: false }),
    env: shellEnv({ PATH: "/usr/bin:/bin", BFT_EVAL_WORKSPACE: cwd }),
  });
}
