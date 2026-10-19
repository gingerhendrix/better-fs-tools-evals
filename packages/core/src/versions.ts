import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The installed version of each dependency in one `package.json`. Workspace
 * links are left out, because their version is always `0.0.0`.
 *
 * The lookup walks up `node_modules` folders from the package. It does not use
 * `require("<name>/package.json")`, because published packages such as
 * `@better-fs-tools/read` do not export their `package.json`.
 * It throws when a version cannot be found, so a manifest never records a guess.
 */
export async function dependencyVersions(packageJson: URL): Promise<Record<string, string>> {
  const pkg = JSON.parse(await readFile(packageJson, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const from = dirname(fileURLToPath(packageJson));
  const versions: Record<string, string> = {};
  for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
    if (spec.startsWith("workspace:")) continue;
    versions[name] = await installedVersion(name, from);
  }
  return versions;
}

async function installedVersion(name: string, from: string): Promise<string> {
  for (let dir = from; ; dir = dirname(dir)) {
    const text = await readFile(join(dir, "node_modules", name, "package.json"), "utf8").catch(
      () => null,
    );
    if (text !== null) return (JSON.parse(text) as { version: string }).version;
    if (dirname(dir) === dir) throw new Error(`cannot find the installed version of ${name}`);
  }
}
