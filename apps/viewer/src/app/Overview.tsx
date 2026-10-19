import { useState } from "react";

import { RateCell } from "./components.tsx";
import { useData } from "./data.tsx";
import { href } from "./route.ts";
import {
  fmtInt,
  fmtSecs,
  fmtUsd,
  groupBy,
  mean,
  shortModel,
  shortPath,
  tally,
} from "@bfe/results/stats";

/** Batches with on/off ticks, then a model x arm score table for each fixture set. */
export function Overview() {
  const { index, runs, selected, setSelected, rescan } = useData();
  const [busy, setBusy] = useState(false);
  const byBatch = groupBy(index.runs, (r) => r.batch);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <>
      <section>
        <h2>
          Run folders{" "}
          <span className="muted small">
            ({index.batches.length} found, {selected.size} shown)
          </span>
        </h2>
        <p className="muted small">
          Roots: {index.roots.join(", ")}. Scanned{" "}
          {new Date(index.scannedAt).toLocaleString("en-GB")}.{" "}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await rescan();
              setBusy(false);
            }}
          >
            {busy ? "Scanning..." : "Rescan"}
          </button>{" "}
          <button onClick={() => setSelected(new Set(index.batches.map((b) => b.id)))}>
            Show all
          </button>{" "}
          <button onClick={() => setSelected(new Set())}>Hide all</button>
        </p>
        <table className="grid">
          <thead>
            <tr>
              <th />
              <th>Folder</th>
              <th>Created</th>
              <th>Fixtures</th>
              <th>Models</th>
              <th>Arms</th>
              <th>Runs</th>
              <th>Pass</th>
            </tr>
          </thead>
          <tbody>
            {[...index.batches].reverse().map((b) => {
              const rs = byBatch.get(b.id) ?? [];
              const t = tally(rs);
              const planned = b.tasks.length * b.models.length * b.arms.length * (b.attempts ?? 1);
              return (
                <tr key={b.id} className={selected.has(b.id) ? "" : "dim"}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggle(b.id)}
                    />
                  </td>
                  <td>
                    <a href={href("runs", { batch: b.id })}>{b.id}</a>
                  </td>
                  <td className="nowrap">
                    {b.created ? new Date(b.created).toLocaleString("en-GB") : "-"}
                  </td>
                  <td className="small">{shortPath(b.fixtures)}</td>
                  <td className="small">{b.models.map(shortModel).join(", ")}</td>
                  <td className="small">{b.arms.join(", ")}</td>
                  <td className="num">
                    {t.runs - t.incomplete}/{planned}
                  </td>
                  <RateCell tally={t} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <ScoreTables />
      {runs.length === 0 && <p className="muted">No runs in the shown folders.</p>}
    </>
  );
}

function ScoreTables() {
  const { index, runs } = useData();
  const sets = [...groupBy(runs, (r) => r.fixtures ?? "").entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  return (
    <>
      {sets.map(([fixtures, rs]) => {
        const groups = [...groupBy(rs, (r) => `${r.model}\u0000${r.arm}`).values()].sort(
          (a, b) => a[0]!.model.localeCompare(b[0]!.model) || a[0]!.arm.localeCompare(b[0]!.arm),
        );
        const tasks = new Set(rs.map((r) => r.task)).size;
        const flawed = new Set(rs.filter((r) => r.flawed).map((r) => r.task)).size;
        const hasFlags = index.taskFlags[fixtures] !== undefined;
        return (
          <section key={fixtures}>
            <h2>
              Scores: {shortPath(fixtures || null)}{" "}
              <span className="muted small">
                ({tasks} tasks, {rs.length} runs){" "}
                <a href={href("tasks", { fixtures })}>task matrix</a>
              </span>
            </h2>
            {hasFlags && (
              <p className="muted small">
                {flawed} tasks are marked flawed in task-flags.json. "Clean" scores the other{" "}
                {tasks - flawed}. Hover a cell for the rate with provider errors left out.
              </p>
            )}
            <table className="grid">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Arm</th>
                  <th>Pass</th>
                  {hasFlags && <th>Clean {tasks - flawed}</th>}
                  <th>Fail</th>
                  <th>Provider err</th>
                  <th>Steps</th>
                  <th>Tool err / run</th>
                  <th>Input tok</th>
                  <th>Output tok</th>
                  <th>Wall s</th>
                  <th>$ total</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const { model, arm } = g[0]!;
                  const t = tally(g);
                  const done = g.filter((r) => r.end !== "incomplete");
                  const costs = done.map((r) => r.costUsd);
                  const cost = costs.includes(null)
                    ? null
                    : costs.reduce<number>((a, c) => a + (c ?? 0), 0);
                  return (
                    <tr key={`${model}/${arm}`}>
                      <td>{model}</td>
                      <td>{arm}</td>
                      <RateCell tally={t} link={href("runs", { fixtures, model, arm })} />
                      {hasFlags && (
                        <RateCell
                          tally={tally(g.filter((r) => !r.flawed))}
                          link={href("runs", { fixtures, model, arm, scope: "clean" })}
                        />
                      )}
                      <td className="num">
                        <a href={href("runs", { fixtures, model, arm, outcome: "fail" })}>
                          {t.fail}
                        </a>
                      </td>
                      <td className="num">
                        <a href={href("runs", { fixtures, model, arm, outcome: "error" })}>
                          {t.error}
                        </a>
                      </td>
                      <td className="num">{mean(done.map((r) => r.steps)).toFixed(1)}</td>
                      <td className="num">{mean(done.map((r) => r.toolErrors)).toFixed(2)}</td>
                      <td className="num">{fmtInt(mean(done.map((r) => r.inputTokens)))}</td>
                      <td className="num">{fmtInt(mean(done.map((r) => r.outputTokens)))}</td>
                      <td className="num">{fmtSecs(mean(done.map((r) => r.wallMs ?? 0)))}</td>
                      <td className="num">{fmtUsd(cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
