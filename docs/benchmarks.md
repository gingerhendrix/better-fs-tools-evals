# Benchmarks

Fixtures stay out of Git. Keep them, and the run output, in dated scratch folders. Each run manifest records the fixture path, fixture hashes, and upstream commits.

| Source                  | Package                     | Upstream                                                                            | License                            | Scorer                                                                   | Suites                                 |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| Oh My Pi edit benchmark | `@bfe/source-omp-edit`      | `packages/typescript-edit-benchmark/fixtures.tar.gz` in `can1357/oh-my-pi`          | MIT                                | `omp` (Prettier-normalised compare, a port of the upstream verifier)     | `poc-12`, `friction-v1`, `smoke`       |
| Explicit Edit           | `@bfe/source-explicit-edit` | `src/suites/explicit-edit/fixtures.ts` in an Explicit Edit benchmark clone          | MIT                                | `exact` (byte compare with damage kinds)                                 | `ee-smoke`, `ee-hard-40`               |
| DELEGATE-52             | `@bfe/source-delegate52`    | `microsoft/DELEGATE52` (code) and `microsoft/delegate52` (data, `delegate52.jsonl`) | MIT code, per-sample data licences | Upstream docker and json domain scorers through `python/score_bridge.py` | `--domains docker,json` or `--samples` |

## Oh My Pi

Unpack `fixtures.tar.gz` and pass the folder with `--fixtures`, or set `OMP_EDIT_FIXTURES`. Fixture metadata has no `verify` field, so the `omp` scorer applies. Some tasks are flawed. A `task-flags.json` in the fixtures folder marks them, and the viewer can score a clean subset.

## Explicit Edit

`bun run fixtures:explicit-edit --clone <clone> --out <fixtures> [--tasks id,id]` imports the generator from the clone and writes fixture folders. No generator code is copied into this repository. The exporter records the clone's commit as `upstreamCommit` and each task's `fixtureSha256`. It writes `verify: "exact"` into each fixture.

## DELEGATE-52

`bun run eval d52` runs relays: each round trip is a forward edit from the seed state and the backward edit that returns to it. The run needs the dataset file and an upstream checkout, both outside Git. Each sample has its own licence (`context_license`); docker5 is GPL-3.0 and docker6 is AGPL-3.0. The manifest records the dataset sha256 and the upstream commit.

`python/score_bridge.py` loads only `domains/domain_base.py` and one domain module, so it does not import the other 50 domains and their dependencies. It runs under `uv`, from `packages/sources/delegate52/python/pyproject.toml` (Python 3.12, `openai`, `ujson`, `pyyaml`). Only `docker` and `json` are allowed: the `python` domain runs model code inside the scorer process.

The `d52-tools` arm is a port of the upstream tool harness and system prompt (MIT, Microsoft Corporation). [running.md](running.md#delegate-52) lists the differences.

## Planned

- More DELEGATE-52 domains, after each scorer's dependencies and safety are checked.
- Model-graded scorers for Harbor tasks that need a judge.
