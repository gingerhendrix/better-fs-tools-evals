import { dependencyVersions } from "@bfe/core";

export { ARMS, findArm } from "./arms.ts";
export type { Arm } from "./arms.ts";
export { sandboxBash } from "./sandbox-bash.ts";

/** Installed versions of this package's npm dependencies, `@better-fs-tools/*` among them. */
export const toolPackageVersions = () =>
  dependencyVersions(new URL("../package.json", import.meta.url));
