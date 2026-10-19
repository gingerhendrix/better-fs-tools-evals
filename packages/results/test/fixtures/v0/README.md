# Version 0 run folders

Copies of two real run folders. `test/v0-runs.test.ts` reads them to check that the
read side still understands every run to date.

| Folder | Source | Notes |
|---|---|---|
| `omp-smoke-2026-09-28` | `scratch/2026-09-28-omp-bench-poc/smoke` | Oldest run shape. No `verify`, `damage`, or `provenance`. |
| `explicit-edit-stage3-glm-2026-10-18` | `scratch/2026-10-17-explicit-edit-run/stage3-glm`, the two `literal-1-crlf-plain` cells | Exact scorer at `657ff14`, with file-list prompt, provenance, and one provider error with byte damage. |

Changes from the originals:

- `workspace/` folders and `report.md` are left out.
- The manifest `fixtures` path is replaced with `/fixtures-not-present/...`, so the tests
  do not read fixture folders or `task-flags.json` from the machine that runs them.

Every other byte is as recorded. `.oxfmtrc.json` keeps the formatter away from this folder.
The HTTP logs hold request and response bodies only, with no headers. The task text comes
from public benchmarks.
