import type { FixtureView } from "@bfe/results";
import type { Trace } from "@bfe/results";
import { DiffBlock, Json, Lazy, OutcomeBadge, Pre, RunChip } from "./components.tsx";
import { useData, useJson } from "./data.tsx";
import { href } from "./route.ts";
import type { Route } from "./route.ts";
import {
  attemptLabel,
  fmtInt,
  fmtScore,
  fmtSecs,
  fmtUsd,
  groupBy,
  outcome,
  shortPath,
} from "@bfe/results/stats";
import { TraceSteps } from "./TraceSteps.tsx";

/** The full trace of one run, with its score and links to the other attempts at the same task. */
export function RunPage({ route }: { route: Route }) {
  const id = route.params.get("id") ?? "";
  const { index } = useData();
  const run = index.runs.find((r) => r.id === id);
  const { data: trace, error } = useJson<Trace>(`/api/trace?id=${encodeURIComponent(id)}`);
  const fixtureUrl =
    run?.kind === "cells" && run.fixtures !== null
      ? `/api/fixture?${new URLSearchParams({ fixtures: run.fixtures, task: run.task })}`
      : null;
  const { data: fixture } = useJson<FixtureView>(fixtureUrl);

  if (run === undefined)
    return <p className="error">Unknown run {id}. Try Rescan on the overview page.</p>;
  const siblings = index.runs.filter((r) => r.fixtures === run.fixtures && r.task === run.task);
  const failedHttp = trace?.http.filter((h) => h.status !== 200) ?? [];

  return (
    <>
      <section>
        <h2>
          <OutcomeBadge value={outcome(run)} /> {run.task}
        </h2>
        <p className="muted small">
          {run.model} · {run.arm} · {attemptLabel(run)}
          {run.step && <> · {run.step}</>} · folder{" "}
          <a href={href("runs", { batch: run.batch })}>{run.batch}</a> · fixtures{" "}
          <a href={href("task", { fixtures: run.fixtures, task: run.task })}>
            {shortPath(run.fixtures)}
          </a>
        </p>
        <dl className="facts">
          <Fact label="End state" value={run.end} />
          {run.kind === "cells" && (
            <Fact label="Lines off expected" value={run.linesChanged ?? "-"} />
          )}
          {run.score !== null && <Fact label="Score" value={fmtScore(run.score)} />}
          <Fact label="Verifier" value={run.verifyError ?? (run.passed ? "pass" : "-")} />
          {run.loopError && <Fact label="Loop error" value={run.loopError} />}
          <Fact label="Steps" value={run.steps} />
          <Fact label="Tool calls" value={run.toolCalls} />
          <Fact
            label="Tool errors"
            value={
              Object.entries(run.toolErrorCodes)
                .map(([k, v]) => `${k} x${v}`)
                .join(", ") || "0"
            }
          />
          <Fact label="Input tokens" value={fmtInt(run.inputTokens)} />
          <Fact
            label="Output tokens"
            value={`${fmtInt(run.outputTokens)} (reasoning ${fmtInt(run.reasoningTokens)})`}
          />
          <Fact label="Wall s" value={fmtSecs(run.wallMs)} />
          <Fact label="Cost" value={fmtUsd(run.costUsd)} />
          {run.kind === "cells" && (
            <Fact
              label="Difficulty"
              value={`${run.difficulty ?? "-"} / ${run.mutationType ?? "-"}`}
            />
          )}
        </dl>
        <Siblings runs={siblings} current={run.id} />
      </section>
      <section>
        {error && <p className="error">Trace: {error}</p>}
        {!trace && !error && <p className="muted">Loading trace...</p>}
        {trace && (
          <>
            <Lazy summary={<strong>Prompt (user message)</strong>} open>
              {() => <Pre text={trace.prompt ?? fixture?.prompt ?? "(not recorded)"} />}
            </Lazy>
            {run.kind === "cells" && (
              <Lazy summary={<strong>Expected fix</strong>} open>
                {() =>
                  fixture ? (
                    <DiffBlock text={fixture.expectedDiff} />
                  ) : (
                    <p className="muted">Fixture not available.</p>
                  )
                }
              </Lazy>
            )}
            {trace.files !== null && (
              <Lazy
                summary={<strong>Files after this step ({Object.keys(trace.files).length})</strong>}
              >
                {() =>
                  Object.entries(trace.files ?? {}).map(([name, text]) => (
                    <Lazy key={name} summary={<span className="label">{name}</span>}>
                      {() => <Pre text={text} className="tall" />}
                    </Lazy>
                  ))
                }
              </Lazy>
            )}
            {trace.patch !== null && (
              <Lazy summary={<strong>Patch the verifier scored</strong>}>
                {() => <DiffBlock text={trace.patch ?? ""} />}
              </Lazy>
            )}
            <Lazy summary={<strong>System prompt</strong>}>
              {() => <Pre text={trace.system ?? "(not recorded)"} />}
            </Lazy>
            <Lazy summary={<strong>Tools ({trace.tools.map((t) => t.name).join(", ")})</strong>}>
              {() =>
                trace.tools.map((t) => (
                  <div key={t.name} className="part">
                    <div className="label">{t.name}</div>
                    <Pre text={t.description} />
                    <Lazy summary="parameters">{() => <Json value={t.parameters} />}</Lazy>
                  </div>
                ))
              }
            </Lazy>
            {failedHttp.length > 0 && (
              <Lazy
                summary={<strong className="error">{failedHttp.length} failed HTTP calls</strong>}
              >
                {() =>
                  failedHttp.map((h, i) => (
                    <div key={i} className="part">
                      <div className="label">
                        {h.at} · status {h.status} · {h.ms} ms
                      </div>
                      <Pre text={h.error ?? ""} />
                    </div>
                  ))
                }
              </Lazy>
            )}
            <h3>Trace</h3>
            <TraceSteps steps={trace.steps} toolOutputs={trace.toolOutputs} />
            <Lazy
              summary={
                <strong>{run.kind === "relays" ? "interaction.json" : "result.json"}</strong>
              }
            >
              {() => <Json value={trace.result} />}
            </Lazy>
          </>
        )}
      </section>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Every attempt at this task, grouped by model and arm, so a pass and a fail are one click apart. */
function Siblings({
  runs,
  current,
}: {
  runs: ReturnType<typeof useData>["index"]["runs"];
  current: string;
}) {
  const groups = [...groupBy(runs, (r) => `${r.model}\u0000${r.arm}`).values()].sort(
    (a, b) => a[0]!.model.localeCompare(b[0]!.model) || a[0]!.arm.localeCompare(b[0]!.arm),
  );
  return (
    <details className="siblings">
      <summary>Other runs of this task ({runs.length})</summary>
      <table className="grid compact">
        <tbody>
          {groups.map((g) => (
            <tr key={`${g[0]!.model}/${g[0]!.arm}`}>
              <td className="small">{g[0]!.model}</td>
              <td className="small">{g[0]!.arm}</td>
              <td>
                {g.map((r) => (
                  <RunChip key={r.id} run={r} current={r.id === current} />
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
