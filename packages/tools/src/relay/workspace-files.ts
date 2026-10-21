import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Regular files under `root`, as sorted paths relative to it. */
export async function workspaceFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await workspaceFiles(root, full)));
    else if (entry.isFile()) out.push(relative(root, full));
  }
  return out.sort();
}

/** The absolute path for a model-given name, or null when it leaves the workspace. */
export function insideWorkspace(cwd: string, name: string): string | null {
  if (name === "" || isAbsolute(name)) return null;
  const full = resolve(cwd, name);
  const rel = relative(cwd, full);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : full;
}
