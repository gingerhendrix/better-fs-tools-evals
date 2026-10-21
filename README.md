# better-fs-tools-evals

Evals for [Better FS Tools](https://github.com/gingerhendrix/better-fs-tools). The harness runs edit benchmarks through an AI SDK agent loop with different tool sets ("arms"). It writes each run to a folder. A browser viewer and a Markdown report read those folders.

This repository is public. It is not published to npm. It uses the published `@better-fs-tools/*` packages at the versions pinned in the root `package.json` catalog.

## Quick start

```sh
bun install
bun run eval list                                   # arms and suites
bun run eval run --fixtures <dir> --out <run-dir> --suite smoke --arms edit
bun run eval report --out <run-dir>
bun run view <runs-root>                            # http://127.0.0.1:4317/, also reads DELEGATE-52 and Harbor folders
bun run fixtures:explicit-edit --clone <upstream-clone> --out <fixtures>
bun run check                                       # format, lint, import rules, typecheck, tests
```

A live run calls paid models or uses subscription quota. [docs/running.md](docs/running.md) covers providers, flags, the sandbox, and Harbor.

## Layout

| Path                             | Package                     | Holds                                                                  |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `packages/core`                  | `@bfe/core`                 | Types and contracts: tasks, results, scores, metrics, run folder paths |
| `packages/results`               | `@bfe/results`              | Read side of run folders: catalog, traces, stats, cost, report         |
| `packages/providers`             | `@bfe/providers`            | Command Code and Codex OAuth models, HTTP logging                      |
| `packages/tools`                 | `@bfe/tools`                | Tool arms and the bwrap bash sandbox                                   |
| `packages/runner`                | `@bfe/runner`               | Agent loop, cell and matrix runs, provenance                           |
| `packages/scorers/files`         | `@bfe/scorer-files`         | `omp` and `exact` scorers                                              |
| `packages/sources/omp-edit`      | `@bfe/source-omp-edit`      | Oh My Pi suites                                                        |
| `packages/sources/explicit-edit` | `@bfe/source-explicit-edit` | Explicit Edit suites and fixture exporter                              |
| `packages/harbor`                | `@bfe/harbor`               | Harbor agent, TS and Python                                            |
| `apps/cli`                       | `@bfe/cli`                  | `run`, `report`, and `list`                                            |
| `apps/viewer`                    | `@bfe/viewer`               | Run viewer                                                             |

[docs/architecture.md](docs/architecture.md) explains the package rules. [docs/benchmarks.md](docs/benchmarks.md) lists the benchmark sources. [EXTRACTION.md](EXTRACTION.md) records where the code came from.
