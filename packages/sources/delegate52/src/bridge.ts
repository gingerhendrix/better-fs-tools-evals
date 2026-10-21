import { fileURLToPath } from "node:url";

import type { FileMap, RelayScore, RelayScorer, RelaySample } from "@bfe/core";

/** The domains the bridge may score. The python domain runs model code in the scorer. */
export const BRIDGE_DOMAINS: readonly string[] = ["docker", "json"];

export const BRIDGE_DIR = fileURLToPath(new URL("../python", import.meta.url));

export interface BridgeOptions {
  /** The upstream `microsoft/DELEGATE52` checkout. */
  readonly repo: string;
  /** `UV_PROJECT_ENVIRONMENT`: where uv keeps the bridge's virtual environment. */
  readonly uvEnv?: string;
  /** The `uv` executable. */
  readonly uv?: string;
  readonly timeoutMs?: number;
}

/** What `score_bridge.py` writes on stdout. */
export interface BridgeOutput extends RelayScore {
  readonly scorerOutput: string;
}

/**
 * A scorer that runs the upstream domain scorer in `python/score_bridge.py`
 * through `uv run`. Each call is one subprocess: the request goes on stdin
 * and the score comes back on stdout.
 */
export function bridgeScorer(options: BridgeOptions): RelayScorer {
  return async (sample, files) => {
    const out = await runBridge(options, sample, files);
    return { score: out.score, error: out.error, details: out.details };
  };
}

export async function runBridge(
  options: BridgeOptions,
  sample: RelaySample,
  files: FileMap,
): Promise<BridgeOutput> {
  if (!BRIDGE_DOMAINS.includes(sample.domain))
    throw new Error(`the bridge does not score the ${sample.domain} domain`);
  const request = {
    repo: options.repo,
    domain: sample.domain,
    sampleId: sample.id,
    startState: sample.startState,
    seedFiles: sample.seedFiles,
    files,
  };
  const proc = Bun.spawn(
    [options.uv ?? "uv", "run", "--quiet", "--project", BRIDGE_DIR, "python", "score_bridge.py"],
    {
      cwd: BRIDGE_DIR,
      stdin: new Blob([JSON.stringify(request)]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        ...(options.uvEnv === undefined ? {} : { UV_PROJECT_ENVIRONMENT: options.uvEnv }),
      },
      timeout: options.timeoutMs ?? 120_000,
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`score_bridge.py exited with ${code}: ${stderr.trim()}`);
  return JSON.parse(stdout) as BridgeOutput;
}
