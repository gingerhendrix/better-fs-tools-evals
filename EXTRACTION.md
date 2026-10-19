# Extraction record

This repository holds the Better FS Tools eval harness. The harness came from the
`better-fs-tools` repository on 2026-10-19. This file records where the code came from.

## Source

| Item | Value |
|---|---|
| Source repository | `better-fs-tools` (local worktrees under `repos/better-fs-tools/`) |
| Branch `feature-eval-harness` | `e0ab601750ffe5e8c31dbf49c4d79c9bde988a0d` |
| Branch `feature-eval-explicit-edit` | `657ff14476ea3a2eebef0aead0a028d1a285d17b` |
| Merge base with tool `main` | `77b3d76a0b86406718e08037485f8877f42c2c32` |
| Combined tree | `692786d5e6b05e5c5651a8d84188306720e4b6b4` |

The two branches had diverged. `feature-eval-explicit-edit` was two commits ahead of
`feature-eval-harness`, and one commit behind it. The combined tree is the output of
`git merge-tree --write-tree e0ab601 657ff14`. That merge had no conflicts. Neither
source branch was changed.

## What came across

- `apps/eval-harness/` in full: source, tests, README, and the Harbor agent.
- `scripts/export-explicit-edit.ts`, the Explicit Edit fixture exporter.

The first commit holds these files as they were, at their old paths. Later commits
split them into the workspace packages. `docs/architecture.md` describes that layout.

## What stayed behind

- The tool packages (`@better-fs-tools/*`). This repository uses the published
  versions from npm. The source harness used `workspace:^` links, so its runs tested
  the tool code on the eval branch. That code is older than release 0.3.0.
- Root `bun.lock` and `tsconfig.json` changes in the source branches. They only
  registered the harness in the tool workspace.
- Fixtures, run output, and Harbor images. They stay in dated workspace scratch folders.

## History

This is a clean import, as the layout proposal recommended. The commit history stays on
the source branches. Use `git log e0ab601` or `git log 657ff14` in `better-fs-tools`
for `git blame` across the move.
