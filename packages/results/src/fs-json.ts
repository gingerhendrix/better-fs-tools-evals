import { readdir, readFile, stat } from "node:fs/promises";

/** Reads a JSON file. A missing or broken file gives null, so a stopped run still shows. */
export async function readJson<T>(file: string): Promise<T | null> {
  if (!(await stat(file).catch(() => null))) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Folder names in a folder, sorted. A missing folder gives an empty list. */
export async function subdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** File names in a folder, sorted. */
export async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

export const sum = (counts: Record<string, number>) =>
  Object.values(counts).reduce((a, b) => a + b, 0);
export const str = (v: unknown) => (typeof v === "string" ? v : null);
export const num = (v: unknown) => (typeof v === "number" ? v : null);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
