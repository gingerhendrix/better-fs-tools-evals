import type { FileMap, FileSetCheck, SeedComparison } from "@bfe/core";

const isGlob = (name: string) => name.includes("*") || name.includes("?");

/** Python `fnmatch` on POSIX: `*` and `?` match any character, `/` included. */
function globRegex(pattern: string): RegExp {
  const body = [...pattern]
    .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`, "s");
}

/**
 * Upstream `is_context_complete` and `validate_wildcard_context`: every
 * target name or glob needs a file. When the targets have a glob, every
 * file must also match a target.
 */
export function checkFileSet(files: readonly string[], targets: readonly string[]): FileSetCheck {
  const matches = (file: string, target: string) =>
    isGlob(target) ? globRegex(target).test(file) : file === target;
  const missing = targets.filter((t) => !files.some((f) => matches(f, t)));
  const extra = files.filter((f) => !targets.some((t) => matches(f, t)));
  const ok = missing.length === 0 && (!targets.some(isGlob) || extra.length === 0);
  return { ok, missing, extra };
}

/** Lines in the Python `splitlines()` sense, for the bloat measure. */
function lineCount(text: string): number {
  if (text === "") return 0;
  const parts = text.split(/\r\n|\r|\n/);
  return parts.at(-1) === "" ? parts.length - 1 : parts.length;
}

/** Lines removed and added between two texts, from the longest common subsequence of lines. */
export function lineDiff(before: string, after: string): { added: number; removed: number } {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  let prev = new Uint32Array(b.length + 1);
  let row = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!);
    }
    [prev, row] = [row, prev];
  }
  const common = prev[b.length]!;
  return { added: b.length - common, removed: a.length - common };
}

/** Byte-exact return, line diff, and bloat against the seed files. */
export function compareWithSeed(seed: FileMap, files: FileMap): SeedComparison {
  const exactFiles = Object.keys(seed).filter((name) => files[name] === seed[name]);
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const name of new Set([...Object.keys(seed), ...Object.keys(files)])) {
    const diff = lineDiff(seed[name] ?? "", files[name] ?? "");
    linesAdded += diff.added;
    linesRemoved += diff.removed;
  }
  const stats = (m: FileMap) => {
    const texts = Object.values(m);
    return {
      lines: texts.reduce((n, t) => n + lineCount(t), 0),
      chars: texts.reduce((n, t) => n + t.length, 0),
    };
  };
  const s = stats(seed);
  const f = stats(files);
  const bloat = (x: number, ref: number) => (ref === 0 ? 0 : (100 * (x - ref)) / ref);
  return {
    exact:
      exactFiles.length === Object.keys(seed).length &&
      Object.keys(files).length === Object.keys(seed).length,
    exactFiles,
    lineDiff: linesAdded + linesRemoved,
    linesAdded,
    linesRemoved,
    lineBloat: bloat(f.lines, s.lines),
    charBloat: bloat(f.chars, s.chars),
  };
}
