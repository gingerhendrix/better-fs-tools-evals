import type { TraceStep } from "@bfe/results";
import { Json, Lazy, Pre } from "./components.tsx";
import { fmtInt } from "@bfe/results/stats";

type Part = Record<string, unknown>;

/** Every model call in order: reasoning, text, and each tool call with the result the model saw. */
export function TraceSteps({
  steps,
  toolOutputs,
}: {
  steps: readonly TraceStep[];
  toolOutputs: Record<string, string>;
}) {
  if (steps.length === 0) return <p className="muted">This run has no steps.jsonl lines.</p>;
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.step} className="step">
          <div className="step-head">
            <strong>Step {s.step + 1}</strong>
            <span className="muted small">
              {s.finishReason ?? "?"} · {usageText(s.usage)}
            </span>
          </div>
          <StepParts parts={s.content} toolOutputs={toolOutputs} />
        </li>
      ))}
    </ol>
  );
}

function StepParts({
  parts,
  toolOutputs,
}: {
  parts: readonly Part[];
  toolOutputs: Record<string, string>;
}) {
  const results = new Map<string, Part>();
  for (const p of parts) {
    if ((p.type === "tool-result" || p.type === "tool-error") && typeof p.toolCallId === "string") {
      results.set(p.toolCallId, p);
    }
  }
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "reasoning") {
          const text = String(p.text ?? "");
          return text.trim() === "" ? null : (
            <div key={i} className="part reasoning">
              <div className="label">reasoning</div>
              <Pre text={text} />
            </div>
          );
        }
        if (p.type === "text") {
          return (
            <div key={i} className="part text">
              <div className="label">assistant</div>
              <Pre text={String(p.text ?? "")} />
            </div>
          );
        }
        if (p.type === "tool-call") {
          const id = String(p.toolCallId ?? "");
          return <ToolCall key={i} call={p} result={results.get(id)} modelText={toolOutputs[id]} />;
        }
        if (p.type === "tool-result" || p.type === "tool-error") {
          const id = String(p.toolCallId ?? "");
          const hasCall = parts.some((c) => c.type === "tool-call" && c.toolCallId === id);
          return hasCall ? null : (
            <ToolCall key={i} call={p} result={p} modelText={toolOutputs[id]} />
          );
        }
        return (
          <div key={i} className="part">
            <div className="label">{String(p.type)}</div>
            <Json value={p} />
          </div>
        );
      })}
    </>
  );
}

function ToolCall({
  call,
  result,
  modelText,
}: {
  call: Part;
  result: Part | undefined;
  modelText: string | undefined;
}) {
  const input = isRecord(call.input) ? call.input : {};
  const short = Object.entries(input).filter(([, v]) => !isLong(v));
  const long = Object.entries(input).filter(([, v]) => isLong(v));
  const status = resultStatus(result);
  return (
    <div className={`part tool ${status.kind}`}>
      <div className="tool-head">
        <span className="tool-name">{String(call.toolName ?? "?")}</span>
        <code className="tool-args">
          {short
            .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join("  ")}
        </code>
        <span className={`badge ${status.kind}`}>{status.label}</span>
      </div>
      {long.map(([k, v]) => (
        <div key={k} className="tool-field">
          <div className="label">
            {k} <span className="muted">({String(v).length} chars)</span>
          </div>
          <Pre text={typeof v === "string" ? v : JSON.stringify(v, null, 2)} className="tall" />
        </div>
      ))}
      {status.message && <p className="tool-error">{status.message}</p>}
      {modelText !== undefined && (
        <Lazy
          summary={<span className="label">result the model saw ({modelText.length} chars)</span>}
          open={modelText.length < 600}
        >
          {() => <Pre text={modelText} className="tall" />}
        </Lazy>
      )}
      {modelText === undefined && result !== undefined && (
        <p className="muted small">
          No later request holds this result, so the model never received it (the run stopped here).
        </p>
      )}
      {result !== undefined && (
        <Lazy summary={<span className="label">raw tool result</span>}>
          {() => <Json value={result.type === "tool-error" ? result.error : result.output} />}
        </Lazy>
      )}
    </div>
  );
}

/** Better FS Tools results carry `status` and an `error.code`; AI SDK tool errors carry a message. */
function resultStatus(result: Part | undefined): {
  kind: string;
  label: string;
  message: string | null;
} {
  if (result === undefined) return { kind: "pending", label: "no result", message: null };
  if (result.type === "tool-error")
    return { kind: "error", label: "tool-error", message: String(result.error) };
  const output = isRecord(result.output) ? result.output : {};
  const status = typeof output.status === "string" ? output.status : "ok";
  const error = isRecord(output.error) ? output.error : null;
  if (error !== null) {
    return {
      kind: "error",
      label: `${status}: ${String(error.code ?? "?")}`,
      message: String(error.message ?? ""),
    };
  }
  return { kind: status === "ok" ? "ok" : "warn", label: status, message: null };
}

function usageText(usage: Record<string, unknown> | null): string {
  if (usage === null) return "no usage";
  const n = (v: unknown) => (typeof v === "number" ? fmtInt(v) : "?");
  const out = isRecord(usage.outputTokenDetails)
    ? usage.outputTokenDetails.reasoningTokens
    : undefined;
  const cached = isRecord(usage.inputTokenDetails)
    ? usage.inputTokenDetails.cacheReadTokens
    : undefined;
  return `in ${n(usage.inputTokens)} (cached ${n(cached)}) · out ${n(usage.outputTokens)} (reasoning ${n(out)})`;
}

const isLong = (v: unknown) => typeof v === "string" && (v.length > 80 || v.includes("\n"));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
