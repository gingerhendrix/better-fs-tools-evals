import { describe, expect, test } from "bun:test";

import {
  HARBOR_TOOL_SETS,
  harborSystemPrompt,
  harborTools,
  parseHarborToolSet,
} from "../../src/harbor/bundle.ts";

// Building the tools runs no docker command, so no container is needed.
const box = { id: "unused", user: null };

function descriptions(set: (typeof HARBOR_TOOL_SETS)[number]): Record<string, string> {
  const tools = harborTools(box, "/app", set);
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, String(tool.description)]),
  );
}

describe("harborTools", () => {
  test("each set gives the named tools", () => {
    expect(Object.keys(harborTools(box, "/app", "default"))).toEqual([
      "read",
      "edit",
      "write",
      "bash",
    ]);
    expect(Object.keys(harborTools(box, "/app", "bash"))).toEqual(["bash"]);
    expect(Object.keys(harborTools(box, "/app", "bash-read-edit"))).toEqual([
      "bash",
      "read",
      "edit",
    ]);
    expect(Object.keys(harborTools(box, "/app", "bash-read-patch"))).toEqual([
      "bash",
      "read",
      "apply_patch",
    ]);
  });

  test("the default set keeps the bundle descriptions", () => {
    const text = descriptions("default");
    expect(text.bash).toContain("Prefer the read, edit, and write tools for files.");
    expect(text.edit).toContain("use the write tool");
  });

  test("no description names a tool outside its set", () => {
    expect(descriptions("bash").bash).not.toContain("Prefer the");
    const edit = descriptions("bash-read-edit");
    expect(edit.bash).toContain("Prefer the read and edit tools for files.");
    expect(edit.edit).not.toContain("write tool");
    const patch = descriptions("bash-read-patch");
    expect(patch.bash).toContain("Prefer the read and apply_patch tools for files.");
    expect(patch.bash).not.toContain("edit");
  });

  test("the system prompt names only tools in the set", () => {
    expect(harborSystemPrompt("/app")).toContain("Use read, edit, and write for files.");
    expect(harborSystemPrompt("/app", "bash")).toContain("Use bash for files too");
    expect(harborSystemPrompt("/app", "bash-read-patch")).toContain(
      "Use read and apply_patch for files.",
    );
  });
});

describe("parseHarborToolSet", () => {
  test("accepts a known set and refuses an unknown one", () => {
    expect(parseHarborToolSet("bash-read-edit")).toBe("bash-read-edit");
    expect(() => parseHarborToolSet("bash-write")).toThrow(/unknown tool set/);
  });
});
