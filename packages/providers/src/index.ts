import { dependencyVersions } from "@bfe/core";

export { CodexAuth, CODEX_AUTH_PATH, expiresSoon } from "./codex-oauth/auth.ts";
export type { CodexTokens } from "./codex-oauth/auth.ts";
export {
  CODEX_BASE_URL,
  CODEX_OAUTH_PREFIX,
  codexOAuthModel,
  codexProviderOptions,
  parseCodexModelId,
} from "./codex-oauth/model.ts";
export type { CodexEffort, CodexModelId } from "./codex-oauth/model.ts";
export { loggingFetch } from "./http-log.ts";
export {
  COMMAND_CODE_BASE_URL,
  commandCodeApiKey,
  commandCodeModel,
  evalModel,
} from "./provider.ts";

/** Installed versions of this package's npm dependencies, for the run manifest. */
export const providerPackageVersions = () =>
  dependencyVersions(new URL("../package.json", import.meta.url));
