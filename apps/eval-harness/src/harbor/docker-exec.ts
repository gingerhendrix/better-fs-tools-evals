/**
 * A container that Harbor started. Every file system call and every bash
 * command runs in it through `docker exec`.
 */
export interface Container {
  /** Container id or name. */
  readonly id: string;
  /** `docker exec --user`. null runs as the image user. */
  readonly user: string | null;
}

export interface ExecResult {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export interface ExecOptions {
  readonly stdin?: Uint8Array;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

/** The `docker exec` argument list for one command in the container. */
export function execArgs(
  container: Container,
  argv: readonly string[],
  options: Omit<ExecOptions, "signal">,
): string[] {
  const args = ["exec"];
  if (options.stdin !== undefined) args.push("-i");
  if (container.user !== null) args.push("--user", container.user);
  if (options.cwd !== undefined) args.push("--workdir", options.cwd);
  for (const [key, value] of Object.entries(options.env ?? {}))
    args.push("--env", `${key}=${value}`);
  args.push(container.id, ...argv);
  return args;
}

/** Runs `argv` in the container and buffers its output. Never throws for a non-zero exit. */
export async function dockerExec(
  container: Container,
  argv: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const proc = Bun.spawn(["docker", ...execArgs(container, argv, options)], {
    stdin: options.stdin === undefined ? "ignore" : options.stdin,
    stdout: "pipe",
    stderr: "pipe",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Runs a POSIX sh script in the container, with `args` as $1, $2, ... */
export function dockerSh(
  container: Container,
  script: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return dockerExec(container, ["sh", "-c", script, "sh", ...args], options);
}
