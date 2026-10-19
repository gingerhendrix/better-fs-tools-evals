import type { TaskSource } from "@bfe/core";

/**
 * Named task lists over the exported Explicit Edit fixtures. `ee-smoke` has 4 tasks.
 * `ee-hard-40` is the fixed 40-task slice. Every `ee-smoke` task is in `ee-hard-40`.
 */
export const EXPLICIT_EDIT_SUITES: Readonly<Record<string, readonly string[]>> = {
  "ee-smoke": [
    "literal-1-crlf-plain",
    "unicode-fix-1-nbsp-unicode",
    "select-one-1000-plain",
    "move-block-100-plain",
  ],
  "ee-hard-40": [
    "select-one-10-plain",
    "select-one-100-plain",
    "select-one-1000-plain",
    "unique-1000-plain",
    "replace-all-100-plain",
    "replace-all-1000-plain",
    "delete-subset-10-plain",
    "delete-subset-100-plain",
    "delete-subset-1000-plain",
    "delete-subset-10-unicode",
    "delete-subset-100-unicode",
    "delete-subset-1000-unicode",
    "select-subset-100-plain",
    "insert-subset-100-plain",
    "replace-block-1000-plain",
    "move-block-100-plain",
    "move-block-1000-plain",
    "move-block-1000-unicode",
    "copy-block-1000-plain",
    "move-between-100-plain",
    "copy-within-100-plain",
    "insert-payload-1000-plain",
    "distinct-edits-10-plain",
    "multi-file-10-plain",
    "literal-1-regex-plain",
    "literal-1-quotes-plain",
    "literal-1-crlf-plain",
    "literal-1-tabs-plain",
    "literal-1-no-final-newline-plain",
    "language-insert-1-markdown-mixed-plain",
    "language-insert-1-json-plain",
    "language-select-10-yaml-plain",
    "unicode-fix-1-cyrillic-a-unicode",
    "unicode-fix-1-decomposed-unicode",
    "unicode-fix-1-minus-unicode",
    "unicode-fix-1-narrow-space-unicode",
    "unicode-fix-1-nbsp-unicode",
    "unicode-fix-1-nonbreaking-hyphen-unicode",
    "unicode-fix-1-word-joiner-unicode",
    "unicode-fix-1-zero-width-unicode",
  ],
};

/** The Explicit Edit benchmark (MIT). The exporter writes `verify: "exact"` into each fixture. */
export const explicitEditSource: TaskSource = {
  id: "explicit-edit",
  description: "Explicit Edit fixtures, exported from an upstream clone",
  suites: EXPLICIT_EDIT_SUITES,
};
