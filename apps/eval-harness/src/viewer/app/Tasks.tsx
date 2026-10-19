import { FlawBadge, RateCell } from "./components.tsx";
import { useData } from "./data.tsx";
import type { RunRow } from "./data.tsx";
import { href, setParams } from "./route.ts";
import type { Route } from "./route.ts";
import { groupBy, inScope, parseScope, passRate, shortModel, shortPath, tally } from "./stats.ts";
import type { TaskScope } from "./stats.ts";

interface Column {
  readonly model: string;
  readonly arm: string;
}

/** Rows are tasks, columns are model x arm, each cell is passes over graded runs. */
export function Tasks({ route }: { route: Route }) {
  const { index, runs } = useData();
  const sets = [...groupBy(runs, (r) => r.fixtures ?? "").entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const fixtures = route.params.get("fixtures") ?? sets[0]?.[0] ?? "";
  const sort = route.params.get("sort") ?? "id";
  const flaws = index.taskFlags[fixtures]?.flawed;
  const scope = flaws === undefined ? "all" : parseScope(route.params.get("scope"));
  const rs = runs.filter((r) => (r.fixtures ?? "") === fixtures);

  const models = [...new Set(rs.map((r) => r.model))].sort();
  const columns: Column[] = models.flatMap((model) =>
    [...new Set(rs.filter((r) => r.model === model).map((r) => r.arm))]
      .sort()
      .map((arm) => ({ model, arm })),
  );
  const byTask = groupBy(rs, (r) => r.task);
  const cell = (task: readonly RunRow[], model: string, arm: string) =>
    task.filter((r) => r.model === model && r.arm === arm);

  const tasks = [...byTask.entries()]
    .filter(([, list]) => list.some((r) => inScope(r, scope)))
    .sort((a, b) =>
      sort === "rate"
        ? (passRate(tally(a[1])) ?? 2) - (passRate(tally(b[1])) ?? 2) || a[0].localeCompare(b[0])
        : a[0].localeCompare(b[0]),
    );

  return (
    <section>
      <h2>Tasks</h2>
      <div className="filters">
        <label>
          Fixture set{" "}
          <select value={fixtures} onChange={(e) => setParams(route, { fixtures: e.target.value })}>
            {sets.map(([f, list]) => (
              <option key={f} value={f}>
                {shortPath(f || null)} ({list.length} runs)
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort{" "}
          <select value={sort} onChange={(e) => setParams(route, { sort: e.target.value })}>
            <option value="id">by task id</option>
            <option value="rate">hardest first</option>
          </select>
        </label>
        {flaws !== undefined && (
          <label>
            Tasks{" "}
            <select value={scope} onChange={(e) => setParams(route, { scope: e.target.value })}>
              <option value="all">all</option>
              <option value="clean">clean only</option>
              <option value="flawed">flawed only</option>
            </select>
          </label>
        )}
        <span className="muted small">
          Click a cell to list its runs. Click a task for its prompt, expected fix, and every
          attempt.
        </span>
      </div>
      <div className="scroll-x">
        <table className="grid matrix">
          <thead>
            <tr>
              <th rowSpan={2}>Task</th>
              <th rowSpan={2}>Difficulty</th>
              <th rowSpan={2}>All</th>
              {models.map((m) => (
                <th
                  key={m}
                  colSpan={columns.filter((c) => c.model === m).length}
                  className="group"
                  title={m}
                >
                  {shortModel(m)}
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((c) => (
                <th key={`${c.model}/${c.arm}`} className="small">
                  {c.arm}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map(([task, list]) => (
              <tr key={task} className={flaws?.[task] === undefined ? "" : "flawed"}>
                <td className="nowrap">
                  <a href={href("task", { fixtures, task })}>{task}</a>
                  {flaws?.[task] !== undefined && <FlawBadge reason={flaws[task]} />}
                </td>
                <td className="small">{list[0]?.difficulty ?? "-"}</td>
                <RateCell tally={tally(list)} link={href("runs", { fixtures, task })} />
                {columns.map((c) => (
                  <RateCell
                    key={`${c.model}/${c.arm}`}
                    tally={tally(cell(list, c.model, c.arm))}
                    link={href("runs", { fixtures, task, model: c.model, arm: c.arm })}
                  />
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <TotalRow label="All" fixtures={fixtures} runs={rs} columns={columns} scope="all" />
            {flaws !== undefined && (
              <>
                <TotalRow
                  label="Clean"
                  fixtures={fixtures}
                  runs={rs}
                  columns={columns}
                  scope="clean"
                />
                <TotalRow
                  label="Flawed"
                  fixtures={fixtures}
                  runs={rs}
                  columns={columns}
                  scope="flawed"
                />
              </>
            )}
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** A footer row: pooled score for each column over the tasks in one scope. */
function TotalRow(props: {
  label: string;
  fixtures: string;
  runs: readonly RunRow[];
  columns: readonly Column[];
  scope: TaskScope;
}) {
  const { fixtures, columns, scope } = props;
  const rs = props.runs.filter((r) => inScope(r, scope));
  const tasks = new Set(rs.map((r) => r.task)).size;
  const filter = { fixtures, scope: scope === "all" ? null : scope };
  return (
    <tr>
      <th className="nowrap">
        {props.label} {tasks} tasks
      </th>
      <th />
      <RateCell tally={tally(rs)} link={href("runs", filter)} />
      {columns.map((c) => (
        <RateCell
          key={`${c.model}/${c.arm}`}
          tally={tally(rs.filter((r) => r.model === c.model && r.arm === c.arm))}
          link={href("runs", { ...filter, model: c.model, arm: c.arm })}
        />
      ))}
    </tr>
  );
}
