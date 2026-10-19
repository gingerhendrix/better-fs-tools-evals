import type {
  CommandRunner,
  OutputChunk,
  RunExit,
  RunHandle,
  RunRequest,
} from "@better-fs-tools/shell";

import { dockerExec, execArgs } from "./docker-exec.ts";
import type { Container } from "./docker-exec.ts";

/**
 * Starts the command in its own session, writes the session id to a pid
 * file, and then becomes `bash -c <command>`. The session id lets a stop
 * signal reach every process the command started.
 */
const LAUNCH = 'echo $$ > "$1"; shift; exec bash -c "$1"';

let runCount = 0;

/**
 * A command runner that runs `bash -c <command>` in the container through
 * `docker exec`, with stdin closed. The container's own environment is the
 * base. `request.env` is added over it, so pass shellEnv() and not the host
 * environment. A stop sends SIGTERM to the command's session, then SIGKILL
 * after killGraceMs.
 */
export function dockerCommandRunner(container: Container, cwd: string): CommandRunner {
  return Object.freeze<CommandRunner>({
    id: "docker exec",
    cwd,
    run: (request) => run(container, request),
  });
}

function run(container: Container, request: RunRequest): RunHandle {
  const queue = new ChunkQueue();
  return { output: queue, exit: start(container, request, queue) };
}

async function start(
  container: Container,
  request: RunRequest,
  queue: ChunkQueue,
): Promise<RunExit> {
  const cwdCheck = await dockerExec(container, [
    "sh",
    "-c",
    'if [ -d "$1" ]; then exit 0; elif [ -e "$1" ]; then exit 2; else exit 3; fi',
    "sh",
    request.cwd,
  ]);
  if (cwdCheck.code !== 0) {
    queue.end();
    return {
      code: null,
      signal: null,
      error: { reason: cwdCheck.code === 2 ? "cwd-not-a-directory" : "cwd-not-found" },
    };
  }
  if (request.signal.aborted) {
    queue.end();
    return { code: null, signal: "SIGTERM" };
  }

  const pidFile = `/tmp/.bft-run-${process.pid}-${++runCount}.pid`;
  const proc = Bun.spawn(
    [
      "docker",
      ...execArgs(container, ["setsid", "-w", "sh", "-c", LAUNCH, "sh", pidFile, request.command], {
        cwd: request.cwd,
        env: request.env,
      }),
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );

  let stopped: string | null = null;
  const stop = () => {
    stopped = "SIGTERM";
    void signalSession(container, pidFile, "TERM");
    const force = setTimeout(() => {
      stopped = "SIGKILL";
      void signalSession(container, pidFile, "KILL").finally(() => proc.kill("SIGKILL"));
    }, request.killGraceMs);
    force.unref();
  };
  request.signal.addEventListener("abort", stop, { once: true });

  const pump = async (stream: ReadableStream<Uint8Array>, name: OutputChunk["stream"]) => {
    for await (const bytes of stream) queue.push({ stream: name, bytes });
  };
  await Promise.all([pump(proc.stdout, "stdout"), pump(proc.stderr, "stderr"), proc.exited]);
  queue.end();
  request.signal.removeEventListener("abort", stop);
  void dockerExec(container, ["rm", "-f", pidFile]);
  if (stopped !== null) return { code: null, signal: stopped };
  // docker exec reports a command that a signal ended as exit code 128 + n.
  return { code: proc.exitCode, signal: null };
}

async function signalSession(container: Container, pidFile: string, signal: "TERM" | "KILL") {
  await dockerExec(container, [
    "sh",
    "-c",
    'pid=$(cat "$1" 2>/dev/null) && [ -n "$pid" ] && kill -s "$2" -- "-$pid" 2>/dev/null; true',
    "sh",
    pidFile,
    signal,
  ]);
}

class ChunkQueue implements AsyncIterable<OutputChunk> {
  #items: OutputChunk[] = [];
  #ended = false;
  #wake: (() => void) | undefined;

  push(chunk: OutputChunk): void {
    if (this.#ended) return;
    this.#items.push(chunk);
    this.#notify();
  }

  end(): void {
    this.#ended = true;
    this.#notify();
  }

  #notify(): void {
    this.#wake?.();
    this.#wake = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<OutputChunk> {
    return {
      next: async () => {
        for (;;) {
          const item = this.#items.shift();
          if (item !== undefined) return { done: false, value: item };
          if (this.#ended) return { done: true, value: undefined };
          await new Promise<void>((resolve) => {
            this.#wake = resolve;
          });
        }
      },
      return: async () => {
        this.#items = [];
        this.end();
        return { done: true, value: undefined };
      },
    };
  }
}
