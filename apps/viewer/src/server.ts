import { loadFixture, loadTrace, scanCatalog } from "@bfe/results";
import type { Catalog } from "@bfe/results";

import page from "./app/index.html";

export interface ViewerOptions {
  readonly roots: readonly string[];
  readonly port: number;
  readonly hostname: string;
  readonly maxDepth: number;
  /** Batch ids that hold any of these strings are left out. */
  readonly exclude?: readonly string[];
}

/**
 * Serves the run viewer. The API reads only folders that the scan found:
 * a trace by run id, a fixture by a (fixtures dir, task id) pair from a harness manifest.
 */
export async function startViewer(options: ViewerOptions) {
  const scan = { maxDepth: options.maxDepth, exclude: options.exclude ?? [] };
  let catalog = await scanCatalog(options.roots, scan);
  const rescan = async () => {
    catalog = await scanCatalog(options.roots, scan);
    return catalog;
  };

  return Bun.serve({
    port: options.port,
    hostname: options.hostname,
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": page,
      "/api/index": {
        GET: () => Response.json(indexBody(catalog)),
        POST: async () => Response.json(indexBody(await rescan())),
      },
      "/api/trace": async (req) => {
        const id = new URL(req.url).searchParams.get("id") ?? "";
        const source = catalog.runDirs.get(id);
        if (source === undefined) return notFound(`unknown run "${id}"`);
        return Response.json(await loadTrace(source.dir, source.kind));
      },
      "/api/fixture": async (req) => {
        const params = new URL(req.url).searchParams;
        const fixtures = params.get("fixtures") ?? "";
        const task = params.get("task") ?? "";
        if (!knownFixture(catalog, fixtures, task)) return notFound("unknown fixture");
        const view = await loadFixture(fixtures, task);
        return view === null ? notFound("fixture folder is gone") : Response.json(view);
      },
    },
    fetch: () => notFound("not found"),
  });
}

function indexBody(catalog: Catalog) {
  return {
    roots: catalog.roots,
    scannedAt: catalog.scannedAt,
    batches: catalog.batches,
    taskFlags: catalog.taskFlags,
    runs: catalog.runs,
  };
}

function knownFixture(catalog: Catalog, fixtures: string, task: string): boolean {
  return catalog.batches.some(
    (b) => b.kind === "cells" && b.fixtures === fixtures && b.tasks.includes(task),
  );
}

const notFound = (message: string) => Response.json({ error: message }, { status: 404 });
