import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { CellResult } from "@bfe/core";

/** Returns the saved result when the cell already ran, so a matrix can resume. */
export async function readCellResult(dir: string): Promise<CellResult | null> {
  const file = join(dir, "result.json");
  if (!(await stat(file).catch(() => null))) return null;
  return JSON.parse(await readFile(file, "utf8")) as CellResult;
}

/** Reads every `result.json` under `<runDir>/runs`. */
export async function collectResults(runDir: string): Promise<CellResult[]> {
  const found: CellResult[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name === "result.json")
        found.push(JSON.parse(await readFile(p, "utf8")) as CellResult);
    }
  };
  await walk(join(runDir, "runs"));
  return found;
}
