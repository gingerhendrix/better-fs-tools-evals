import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  FileStat,
  FileSystemError,
  ListOutcome,
  MutationError,
  MutationOutcome,
  NodeKind,
  OpenFile,
  OpenOutcome,
  Precondition,
  StatOutcome,
  VerifyOutcome,
  WritableFileSystem,
  WriteOptions,
} from "@better-fs-tools/fs";

import { dockerSh, execArgs } from "./docker-exec.ts";
import type { Container } from "./docker-exec.ts";

export interface DockerFileSystemOptions {
  readonly container: Container;
  /** Absolute path in the container. Relative paths resolve against it. */
  readonly cwd: string;
  /** Default ["/"]: the container is the sandbox. */
  readonly allowedRoots?: readonly string[];
}

/** Paths under these are refused, as nodeFileSystem refuses them. */
const DENY_ROOTS = ["/dev", "/proc", "/sys"];
/** Files above this size get a size and mtime version instead of a content hash. */
const HASH_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * Prints one record for a path. An existing path gives
 * `E <kind> <size> <mtime> <inode> <mode> <links> <md5>` and then the real
 * path on its own line. A missing path gives `M <resolved>`, then one
 * `D <dir>` line for each missing parent, innermost first, and `X <path>`
 * when the nearest existing parent is not a directory.
 */
const PROBE = `
p=$1
if [ -e "$p" ]; then
  r=$(realpath -e -- "$p") || { printf 'F\\trealpath failed\\n'; exit 0; }
  if [ -d "$r" ]; then k=directory
  elif [ -f "$r" ]; then k=file
  elif [ -p "$r" ]; then k=fifo
  elif [ -S "$r" ]; then k=socket
  elif [ -b "$r" ] || [ -c "$r" ]; then k=device
  else k=other; fi
  info=$(stat -c '%s %Y %i %a %h' -- "$r") || { printf 'F\\tstat failed\\n'; exit 0; }
  set -- $info
  m=-
  if [ "$k" = file ]; then
    if [ "$1" -le ${HASH_LIMIT_BYTES} ]; then m=$(md5sum < "$r" | cut -c1-32); else m="mtime-$2"; fi
  fi
  printf 'E\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n%s\\n' "$k" "$1" "$2" "$3" "$4" "$5" "$m" "$r"
else
  r=$(realpath -m -- "$p")
  printf 'M\\t%s\\n' "$r"
  d=$(dirname -- "$r")
  while [ ! -e "$d" ]; do printf 'D\\t%s\\n' "$d"; d=$(dirname -- "$d"); done
  if [ ! -d "$d" ]; then printf 'X\\t%s\\n' "$d"; fi
fi
`;

type Probe =
  | {
      readonly exists: true;
      readonly kind: "file" | NodeKind;
      readonly realPath: string;
      readonly size: number;
      readonly mtimeMs: number;
      readonly inode: string;
      readonly mode: number;
      readonly links: number;
      readonly version: string;
    }
  | {
      readonly exists: false;
      readonly realPath: string;
      /** Outermost first. */
      readonly missingDirectories: readonly string[];
      /** The nearest existing parent is not a directory. */
      readonly blockedBy: string | null;
    };

/**
 * A WritableFileSystem over a running container. Each call runs a short
 * shell script through `docker exec`, so it needs sh, realpath, stat,
 * md5sum, find, and cat in the image (GNU coreutils and findutils).
 *
 * The precondition check runs in this process just before the write, so
 * compareAndSwap is false: the write tools stat again before they write.
 * A write truncates the file in place, which keeps its mode and owner.
 */
export function dockerFileSystem(options: DockerFileSystemOptions): WritableFileSystem {
  const { container, cwd } = options;
  const allowedRoots = options.allowedRoots ?? ["/"];

  const lexical = (path: string): { path: string } | { error: FileSystemError } => {
    if (typeof path !== "string" || path === "" || path.includes("\0")) {
      return { error: { reason: "not-found", detail: "empty or invalid path" } };
    }
    const resolved = resolvePosix(cwd, path);
    return checkPath(resolved) ?? { path: resolved };
  };
  const checkPath = (resolved: string): { error: FileSystemError } | null => {
    if (!allowedRoots.some((root) => containsPosix(root, resolved))) {
      return { error: { reason: "outside-allowed-roots" } };
    }
    const denied = DENY_ROOTS.find((root) => containsPosix(root, resolved));
    return denied === undefined ? null : { error: { reason: "dangerous-path", detail: denied } };
  };
  const display = (resolved: string): string =>
    containsPosix(cwd, resolved) && resolved !== cwd
      ? resolved.slice(cwd === "/" ? 1 : cwd.length + 1)
      : resolved;

  const probe = async (
    path: string,
    signal?: AbortSignal,
  ): Promise<{ probe: Probe } | { error: FileSystemError }> => {
    if (signal?.aborted) return { error: { reason: "aborted" } };
    const result = await dockerSh(container, PROBE, [path], signal ? { signal } : {});
    if (result.code !== 0) return { error: { reason: "io", detail: result.stderr.trim() } };
    const parsed = parseProbe(new TextDecoder().decode(result.stdout));
    if ("error" in parsed) return parsed;
    const blocked = checkPath(parsed.probe.realPath);
    return blocked ?? parsed;
  };

  const stat = async (path: string, opts: { signal?: AbortSignal } = {}): Promise<StatOutcome> => {
    const target = lexical(path);
    if ("error" in target) return { ok: false, error: target.error };
    const found = await probe(target.path, opts.signal);
    if ("error" in found) return { ok: false, error: found.error };
    const p = found.probe;
    if (!p.exists) {
      if (p.blockedBy !== null) {
        return { ok: false, error: notAFile("other", p.blockedBy, display(p.blockedBy)) };
      }
      const stat: FileStat = {
        exists: false,
        resolvedPath: p.realPath,
        displayPath: display(p.realPath),
        missingDirectories: p.missingDirectories,
      };
      return { ok: true, stat };
    }
    if (p.kind !== "file") {
      return { ok: false, error: notAFile(p.kind, p.realPath, display(p.realPath)) };
    }
    return {
      ok: true,
      stat: {
        exists: true,
        resolvedPath: p.realPath,
        displayPath: display(p.realPath),
        size: p.size,
        mtimeMs: p.mtimeMs,
        identity: null,
        version: p.version,
        mode: p.mode,
        hardLinks: p.links,
      },
    };
  };

  const open = async (path: string, opts: { signal?: AbortSignal } = {}): Promise<OpenOutcome> => {
    const found = await stat(path, opts);
    if (!found.ok) return found;
    if (!found.stat.exists) return { ok: false, error: { reason: "not-found" } };
    const info = found.stat;
    let used = false;
    const file: OpenFile = {
      info: {
        resolvedPath: info.resolvedPath,
        displayPath: info.displayPath,
        size: info.size,
        mtimeMs: info.mtimeMs,
        identity: null,
        mimeType: null,
        version: info.version,
      },
      bytes: () => {
        if (used) throw new Error("bytes() is single-use");
        used = true;
        return streamFile(container, info.resolvedPath, opts.signal);
      },
      verify: async (): Promise<VerifyOutcome> => {
        const again = await stat(info.resolvedPath);
        if (!again.ok)
          return again.error.reason === "not-found" ? { ok: true, changed: true } : again;
        return {
          ok: true,
          changed: !again.stat.exists || again.stat.version !== info.version,
        };
      },
      close: async () => undefined,
    };
    return { ok: true, file };
  };

  const list = async (
    path: string,
    opts: { limit: number; signal?: AbortSignal },
  ): Promise<ListOutcome> => {
    const target = lexical(path);
    if ("error" in target) return { ok: false, error: target.error };
    const found = await probe(target.path, opts.signal);
    if ("error" in found) return { ok: false, error: found.error };
    const p = found.probe;
    if (!p.exists) return { ok: false, error: { reason: "not-found" } };
    if (p.kind !== "directory") {
      return {
        ok: false,
        error: notAFile(p.kind === "file" ? "other" : p.kind, p.realPath, display(p.realPath)),
      };
    }
    const result = await dockerSh(
      container,
      `cd -- "$1" && find . -mindepth 1 -maxdepth 1 -printf '%Y\\t%P\\n' | sort -t "$(printf '\\t')" -k2 | head -n "$2"`,
      [p.realPath, String(opts.limit + 1)],
      opts.signal ? { signal: opts.signal } : {},
    );
    if (result.code !== 0)
      return { ok: false, error: { reason: "io", detail: result.stderr.trim() } };
    const entries: DirectoryEntry[] = new TextDecoder()
      .decode(result.stdout)
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const tab = line.indexOf("\t");
        const type = line.slice(0, tab);
        return {
          name: line.slice(tab + 1),
          type: type === "f" ? "file" : type === "d" ? "directory" : "other",
        };
      });
    return {
      ok: true,
      entries: entries.slice(0, opts.limit),
      truncated: entries.length > opts.limit,
    };
  };

  const write = async (
    path: string,
    bytes: Uint8Array,
    opts: WriteOptions,
  ): Promise<MutationOutcome> => {
    if (opts.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
    const before = await stat(path, opts.signal ? { signal: opts.signal } : {});
    if (!before.ok) return { ok: false, error: before.error };
    const refused = checkPrecondition(before.stat, opts.precondition);
    if (refused !== null) return { ok: false, error: refused };
    const target = before.stat.resolvedPath;
    const created = before.stat.exists ? [] : before.stat.missingDirectories;
    if (created.length > 0 && !opts.createParents) {
      return { ok: false, error: { reason: "not-found", detail: "parent directory is missing" } };
    }
    const mode = !before.stat.exists && opts.mode !== undefined ? opts.mode.toString(8) : "";
    const result = await dockerSh(
      container,
      `if [ -n "$2" ]; then mkdir -p -- "$(dirname -- "$1")" || exit 3; fi
cat > "$1" || exit 4
if [ -n "$3" ]; then chmod "$3" -- "$1" || exit 5; fi`,
      [target, created.length > 0 ? "1" : "", mode],
      { stdin: bytes },
    );
    if (result.code !== 0) {
      const reason = /No space/i.test(result.stderr)
        ? "no-space"
        : /Permission denied/i.test(result.stderr)
          ? "permission-denied"
          : /Read-only/i.test(result.stderr)
            ? "read-only"
            : "io";
      return { ok: false, error: { reason, detail: result.stderr.trim() } };
    }
    const after = await stat(target);
    if (!after.ok) return { ok: false, error: after.error };
    if (!after.stat.exists)
      return { ok: false, error: { reason: "io", detail: "file vanished after write" } };
    return {
      ok: true,
      file: {
        resolvedPath: after.stat.resolvedPath,
        displayPath: after.stat.displayPath,
        version: after.stat.version,
        identity: null,
        size: after.stat.size,
        createdDirectories: created,
      },
    };
  };

  return Object.freeze({
    id: "docker",
    capabilities: Object.freeze({ identity: false }),
    writeCapabilities: Object.freeze({ compareAndSwap: false }),
    paths: posixPaths,
    open,
    list,
    stat,
    write,
  });
}

function checkPrecondition(stat: FileStat, precondition: Precondition): MutationError | null {
  if (precondition.kind === "any") return null;
  if (precondition.kind === "absent") return stat.exists ? { reason: "exists" } : null;
  if (!stat.exists || stat.version !== precondition.version) return { reason: "changed" };
  return null;
}

function notAFile(kind: NodeKind, resolvedPath: string, displayPath: string): FileSystemError {
  return { reason: "not-a-file", kind, target: { resolvedPath, displayPath } };
}

export function parseProbe(text: string): { probe: Probe } | { error: FileSystemError } {
  const lines = text.split("\n");
  const head = (lines[0] ?? "").split("\t");
  if (head[0] === "E") {
    const [, kind, size, mtime, inode, mode, links, md5] = head;
    const realPath = lines[1] ?? "";
    const known: readonly string[] = ["file", "directory", "fifo", "socket", "device", "other"];
    return {
      probe: {
        exists: true,
        kind: (known.includes(kind ?? "") ? kind : "other") as "file" | NodeKind,
        realPath,
        size: Number(size),
        mtimeMs: Number(mtime) * 1000,
        inode: inode ?? "",
        mode: Number.parseInt(mode ?? "0", 8),
        links: Number(links),
        version: `${size}:${md5}`,
      },
    };
  }
  if (head[0] === "M") {
    const missing: string[] = [];
    let blockedBy: string | null = null;
    for (const line of lines.slice(1)) {
      if (line.startsWith("D\t")) missing.unshift(line.slice(2));
      if (line.startsWith("X\t")) blockedBy = line.slice(2);
    }
    return {
      probe: {
        exists: false,
        realPath: head.slice(1).join("\t"),
        missingDirectories: missing,
        blockedBy,
      },
    };
  }
  return { error: { reason: "io", detail: head.slice(1).join(" ") || "unexpected probe output" } };
}

/** Streams the file through `docker exec cat`. Stopping early kills the exec. */
async function* streamFile(
  container: Container,
  path: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
  const proc = Bun.spawn(["docker", ...execArgs(container, ["cat", "--", path], {})], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    ...(signal === undefined ? {} : { signal }),
  });
  let finished = false;
  try {
    for await (const chunk of proc.stdout) yield chunk;
    finished = true;
    const code = await proc.exited;
    if (code !== 0) throw new Error(`cat ${path} exited with ${code}`);
  } finally {
    if (!finished) proc.kill();
  }
}
