# Benchmarks

Fixtures stay out of Git. Keep them, and the run output, in dated scratch folders. Each run manifest records the fixture path, fixture hashes, and upstream commits.

| Source                  | Package                     | Upstream                                                                   | License | Scorer                                                               | Suites                           |
| ----------------------- | --------------------------- | -------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------- | -------------------------------- |
| Oh My Pi edit benchmark | `@bfe/source-omp-edit`      | `packages/typescript-edit-benchmark/fixtures.tar.gz` in `can1357/oh-my-pi` | MIT     | `omp` (Prettier-normalised compare, a port of the upstream verifier) | `poc-12`, `friction-v1`, `smoke` |
| Explicit Edit           | `@bfe/source-explicit-edit` | `src/suites/explicit-edit/fixtures.ts` in an Explicit Edit benchmark clone | MIT     | `exact` (byte compare with damage kinds)                             | `ee-smoke`, `ee-hard-40`         |

## Oh My Pi

Unpack `fixtures.tar.gz` and pass the folder with `--fixtures`, or set `OMP_EDIT_FIXTURES`. Fixture metadata has no `verify` field, so the `omp` scorer applies. Some tasks are flawed. A `task-flags.json` in the fixtures folder marks them, and the viewer can score a clean subset.

## Explicit Edit

`bun run fixtures:explicit-edit --clone <clone> --out <fixtures> [--tasks id,id]` imports the generator from the clone and writes fixture folders. No generator code is copied into this repository. The exporter records the clone's commit as `upstreamCommit` and each task's `fixtureSha256`. It writes `verify: "exact"` into each fixture.

## Planned

- DELEGATE-52: relay tasks with a Python scorer bridge. The plan is in the 2026-10-16 `better-fs-tools-evals` stream.
- Model-graded scorers for Harbor tasks that need a judge.
