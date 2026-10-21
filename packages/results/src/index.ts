// Node-side read API. Browser code imports `@bfe/results/stats` instead,
// and imports types from here with `import type`.
export { readJson, scanCatalog } from "./catalog.ts";
export type { Batch, BatchKind, Catalog, RunRow, RunSource, ScanOptions } from "./catalog.ts";
export { loadFixture } from "./fixture.ts";
export type { FixtureView } from "./fixture.ts";
export { loadTaskFlags, TASK_FLAGS_FILE } from "./flags.ts";
export type { TaskFlags } from "./flags.ts";
export { COMMAND_CODE_RATE_CARD, runCostUsd } from "./pricing.ts";
export type { TokenRate, TokenRateCard } from "./pricing.ts";
export { collectResults, readCellResult } from "./read.ts";
export {
  collectRelays,
  CRITICAL_DROP,
  criticalErrors,
  interactionCostUsd,
  relayReport,
  relayScores,
} from "./relay-report.ts";
export { markdownReport, summarise } from "./report.ts";
export type { GroupSummary } from "./report.ts";
export { loadTrace, partsText } from "./trace.ts";
export type { HttpCall, Trace, TraceStep, TraceTool } from "./trace.ts";
