#!/usr/bin/env bun
/**
 * Import boundary check for the workspace packages.
 *
 * For each package it reads `package.json` and every import specifier in `src/`
 * and `test/`. It fails when:
 * - `src/` imports a workspace package that the package may not depend on (`ALLOWED`);
 * - `src/` imports `@better-fs-tools/*` outside `@bfe/tools` and `@bfe/harbor`;
 * - `package.json` lists a workspace package that `ALLOWED` does not permit;
 * - a file imports a package that `package.json` does not declare.
 *
 * docs/architecture.md explains the rules.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TOOL_SCOPE = "@better-fs-tools/";

/** Workspace packages each package may depend on. `tools` grants `@better-fs-tools/*`. */
const ALLOWED: Readonly<
  Record<string, { readonly bfe: readonly string[]; readonly tools?: true }>
> = {
  "@bfe/core": { bfe: [] },
  "@bfe/results": { bfe: ["@bfe/core"] },
  "@bfe/providers": { bfe: ["@bfe/core"] },
  "@bfe/tools": { bfe: ["@bfe/core"], tools: true },
  "@bfe/runner": { bfe: ["@bfe/core", "@bfe/providers", "@bfe/results", "@bfe/tools"] },
  "@bfe/scorer-files": { bfe: ["@bfe/core"] },
  "@bfe/source-omp-edit": { bfe: ["@bfe/core"] },
  "@bfe/source-explicit-edit": { bfe: ["@bfe/core"] },
  "@bfe/harbor": {
    bfe: ["@bfe/core", "@bfe/providers", "@bfe/results", "@bfe/runner"],
    tools: true,
  },
  "@bfe/cli": {
    bfe: [
      "@bfe/core",
      "@bfe/results",
      "@bfe/runner",
      "@bfe/scorer-files",
      "@bfe/source-explicit-edit",
      "@bfe/source-omp-edit",
      "@bfe/tools",
    ],
  },
  "@bfe/viewer": { bfe: ["@bfe/core", "@bfe/results"] },
};

interface Manifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

/** `@scope/name/sub` to `@scope/name`, `name/sub` to `name`. */
export function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun")
    return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

export function importsOf(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((m) => m[1]!);
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function packageDirs(): Promise<string[]> {
  const root = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
    workspaces: { packages: string[] };
  };
  const dirs: string[] = [];
  for (const pattern of root.workspaces.packages) {
    const base = join(ROOT, pattern.replace(/\/\*$/, ""));
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const dir = join(base, entry.name);
      if (entry.isDirectory() && (await Bun.file(join(dir, "package.json")).exists()))
        dirs.push(dir);
    }
  }
  return dirs.sort();
}

export async function checkDeps(): Promise<string[]> {
  const errors: string[] = [];
  for (const dir of await packageDirs()) {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as Manifest;
    const rule = ALLOWED[pkg.name];
    if (rule === undefined) {
      errors.push(`${pkg.name}: no entry in ALLOWED (scripts/check-deps.ts)`);
      continue;
    }
    const deps = new Set(Object.keys(pkg.dependencies ?? {}));
    const devDeps = new Set(Object.keys(pkg.devDependencies ?? {}));
    for (const dep of deps) {
      if (dep.startsWith("@bfe/") && !rule.bfe.includes(dep))
        errors.push(`${pkg.name}: package.json depends on ${dep}, which is not allowed`);
      if (dep.startsWith(TOOL_SCOPE) && !rule.tools)
        errors.push(`${pkg.name}: package.json depends on ${dep}; only tools and harbor may`);
    }
    for (const area of ["src", "test"] as const) {
      for (const file of await files(join(dir, area))) {
        const where = relative(ROOT, file);
        for (const specifier of importsOf(await readFile(file, "utf8"))) {
          const name = packageOf(specifier);
          if (name === null || name === pkg.name) continue;
          if (area === "src" && name.startsWith("@bfe/") && !rule.bfe.includes(name))
            errors.push(`${where}: imports ${name}, which ${pkg.name} may not depend on`);
          if (area === "src" && name.startsWith(TOOL_SCOPE) && !rule.tools)
            errors.push(`${where}: imports ${name}; only tools and harbor may`);
          const declared = deps.has(name) || (area === "test" && devDeps.has(name));
          if (!declared) errors.push(`${where}: imports ${name}, missing from package.json`);
        }
      }
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = await checkDeps();
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
  console.log("check-deps: every package keeps to its import rules");
}
