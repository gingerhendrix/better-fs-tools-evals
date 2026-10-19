import type { ScorerResolver, TaskSource } from "@bfe/core";
import { fileScorers } from "@bfe/scorer-files";
import { explicitEditSource } from "@bfe/source-explicit-edit";
import { ompEditSource } from "@bfe/source-omp-edit";

/** Every task source the CLI knows. `list` prints suites in this order. */
export const SOURCES: readonly TaskSource[] = [explicitEditSource, ompEditSource];

/** All suites by name. A name defined by two sources is an error. */
export const SUITES: Readonly<Record<string, readonly string[]>> = mergeSuites(SOURCES);

/** Maps a fixture's scorer id to a verifier. Add a scorer package here. */
export const SCORERS: ScorerResolver = fileScorers;

function mergeSuites(sources: readonly TaskSource[]): Record<string, readonly string[]> {
  const suites: Record<string, readonly string[]> = {};
  for (const source of sources) {
    for (const [name, ids] of Object.entries(source.suites)) {
      if (name in suites) throw new Error(`suite "${name}" is defined twice (${source.id})`);
      suites[name] = ids;
    }
  }
  return suites;
}
