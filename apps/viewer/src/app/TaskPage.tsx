import type { FixtureView } from "@bfe/results";
import { DiffBlock, Pre, RateCell, RunChip } from "./components.tsx";
import { useData, useJson } from "./data.tsx";
import { href } from "./route.ts";
import type { Route } from "./route.ts";
import { groupBy, shortPath, tally } from "@bfe/results/stats";

/** One fixture: prompt, expected fix, and every attempt from the shown folders. */
export function TaskPage({ route }: { route: Route }) {
  const fixtures = route.params.get("fixtures") ?? "";
  const task = route.params.get("task") ?? "";
  const { index, runs } = useData();
  const flaw = index.taskFlags[fixtures]?.flawed[task];
  const rs = runs.filter((r) => (r.fixtures ?? "") === fixtures && r.task === task);
  const url = fixtures ? `/api/fixture?${new URLSearchParams({ fixtures, task })}` : null;
  const { data: fixture, error } = useJson<FixtureView>(url);
  const groups = [...groupBy(rs, (r) => `${r.model}\u0000${r.arm}`).values()].sort(
    (a, b) => a[0]!.model.localeCompare(b[0]!.model) || a[0]!.arm.localeCompare(b[0]!.arm),
  );

  return (
    <>
      <section>
        <h2>{task}</h2>
        <p className="muted small">
          Fixture set <a href={href("tasks", { fixtures })}>{shortPath(fixtures || null)}</a>
          {fixture && (
            <>
              {" "}
              · {fixture.difficulty ?? "-"} · {fixture.mutationType ?? "-"} ·{" "}
              {fixture.fileLines ?? "?"} lines
            </>
          )}
        </p>
        {flaw !== undefined && (
          <p className="flaw-note">
            <strong>Flawed task.</strong> {flaw} Clean scores leave this task out.
          </p>
        )}
        {error && <p className="error">Fixture: {error}</p>}
        {fixture && (
          <div className="two-col">
            <div>
              <h3>Prompt</h3>
              <Pre text={fixture.prompt} />
            </div>
            <div>
              <h3>Expected fix</h3>
              <DiffBlock text={fixture.expectedDiff} />
            </div>
          </div>
        )}
      </section>
      <section>
        <h2>
          Runs <span className="muted small">({rs.length})</span>
        </h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Model</th>
              <th>Arm</th>
              <th>Pass</th>
              <th>Attempts</th>
              <th>Fail reasons</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const { model, arm } = g[0]!;
              const reasons = [
                ...new Set(
                  g.filter((r) => !r.passed).map((r) => r.verifyError ?? r.loopError ?? r.end),
                ),
              ];
              return (
                <tr key={`${model}/${arm}`}>
                  <td>{model}</td>
                  <td>{arm}</td>
                  <RateCell tally={tally(g)} />
                  <td>
                    {[...g]
                      .sort((a, b) => a.batch.localeCompare(b.batch) || a.attempt - b.attempt)
                      .map((r) => (
                        <RunChip key={r.id} run={r} />
                      ))}
                  </td>
                  <td className="small muted">{reasons.join("; ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
