#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

interface GeneratedTask {
  readonly id: string;
  readonly category: string;
  readonly scale: number;
  readonly variant: string;
  readonly prompt: string;
  readonly input: Readonly<Record<string, string>>;
  readonly expected: Readonly<Record<string, string>>;
  readonly fixtureSha256: string;
}

function child(root: string, name: string): string {
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`unsafe fixture path: ${name}`);
  return path;
}

/** Import the MIT generator from the caller's clone. No generator code is vendored. */
export async function exportExplicitEdit(
  clone: string,
  out: string,
  ids?: readonly string[],
): Promise<number> {
  clone = resolve(clone);
  out = resolve(out);
  const upstreamCommit = execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const generator = (await import(
    pathToFileURL(join(clone, "src/suites/explicit-edit/fixtures.ts")).href
  )) as {
    explicitEditTasks(): readonly GeneratedTask[];
  };
  const all = generator.explicitEditTasks();
  const tasks =
    ids === undefined
      ? all
      : ids.map((id) => {
          const task = all.find((task) => task.id === id);
          if (!task) throw new Error(`unknown task: ${id}`);
          return task;
        });
  for (const task of tasks) {
    const dir = child(out, task.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.md"), task.prompt);
    for (const tree of ["input", "expected"] as const) {
      for (const [name, content] of Object.entries(task[tree])) {
        const target = child(join(dir, tree), name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }
    }
    await writeFile(
      join(dir, "metadata.json"),
      JSON.stringify(
        {
          verify: "exact",
          family: task.category,
          scale: task.scale,
          variant: task.variant,
          fixtureSha256: task.fixtureSha256,
          upstreamCommit,
        },
        null,
        2,
      ) + "\n",
    );
  }
  return tasks.length;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { clone: { type: "string" }, out: { type: "string" }, tasks: { type: "string" } },
  });
  if (!values.clone || !values.out)
    throw new Error("usage: --clone <upstream clone> --out <fixtures> [--tasks id,id]");
  console.log(
    `Exported ${await exportExplicitEdit(values.clone, values.out, values.tasks?.split(","))} tasks`,
  );
}
