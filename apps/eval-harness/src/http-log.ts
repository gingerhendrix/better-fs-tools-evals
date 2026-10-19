import { appendFile } from "node:fs/promises";

/**
 * A fetch that writes every request and response body to a JSONL file, so a
 * run can be audited later. Headers are not logged.
 */
export function loggingFetch(file: string): typeof fetch {
  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const started = Date.now();
    const response = await fetch(input, init);
    const body = await response.clone().text();
    await appendFile(
      file,
      `${JSON.stringify({
        at: new Date(started).toISOString(),
        ms: Date.now() - started,
        url: String(input instanceof Request ? input.url : input),
        status: response.status,
        request: typeof init?.body === "string" ? safeJson(init.body) : null,
        response: safeJson(body),
      })}\n`,
    );
    return response;
  };
  return wrapped as typeof fetch;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
