# Architecture

## The run folder is the contract

Runners write run folders. Viewers, reports, and later rescoring read them. A viewer does not import tool packages, providers, or the agent loop.

```text
<run-dir>/manifest.json
<run-dir>/report.md
<run-dir>/runs/<model>/<arm>/<task>/a<n>/
  result.json   pass, end state, scorer output, metrics
  steps.jsonl   one line for each model call
  http.jsonl    raw request and response bodies
```

`@bfe/core` holds the shapes (`CellResult`, `RunMetrics`, `Verification`) and the path rule (`cellPath`, `modelDirName`). Every run to date uses one shape, called schema version 0. Some fields appeared later: `verify` and `damage` came with the Explicit Edit work, and `provenance` came with the manifest work. `packages/results/test/v0-runs.test.ts` reads copies of a run from 2026-09-28 and an exact-scorer run from 2026-10-18.

## Packages and allowed dependencies

```text
core <- results <- runner <- harbor
core <- providers <- runner, harbor
core <- tools     <- runner
core <- scorer-files, source-omp-edit, source-explicit-edit
cli    -> core, results, runner, tools, scorer-files, sources
viewer -> core, results
```

| Package                     | May depend on                                                  |
| --------------------------- | -------------------------------------------------------------- |
| `@bfe/core`                 | No workspace package                                           |
| `@bfe/results`              | `core`                                                         |
| `@bfe/providers`            | `core`                                                         |
| `@bfe/tools`                | `core`, `@better-fs-tools/*`                                   |
| `@bfe/runner`               | `core`, `providers`, `results`, `tools`                        |
| `@bfe/scorer-files`         | `core`                                                         |
| `@bfe/source-omp-edit`      | `core`                                                         |
| `@bfe/source-explicit-edit` | `core`                                                         |
| `@bfe/harbor`               | `core`, `providers`, `results`, `runner`, `@better-fs-tools/*` |
| `@bfe/cli`                  | Every `@bfe/*` package except `harbor` and `viewer`            |
| `@bfe/viewer`               | `core`, `results`                                              |

`scripts/check-deps.ts` enforces this table. `bun run check` runs it. The script also fails when a file imports a package that its `package.json` does not declare. Tests may also use `devDependencies`.

Rules behind the table:

- Only `tools` and `harbor` import `@better-fs-tools/*`. A tool version bump touches one place.
- Viewers read run folders through `results`. A new viewer needs no provider key and no sandbox.
- Sources and scorers do not import each other. Each fixture's `metadata.json` names its scorer id (`verify`). The CLI registry (`apps/cli/src/registry.ts`) maps the id to a scorer, and the runner gets that map through `RunOptions.scorers`.
- Only `providers` reads model credentials.
- `harbor` depends on `runner` for the loop. `runner` never depends on `harbor`.

## Where things live

- **Fixture folder loader.** Both sources use one folder layout: `prompt.md`, `input/`, `expected/`, and `metadata.json`. So `loadTask` and `listFiles` live in `core`. The viewer's fixture view and the scorers use them without a source package.
- **Browser code.** `@bfe/results/stats` has no Node imports. The viewer's React app imports values only from that subpath, and types from `@bfe/results` with `import type`.
- **Tool versions in the manifest.** `runProvenance` merges the npm dependency versions of `runner`, `providers`, and `tools`. `dependencyVersions` in `core` finds each installed `package.json` by walking up `node_modules`, because the published tool packages do not export `package.json`.

## Adding parts

- **A task source.** Add `packages/sources/<name>` with a `TaskSource` export (id, description, suites). Register it in `apps/cli/src/registry.ts`. Suite names must be unique across sources.
- **A scorer.** Add `packages/scorers/<name>`. Extend `ScorerId` in `core`, and map the new id in the CLI registry.
- **A viewer.** Add `apps/<name>` that depends on `core` and `results` only, and add it to `ALLOWED` in `scripts/check-deps.ts`.
