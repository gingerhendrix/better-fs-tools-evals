import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CodexAuth, expiresSoon } from "../../src/codex-oauth/auth.ts";

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.sig`;
}

describe("expiresSoon", () => {
  const now = 1_800_000_000;

  test("is false for a token with time left, and true near or past expiry", () => {
    expect(expiresSoon(jwt({ exp: now + 3600 }), now)).toBe(false);
    expect(expiresSoon(jwt({ exp: now + 60 }), now)).toBe(true);
    expect(expiresSoon(jwt({ exp: now - 1 }), now)).toBe(true);
  });

  test("is true for a token with no exp or no payload", () => {
    expect(expiresSoon(jwt({}), now)).toBe(true);
    expect(expiresSoon("not-a-jwt", now)).toBe(true);
  });
});

describe("CodexAuth", () => {
  test("reads fresh tokens from the auth file with no refresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-auth-"));
    const path = join(dir, "auth.json");
    const access = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    await writeFile(
      path,
      JSON.stringify({ tokens: { access_token: access, refresh_token: "r", account_id: "a" } }),
    );
    const tokens = await new CodexAuth(path).getTokens();
    expect(tokens.access_token).toBe(access);
    expect(tokens.account_id).toBe("a");
  });

  test("names the login command when the file is missing", async () => {
    const auth = new CodexAuth(join(tmpdir(), "no-such-dir", "auth.json"));
    await expect(auth.getTokens()).rejects.toThrow("codex login");
  });
});
