import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolExecutionOptions, ToolSet } from "ai";

import { ARMS, findArm } from "../src/arms.ts";

let root: string;
let sequence = 0;
const execution = { toolCallId: "offline", messages: [], context: undefined };
function invoke(tool: ToolSet[string], input: unknown): Promise<unknown> {
  return (
    tool as { execute(input: unknown, options: ToolExecutionOptions<unknown>): Promise<unknown> }
  ).execute(input, execution);
}
beforeAll(async () => {
  root = await mkdtemp(join(process.env.BFT_EVAL_TEST_ROOT ?? tmpdir(), "arms-test-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function workspace(): Promise<string> {
  const dir = join(root, String(sequence++));
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("arms", () => {
  const names = {
    edit: ["read", "edit", "write"],
    patch: ["read", "apply_patch"],
    "edit-plain": ["read", "edit", "write"],
    "bash-read-edit": ["bash", "read", "edit", "write"],
    "edit-exact": ["read", "edit", "write"],
    bash: ["bash"],
  };
  test("only the six approved arms are listed", () =>
    expect(ARMS.map((a) => a.name)).toEqual(Object.keys(names)));
  for (const [name, tools] of Object.entries(names))
    test(`${name} tools and no required read`, async () => {
      const actual = await workspace();
      const arm = findArm(name);
      const built = arm.tools(actual);
      expect(Object.keys(built)).toEqual(tools);
      if (name === "bash") expect(built.bash!.description).not.toContain("Prefer the read");
      expect(arm.requireRead).toBe("off");
      for (const tool of tools.filter((t) => ["edit", "write", "apply_patch"].includes(t))) {
        await writeFile(join(actual, "a.txt"), "hello\n");
        // A new tool set ensures that no state was inherited from another mutation.
        const mutation = arm.tools(actual)[tool]!;
        const input =
          tool === "edit"
            ? { path: "a.txt", old_string: "hello", new_string: "world", replace_all: null }
            : tool === "write"
              ? { path: "a.txt", content: "world\n" }
              : {
                  patch:
                    "*** Begin Patch\n*** Update File: a.txt\n@@\n-hello\n+world\n*** End Patch",
                };
        const result = (await invoke(mutation, input)) as { status: string };
        expect(result.status).toBe("ok");
        expect(await readFile(join(actual, "a.txt"), "utf8")).toBe("world\n");
      }
    });
  test("exact arm rejects a normalized-only match", async () => {
    const actual = await workspace();
    await writeFile(join(actual, "a.txt"), "A B\n");
    const tool = findArm("edit-exact").tools(actual).edit!;
    const result = (await invoke(tool, {
      path: "a.txt",
      old_string: "A B",
      new_string: "changed",
      replace_all: null,
    })) as { error: { code: string } };
    expect(result.error.code).toBe("NO_MATCH");
  });
});
