#!/usr/bin/env bun
/**
 * bun run view [<root> ...] [--port 4317] [--host 127.0.0.1] [--depth 3]
 *
 * Finds every `run --out` folder under the roots and serves a browser view
 * of tasks, runs, scores, and full traces.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { startViewer } from "./server.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "4317" },
    host: { type: "string", default: "127.0.0.1" },
    depth: { type: "string", default: "3" },
  },
});

const roots = (positionals.length > 0 ? positionals : [process.cwd()]).map((r) => resolve(r));
const server = await startViewer({
  roots,
  port: Number(values.port),
  hostname: values.host!,
  maxDepth: Number(values.depth),
});
console.log(`eval viewer: ${server.url} (roots: ${roots.join(", ")})`);
