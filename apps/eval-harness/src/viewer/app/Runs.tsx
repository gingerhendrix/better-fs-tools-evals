import { useState } from "react";
import type { ReactNode } from "react";

import { OutcomeBadge } from "./components.tsx";
import { useData } from "./data.tsx";
import type { RunRow } from "./data.tsx";
import { href, setParams } from "./route.ts";
import type { Route } from "./route.ts";
import {
  fmtInt,
  fmtSecs,
  fmtUsd,
  inScope,
  outcome,
  parseScope,
  percent,
  passRate,
  shortModel,
  shortPath,
  tally,
} from "./stats.ts";

const PAGE = 300;

interface Column {
  readonly key: string;
  readonly label: string;
  readonly value: (r: RunRow) => string | number;
  readonly cell?: (r: RunRow) => ReactNode;
  readonly num?: boolean;
}

const COLUMNS: readonly Column[] = [
  { key: "batch", label: "Folder", value: (r) => r.batch },
  { key: "model", label: "Model", value: (r) => r.model, cell: (r) => shortModel(r.model) },
  { key: "arm", label: "Arm", value: (r) => r.arm },
  { key: "task", label: "Task", value: (r) => r.task },
  { key: "attempt", label: "Att", value: (r) => r.attempt, num: true },
  {
    key: "outcome",
    label: "Result",
    value: (r) => outcome(r),
    cell: (r) => <OutcomeBadge value={outcome(r)} />,
  },
  { key: "end", label: "End", value: (r) => r.end },
  {
    key: "linesChanged",
    label: "Lines off",
    value: (r) => r.linesChanged ?? -1,
    cell: (r) => r.linesChanged ?? "-",
    num: true,
  },
  { key: "steps", label: "Steps", value: (r) => r.steps, num: true },
  { key: "toolErrors", label: "Tool err", value: (r) => r.toolErrors, num: true },
  {
    key: "inputTokens",
    label: "In tok",
    value: (r) => r.inputTokens,
    cell: (r) => fmtInt(r.inputTokens),
    num: true,
  },
  {
    key: "outputTokens",
    label: "Out tok",
    value: (r) => r.outputTokens,
    cell: (r) => fmtInt(r.outputTokens),
    num: true,
  },
  {
    key: "wallMs",
    label: "Wall s",
    value: (r) => r.wallMs ?? 0,
    cell: (r) => fmtSecs(r.wallMs),
    num: true,
  },
  {
    key: "costUsd",
    label: "$",
    value: (r) => r.costUsd ?? 0,
    cell: (r) => fmtUsd(r.costUsd),
    num: true,
  },
];

/** Every run that matches the filters in the url, with sortable columns. */
export function Runs({ route }: { route: Route }) {
  const { runs } = useData();
  const [limit, setLimit] = useState(PAGE);
  const p = (k: string) => route.params.get(k) ?? "";
  const filtered = runs.filter((r) => matches(r, route.params));
  const sortKey = p("sort") || "task";
  const desc = p("dir") === "desc";
  const column = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[3]!;
  const sorted = [...filtered].sort((a, b) => {
    const x = column.value(a);
    const y = column.value(b);
    const order =
      typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (desc ? -order : order) || a.id.localeCompare(b.id);
  });
  const t = tally(filtered);

  const options = (pick: (r: RunRow) => string | null) =>
    [...new Set(runs.map((r) => pick(r) ?? ""))].sort();
  const select = (key: string, label: string, values: string[], show = (v: string) => v) => (
    <label>
      {label}{" "}
      <select value={p(key)} onChange={(e) => setParams(route, { [key]: e.target.value })}>
        <option value="">all</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {show(v)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section>
      <h2>
        Runs{" "}
        <span className="muted small">
          {filtered.length} match: {t.pass} pass, {t.fail} fail, {t.error} provider error,{" "}
          {t.incomplete} incomplete · strict pass rate {percent(passRate(t))}
        </span>
      </h2>
      <div className="filters">
        {select(
          "fixtures",
          "Fixtures",
          options((r) => r.fixtures),
          (v) => shortPath(v || null),
        )}
        {select(
          "batch",
          "Folder",
          options((r) => r.batch),
        )}
        {select(
          "model",
          "Model",
          options((r) => r.model),
        )}
        {select(
          "arm",
          "Arm",
          options((r) => r.arm),
        )}
        {select("outcome", "Result", ["pass", "fail", "error", "incomplete"])}
        {select("scope", "Tasks", ["clean", "flawed"])}
        <label>
          Task{" "}
          <input
            value={p("q") || p("task")}
            placeholder="id or part"
            onChange={(e) => setParams(route, { q: e.target.value, task: null })}
          />
        </label>
        <label>
          Tool error{" "}
          <input
            value={p("toolError")}
            placeholder="e.g. write:NOT_READ"
            onChange={(e) => setParams(route, { toolError: e.target.value })}
          />
        </label>
        <a href={href("runs")}>clear</a>
      </div>
      <div className="scroll-x">
        <table className="grid runs">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="sortable"
                  onClick={() =>
                    setParams(route, {
                      sort: c.key,
                      dir: c.key === sortKey && !desc ? "desc" : null,
                    })
                  }
                >
                  {c.label}
                  {c.key === sortKey ? (desc ? " ▼" : " ▲") : ""}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r) => (
              <tr
                key={r.id}
                className="clickable"
                onClick={() => (window.location.hash = href("run", { id: r.id }))}
              >
                {COLUMNS.map((c) => (
                  <td key={c.key} className={c.num ? "num" : c.key === "batch" ? "small" : ""}>
                    {c.cell ? c.cell(r) : c.value(r)}
                  </td>
                ))}
                <td>
                  <a href={href("run", { id: r.id })}>trace</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <p>
          Showing {limit} of {sorted.length}.{" "}
          <button onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, sorted.length - limit)} more
          </button>{" "}
          <button onClick={() => setLimit(sorted.length)}>Show all</button>
        </p>
      )}
    </section>
  );
}

/**
 * Exact match on the select filters and `task`, `scope` keeps clean or flawed tasks, substring match on `q` (task id) and tool error code. */
function matches(r: RunRow, params: URLSearchParams): boolean {
  const exact: Array<[string, string]> = [
    ["fixtures", r.fixtures ?? ""],
    ["batch", r.batch],
    ["model", r.model],
    ["arm", r.arm],
    ["outcome", outcome(r)],
    ["task", r.task],
  ];
  for (const [key, value] of exact) {
    if (params.has(key) && params.get(key) !== value) return false;
  }
  if (!inScope(r, parseScope(params.get("scope")))) return false;
  const q = params.get("q");
  if (q && !r.task.includes(q)) return false;
  const code = params.get("toolError")?.toLowerCase();
  if (code && !Object.keys(r.toolErrorCodes).some((k) => k.toLowerCase().includes(code)))
    return false;
  return true;
}
