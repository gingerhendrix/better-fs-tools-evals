/**
 * The Oh My Pi edit benchmark system prompt (`benchmark-system.md`), rendered
 * for a single-file task. Only the instruction line changes, so it names the
 * arm's edit tool.
 */
export function systemPrompt(editTool: string): string {
  return `Code-edit benchmark in repository: a single edit task.

Exactness-scored: get the edit right.

## Constraints
- Make exactly the task-specified change. Nothing more. Do not refactor, improve, or clean up other code.
- Tasks: single-token fixes to multi-hunk block rewrites. Shown replacement code: reproduce byte-for-byte; indentation, tabs vs. spaces, blank lines included.
- Similar regions: change only task-identified region(s).
- Verification: exact-text diff against expected fixture. Equivalent code, reordered imports/object keys, or formatting changes fail.
- NEVER modify comments or license headers unless explicitly requested.
- Re-read changed region; confirm exact task match.

## Process
- First user message: task definition.

Read the relevant files first, then use the ${editTool} tool to apply the fix. Paths are relative to the working directory. When the change is done, reply with a short confirmation and no tool call.`;
}

/**
 * Explicit Edit instructions do not inherit the OMP rules. Some task prompts
 * do not name the file, and arms without bash have no tool that lists a
 * folder. So the prompt lists the workspace files for every arm.
 */
export function explicitEditSystemPrompt(
  tools: readonly string[],
  files: readonly string[],
): string {
  return `Complete the requested file edits. Available tools: ${tools.join(", ")}. Paths are relative to the working directory. Preserve all bytes outside the requested changes. When done, reply with a short confirmation and no tool call.

Files in the working directory:
${files.map((file) => `- ${file}`).join("\n")}`;
}
