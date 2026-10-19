import { useState } from "react";
import type { ReactNode } from "react";

import type { RunRow } from "@bfe/results";
import { href } from "./route.ts";
import { outcome, passRateExcludingErrors, percent, rateColor } from "@bfe/results/stats";
import type { Outcome, Tally } from "@bfe/results/stats";

export function OutcomeBadge({ value }: { value: Outcome }) {
  return <span className={`badge run-${value}`}>{value}</span>;
}

/** A small pass/fail square that opens the run's trace. */
export function RunChip({ run, current = false }: { run: RunRow; current?: boolean }) {
  const o = outcome(run);
  return (
    <a
      className={`chip ${o}${current ? " current" : ""}`}
      href={href("run", { id: run.id })}
      title={`${run.model} / ${run.arm} / a${run.attempt}: ${o}${run.verifyError ? ` (${run.verifyError})` : ""}`}
    >
      a{run.attempt}
    </a>
  );
}

/** "7/8" on a red-to-green background. */
export function RateCell({ tally, link }: { tally: Tally; link?: string }) {
  const graded = tally.runs - tally.incomplete;
  const rate = graded === 0 ? null : tally.pass / graded;
  const text = graded === 0 ? "-" : `${tally.pass}/${graded}`;
  const title =
    `${percent(rate)} pass (strict), ${percent(passRateExcludingErrors(tally))} with provider errors left out. ` +
    `${tally.fail} fail, ${tally.error} provider error, ${tally.incomplete} incomplete`;
  return (
    <td className="rate" style={{ background: rateColor(rate) }} title={title}>
      {link === undefined ? text : <a href={link}>{text}</a>}
      {tally.error > 0 && <sup className="err-mark">{tally.error}e</sup>}
    </td>
  );
}

/** A small "flawed" tag. The reason shows on hover. */
export function FlawBadge({ reason }: { reason: string | undefined }) {
  return (
    <span className="badge flaw" title={reason ?? "Marked flawed in task-flags.json"}>
      flawed
    </span>
  );
}

/** A `<details>` block that renders its body only once opened, so large JSON stays cheap. */
export function Lazy({
  summary,
  children,
  open = false,
}: {
  summary: ReactNode;
  children: () => ReactNode;
  open?: boolean;
}) {
  const [isOpen, setOpen] = useState(open);
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{summary}</summary>
      {isOpen && children()}
    </details>
  );
}

export function Pre({ text, className = "" }: { text: string; className?: string }) {
  return <pre className={`code ${className}`}>{text}</pre>;
}

export function DiffBlock({ text }: { text: string }) {
  if (text.trim() === "") return <p className="muted">No difference.</p>;
  return (
    <pre className="code diff">
      {text.split("\n").map((line, i) => {
        const kind = line.startsWith("@@")
          ? "hunk"
          : line.startsWith("+") && !line.startsWith("+++")
            ? "add"
            : line.startsWith("-") && !line.startsWith("---")
              ? "del"
              : "";
        return (
          <span key={i} className={kind}>
            {line}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

export function Json({ value }: { value: unknown }) {
  return <Pre text={JSON.stringify(value, null, 2)} />;
}
