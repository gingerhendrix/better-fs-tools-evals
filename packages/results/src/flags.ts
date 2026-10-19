import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The optional file in a fixtures folder that marks tasks the viewer should score apart. */
export const TASK_FLAGS_FILE = "task-flags.json";

/**
 * Task notes for one fixture set. A flawed task has a defect in the fixture itself,
 * for example an inverted prompt, so a clean score leaves it out.
 */
export interface TaskFlags {
  readonly file: string;
  readonly source: string | null;
  /** Task id to the reason it is flawed. */
  readonly flawed: Readonly<Record<string, string>>;
}

/**
 * Reads `<fixturesDir>/task-flags.json`:
 * `{ "version": 1, "source": "...", "flawed": { "<task id>": "<reason>" } }`.
 * Returns null when the file is missing or has the wrong shape.
 */
export async function loadTaskFlags(fixturesDir: string): Promise<TaskFlags | null> {
  const file = join(fixturesDir, TASK_FLAGS_FILE);
  const raw: unknown = await readFile(file, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => null);
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.flawed)) return null;
  const flawed: Record<string, string> = {};
  for (const [task, reason] of Object.entries(raw.flawed)) {
    if (typeof reason === "string") flawed[task] = reason;
  }
  return { file, source: typeof raw.source === "string" ? raw.source : null, flawed };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
