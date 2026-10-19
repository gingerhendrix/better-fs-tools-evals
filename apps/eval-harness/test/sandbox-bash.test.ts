import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sandboxBash } from "../src/sandbox-bash.ts";

// Opt in: BFT_BWRAP_TESTS=1 needs Linux user namespaces and /usr/bin/bwrap.
test.skipIf(process.env.BFT_BWRAP_TESTS !== "1")(
  "bash writes only to the bound workspace on the host",
  async () => {
    const root = await mkdtemp(join(process.env.BFT_EVAL_TEST_ROOT ?? tmpdir(), "ee-sandbox-"));
    try {
      const workspace = join(root, "workspace");
      const outside = join(root, "outside.txt");
      await mkdir(workspace);
      await writeFile(outside, "host sentinel");
      await symlink(outside, join(workspace, "escape"));
      const tool = sandboxBash(workspace);
      const run = (command: string) =>
        tool.execute(
          { command, timeout: null },
          { toolCallId: "offline", messages: [], context: undefined },
        );
      const normal = await run(
        "printf 'inside' > inside.txt; pwd; ls -A /home; test ! -e /home/gareth/.codex/auth.json",
      );
      expect(normal.status).toBe("ok");
      expect(await readFile(join(workspace, "inside.txt"), "utf8")).toBe("inside");
      expect((await run(`test ! -e '${outside}'`)).status).toBe("ok");
      // Under private /tmp, these may create private files. They must never change the host.
      await run(`printf 'escaped' > '${outside}'`);
      await run("printf escaped > escape");
      expect((await run("touch /usr/bft-sandbox-test")).status).toBe("failed");
      expect(await readFile(outside, "utf8")).toBe("host sentinel");
      // Shell env does not inherit a secret from the harness process.
      process.env.BFT_SANDBOX_SECRET = "not-mounted";
      try {
        expect((await run('test -z "$BFT_SANDBOX_SECRET"')).status).toBe("ok");
      } finally {
        delete process.env.BFT_SANDBOX_SECRET;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
