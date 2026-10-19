import type { TaskSource } from "@bfe/core";

/**
 * Named task lists over the Oh My Pi fixtures. `poc-12` is a hand-picked
 * spread for the proof of concept: 4 easy, 4 medium, 3 hard, 1 nightmare.
 * It covers single-token, duplicate-line, multi-edit, and structural tasks.
 * It is not calibrated.
 *
 * `friction-v1` is frozen from a 6-model panel run on 2026-10-13: DeepSeek V4.1
 * Flash, GPT-6 Luna, Qwen 3.8 Flash, GLM-5.3 Flash, Gemini 3.8 Flash, and
 * Step 3.7 Flash. Each model ran every valid fixture twice on the `edit` arm.
 * A run has friction when it fails, has a tool error, or takes 4 or more steps.
 * Schema errors are not counted, and each one is taken off the step count.
 * The first 20 tasks had friction for 2 or more models, highest count first,
 * at most 5 of one task type. The last 5 are clean floors: no friction in any run.
 * The per-task scores are in the 2026-10-12/better-fs-tools-evals stream.
 */
export const OMP_EDIT_SUITES: Readonly<Record<string, readonly string[]>> = {
  "poc-12": [
    "call-swap-call-args-001",
    "unicode-unicode-hyphen-001",
    "duplicate-duplicate-line-flip-005",
    "identifier-identifier-multi-edit-001",
    "multi-composite-multi-edit-002",
    "structural-move-distant-block-003",
    "structural-swap-if-else-006",
    "structural-wrap-redundant-if-011",
    "identifier-identifier-multi-edit-003",
    "structural-remove-case-label-007",
    "duplicate-duplicate-line-flip-003",
    "multi-composite-multi-edit-008",
  ],
  "friction-v1": [
    // Friction, 20 tasks, in selection order.
    "multi-composite-multi-edit-012",
    "multi-composite-multi-edit-015",
    "structural-move-distant-block-003",
    "identifier-identifier-multi-edit-004",
    "structural-swap-sibling-blocks-003",
    "multi-composite-multi-edit-007",
    "multi-composite-multi-edit-008",
    "multi-composite-multi-edit-014",
    "structural-duplicate-block-003",
    "unicode-unicode-hyphen-001",
    "structural-duplicate-block-002",
    "identifier-identifier-multi-edit-002",
    "structural-wrap-redundant-if-002",
    "duplicate-duplicate-line-flip-004",
    "structural-remove-case-label-004",
    "structural-move-distant-block-008",
    "identifier-identifier-multi-edit-008",
    "structural-duplicate-block-004",
    "structural-duplicate-block-006",
    "structural-swap-if-else-001",
    // Floor, 5 tasks: one hard, one medium, three easy.
    "structural-remove-case-label-003",
    "duplicate-duplicate-line-flip-002",
    "access-remove-optional-chain-001",
    "call-swap-call-args-001",
    "literal-flip-boolean-001",
  ],
  smoke: ["call-swap-call-args-001", "structural-move-distant-block-003"],
};

/** The Oh My Pi `typescript-edit-benchmark` (MIT). Fixtures use the `omp` scorer. */
export const ompEditSource: TaskSource = {
  id: "omp-edit",
  description: "Oh My Pi typescript-edit-benchmark fixtures",
  suites: OMP_EDIT_SUITES,
};
