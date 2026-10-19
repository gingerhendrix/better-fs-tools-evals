/**
 * A benchmark that supplies fixture folders. Each task's `metadata.json` names
 * its scorer, so a source does not import a scorer package.
 */
export interface TaskSource {
  readonly id: string;
  readonly description: string;
  /** Named task lists. A suite name must be unique across all sources. */
  readonly suites: Readonly<Record<string, readonly string[]>>;
}
