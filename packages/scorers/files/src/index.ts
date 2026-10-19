import type { ScorerResolver } from "@bfe/core";

import { taskVerifier } from "./verify.ts";

export { compareFile, taskVerifier, verifyExactWorkspace, verifyWorkspace } from "./verify.ts";

/** Resolves the `omp` and `exact` scorer ids. */
export const fileScorers: ScorerResolver = (id) => taskVerifier(id);
