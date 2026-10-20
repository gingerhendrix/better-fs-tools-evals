# Running evals

The harness runs the Oh My Pi `typescript-edit-benchmark` and Explicit Edit fixtures through an AI SDK loop with Better FS Tools, against Command Code models. Run every command from the repository root. [architecture.md](architecture.md) describes the packages.

## Run

```sh
export COMMANDCODE_API_KEY=...            # or AA_COMMANDCODE_API_KEY
export OMP_EDIT_FIXTURES=/path/to/fixtures  # folders with prompt.md, input/, expected/, metadata.json

bun run eval list
bun run eval run --out <dir> --suite poc-12 --arms edit,patch
bun run eval report --out <dir>
```

Get the fixtures from `packages/typescript-edit-benchmark/fixtures.tar.gz` in `can1357/oh-my-pi` (MIT). [benchmarks.md](benchmarks.md) lists the sources.

Options for `run`:

| Flag                  | Default                                                    | Meaning                                                           |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `--models`            | `xiaomi/mimo-v2.6-flash,nvidia/nemotron-3-ultra-550b-a55b` | Command Code model ids, or `codex-oauth:` ids (see below)         |
| `--arms`              | `edit,patch`                                               | Tool configurations. `list` shows them                            |
| `--suite` / `--tasks` | `poc-12`                                                   | A named task list, or fixture ids                                 |
| `--attempts`          | `1`                                                        | Attempts for each cell                                            |
| `--concurrency`       | `4`                                                        | Cells in parallel                                                 |
| `--max-steps`         | `20`                                                       | Model calls for each cell                                         |
| `--step-timeout`      | `600`                                                      | Seconds for one model call                                        |
| `--no-early-stop`     | off                                                        | By default the loop stops when the file matches, as Oh My Pi does |
| `--keep-workspace`    | off                                                        | Keep the edited copy of the fixture                               |

`run` skips a cell that has a `result.json`, unless that cell ended in a provider error. So a second `run` with the same flags resumes the matrix.

## DELEGATE-52

```sh
export BFE_D52_DATA=/path/to/delegate52.jsonl
export BFE_D52_REPO=/path/to/DELEGATE52        # microsoft/DELEGATE52 checkout
export BFE_D52_UV_ENV=/path/to/uv-env          # optional: where uv keeps the bridge venv

bun run eval d52 --out <dir> --domains docker,json --arms d52-tools,bft-edit \
  --models z-ai/glm-5.3-flash,codex-oauth:gpt-6-luna:medium --round-trips 5 --seed 52
bun run eval d52-report --out <dir>
```

| Flag                 | Default              | Meaning                                                         |
| -------------------- | -------------------- | --------------------------------------------------------------- |
| `--domains`          | `docker,json`        | Sample domains. The bridge scores only these two                |
| `--samples`          | all in `--domains`   | Sample ids, for a pilot                                         |
| `--arms`             | `d52-tools,bft-edit` | Relay arms                                                      |
| `--round-trips`      | `5`                  | Round trips per relay. Each has a forward and a backward step   |
| `--seed`             | `52`                 | Seed for the forward-edit order. Same order for every arm/model |
| `--no-distractors`   | off                  | Leave out the distractor files                                  |
| `--max-steps`        | `25`                 | Model calls per interaction (upstream `MAX_TURNS`)              |
| `--max-total-tokens` | `500000`             | Input plus output tokens per interaction (upstream budget)      |
| `--retries`          | `2`                  | Extra tries of an interaction after a provider error            |
| `--concurrency`      | `4`                  | Relays in parallel                                              |

Each interaction gets a fresh workspace with the current files and the distractor files. After the loop the relay strips the distractors, checks the file set against the target state, and, on backward steps, scores the files through the bridge and compares them with the seed bytes. A second `d52` with the same flags resumes every relay after its last saved snapshot.

Differences from upstream `model_agentic.py` in the `d52-tools` port:

- Files live in a folder, not in memory. A name that leaves the folder is refused.
- `run_python` uses the system `/usr/bin/python3`, with the same bwrap flags.
- The nudge goes once. Upstream nudges on every turn with no tool call and no write.
- No parsing of tool calls written as text, no temperature 1.0, and no 16k output cap. The loop uses the provider defaults.
- The forward-edit order is seeded. Upstream uses Python's global `random`.

Output:

```text
<out>/manifest.json   dataset sha256, upstream commit, seed, round trips, arms, models, tool versions
<out>/report.md
<out>/relays/<model>/<arm>/<sample>/
  relay.json          summary of the relay
  i01/ ... i10/       one folder per interaction
    interaction.json  end state, file set, score, seed comparison, tool calls, tokens
    snapshot.json     the files after the interaction, distractors stripped
    steps.jsonl, http.jsonl
    error-<ms>.json   an attempt that ended in a provider error
```

## Output

```text
<out>/manifest.json
<out>/report.md
<out>/runs/<model>/<arm>/<task>/a<n>/
  result.json   pass, end state, tool calls, tool error codes, notes, tokens, wall time
  steps.jsonl   one line for each model call
  http.jsonl    raw request and response bodies
```

## View runs in a browser

```sh
bun run view <root> [<root> ...] [--port 4317] [--depth 3]
```

`view` looks for every `run --out` folder (a `manifest.json` beside `runs/`) up to `--depth` levels below each root, and serves a local web app at `http://127.0.0.1:4317/`:

| Page     | Shows                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| Overview | Each run folder, with a tick to show or hide it, and a model x arm score table for each fixture set         |
| Tasks    | A task x (model, arm) matrix of passes over graded runs. A task opens its prompt and expected fix           |
| Runs     | Every run, with filters for fixtures, folder, model, arm, result, task, and tool error code                 |
| Run      | Score, metrics, prompt, expected fix, system prompt, tools, and every step with the tool text the model saw |

Tasks are keyed by fixture folder and id, because two fixture sets can use the same ids. The pass rate is strict: a provider error counts as a fail. A cell with no `result.json` shows as incomplete. **Rescan** reads the folders again, so the view follows a matrix that is still running.

## Arms

| Arm              | Tools                                               |
| ---------------- | --------------------------------------------------- |
| `edit`           | gutter `read` + `edit` + `write`                    |
| `patch`          | gutter `read` + `apply_patch`                       |
| `edit-plain`     | plain `read` + `edit` + `write`                     |
| `bash-read-edit` | sandboxed `bash` + gutter `read` + `edit` + `write` |
| `edit-exact`     | gutter `read` + exact-only `edit` + `write`         |
| `bash`           | sandboxed `bash`                                    |

Each arm keeps a fresh memory store. Mutation tools use `preconditions: { requireRead: "off" }`.
The former `write` arm is removed. Older results used different tools and read preconditions.
The library tool descriptions still suggest reading first. The precondition does not require it.

## Explicit Edit

Export fixtures from an upstream clone. The exporter imports the generator and records its commit and fixture hashes. It does not copy generator code into this repository.

```sh
bun run fixtures:explicit-edit --clone <explicit-edit-benchmark-clone> --out <fixtures>
```

The `ee-smoke` suite has 4 tasks. The `ee-hard-40` suite has the fixed 40-task slice.
This command starts live model calls. Stage 0 uses only offline checks.

```sh
bun run eval run \
  --fixtures <fixtures> --out <run-output> --suite ee-smoke \
  --arms edit,patch,edit-plain,bash-read-edit \
  --models codex-oauth:gpt-6-luna:medium,z-ai/glm-5.3-flash \
  --attempts 1 --max-steps 40 --step-timeout 600 \
  --no-early-stop --keep-workspace --concurrency 2
```

For the main run, use `--suite ee-hard-40 --attempts 2`.
For optional arms, use `--arms edit-exact,bash --tasks <comma-separated-literal-and-unicode-fix-ids> --attempts 1`.
These arm and suite names need no other new flags.

Bash needs Linux user namespaces, `/usr/bin/bwrap`, and the Arch `/usr` layout.
The wrapper binds only the workspace read-write and `/usr` read-only. It gives each call private namespaces, `/tmp`, `/dev`, and `/proc`. The root is read-only. Commands get a clean environment and start in the workspace. The host home, fixture tree, and repository are not mounted.
Run its integration test with `BFT_BWRAP_TESTS=1 bun test packages/tools/test/sandbox-bash.test.ts`.

Explicit Edit metadata selects `verify: "exact"`. The verifier checks all file bytes and rejects missing files, extra entries, and non-regular files. Results include per-file damage kinds. The task prompt stays unchanged. Early stop and final scoring use the same verifier.
The manifest records package versions (the published `@better-fs-tools/*` versions among them), the commit of this repository as `harnessGitSha`, upstream commits, fixture hashes, arm tools, read preconditions, matchers, and Codex cache pinning.

## Metrics

Tool errors come from the result objects, with no log parsing. A Better FS Tools failure gives `<tool>:<CODE>`, for example `edit:NO_MATCH` or `apply_patch:PATCH_PARSE`. A call that never reached the tool gives `<tool>:bad-json`, `<tool>:schema`, or `<tool>:unknown-tool`.

The default verifier is a port of the Oh My Pi verifier. It formats both files with Prettier and ignores blank-line count and whitespace-only line changes.

Short write counts measure attempted `write` calls whose UTF-8 content is less than half the current file size. The report shows tool calls per run, unknown tool calls, and damage kinds. Old result files remain readable; missing counters display zero and must not be treated as measured.

## GPT models on the ChatGPT subscription

A model id that starts with `codex-oauth:` runs a GPT model through the ChatGPT Codex backend. This is the method Auto-Agent uses. It needs no API key. The harness reads the Codex CLI login from `~/.codex/auth.json`, and refreshes the token there when it is about to expire. Run `codex login` first.

```sh
bun run eval run --out <dir> --suite smoke --arms edit \
  --models codex-oauth:gpt-5.6-luna:low,codex-oauth:gpt-6-luna
```

The form is `codex-oauth:<model>[:<effort>]`. The effort is one of `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `ultra`. With no effort, the backend default applies. The Harbor agent takes the same ids in `--model`.

The calls use the Responses API with `store: false`, so encrypted reasoning goes back to the model on each step. The backend takes only a subset of request fields. The harness removes the others and moves the system prompt to `instructions`. Runs use subscription quota, so the rate card has no price for them and the report shows `-`. Token counts are still recorded.

## Cost

`report.md` shows estimated USD per run, per passed run, and in total. `packages/results/src/pricing.ts` holds a Command Code rate card, keyed by exact API model id. It uses the same rate fields as the StreamOS rate card. Cost is worked out from the tokens in `result.json`, so `report` can price old runs again. A model with no rate shows `-`. To add a model, copy its input, cache-read, and output prices from the [Command Code pricing page](https://commandcode.ai/docs/resources/pricing-limits) and update `asOf`.

## Harbor tasks

`packages/harbor/` runs a [Harbor](https://github.com/laude-institute/harbor) task with the default `createAiSdkFsTools()` bundle (`read`, `edit`, `write`) plus `bash`. Harbor pulls the task image, starts the container, and runs the verifier. The Harbor agent in `packages/harbor/python/bft_agent.py` starts `packages/harbor/src/agent.ts` on the host. Every tool call then runs in the container through `docker exec`:

- `dockerFileSystem()` is a `WritableFileSystem` over the container. Its allowed root is `/`, because the container is the sandbox.
- `dockerCommandRunner()` runs `bash -c <command>` in the container. A stop signals the command's whole session.

```sh
PYTHONPATH=packages/harbor/python uvx harbor run -p <task-or-dataset-dir> \
  -a bft_agent:BftAgent -m deepseek/deepseek-v4.1-flash -o <jobs-dir> -n 4
```

`BFT_MAX_STEPS` (default 300) and `BFT_STEP_TIMEOUT` (seconds for one model call, default 600) change the loop. `BFT_TOOLS` picks the tool set:

| Set               | Tools                           |
| ----------------- | ------------------------------- |
| `default`         | `read`, `edit`, `write`, `bash` |
| `bash`            | `bash`                          |
| `bash-read-edit`  | `bash`, `read`, `edit`          |
| `bash-read-patch` | `bash`, `read`, `apply_patch`   |

A tool description or a system-prompt sentence that names a tool outside the set is changed so that it names only tools in the set. Each trial's `agent/` folder gets `steps.jsonl`, `http.jsonl`, and `result.json`. A trial that Harbor stops at its agent timeout has no `result.json`. Its usage is in `steps.jsonl`.

`BFT_DOCKER_TESTS=1 bun test packages/harbor/test` runs the file system conformance suites and the bash runner against a live `python:3.11-slim` container.
