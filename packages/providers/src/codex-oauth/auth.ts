import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Codex OAuth tokens, ported from Auto-Agent `packages/provider-registry/src/codex-oauth/auth.ts`.
 * The tokens come from the Codex CLI login file. The harness shares that
 * file with the Codex CLI and Auto-Agent, so a refresh writes the new
 * tokens back for them.
 */
export const CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json");
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/** Refresh when the access token expires in less than this many seconds. */
const REFRESH_MARGIN_SECS = 120;

export interface CodexTokens {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly account_id: string;
  readonly id_token?: string;
}

interface CodexAuthFile {
  tokens: CodexTokens;
  last_refresh?: string;
  [key: string]: unknown;
}

/** True when the JWT has no readable `exp`, or `exp` is less than the margin away. */
export function expiresSoon(accessToken: string, nowSecs = Date.now() / 1000): boolean {
  const payload = accessToken.split(".")[1];
  if (payload === undefined) return true;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return exp === undefined || exp - nowSecs < REFRESH_MARGIN_SECS;
  } catch {
    return true;
  }
}

/**
 * Gives valid tokens and refreshes them when they are about to expire.
 * Callers that ask at the same time share one refresh.
 */
export class CodexAuth {
  private tokens: CodexTokens | null = null;
  private pending: Promise<CodexTokens> | null = null;

  constructor(private readonly path: string = CODEX_AUTH_PATH) {}

  async getTokens(): Promise<CodexTokens> {
    if (this.tokens !== null && !expiresSoon(this.tokens.access_token)) return this.tokens;
    this.pending ??= this.loadOrRefresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Reads the file first, because another tool may have refreshed the tokens. */
  private async loadOrRefresh(): Promise<CodexTokens> {
    const file = await this.readFile();
    if (!expiresSoon(file.tokens.access_token)) {
      this.tokens = file.tokens;
      return file.tokens;
    }
    const refreshed = await refresh(file.tokens.refresh_token);
    file.tokens = {
      ...file.tokens,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    };
    file.last_refresh = new Date().toISOString();
    await writeFile(this.path, JSON.stringify(file, null, 2), "utf8");
    this.tokens = file.tokens;
    return file.tokens;
  }

  private async readFile(): Promise<CodexAuthFile> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as CodexAuthFile;
    } catch (error) {
      throw new Error(`cannot read ${this.path}. Log in with the Codex CLI first: codex login`, {
        cause: error,
      });
    }
  }
}

async function refresh(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!response.ok) {
    throw new Error(`Codex token refresh failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as { access_token: string; refresh_token: string };
}
