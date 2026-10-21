import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { runBridge } from "../src/bridge.ts";
import { loadDelegate52 } from "../src/dataset.ts";

const FIXTURE = new URL("./fixtures/two-samples.jsonl", import.meta.url).pathname;

// Needs uv and an upstream checkout: BFE_D52_REPO=<microsoft/DELEGATE52 checkout>.
// BFE_D52_UV_ENV sets the uv environment folder.
const repo = process.env.BFE_D52_REPO;
const ready =
  Bun.which("uv") !== null &&
  repo !== undefined &&
  existsSync(join(repo, "domains", "domain_docker.py"));
const options = {
  repo: repo ?? "",
  ...(process.env.BFE_D52_UV_ENV ? { uvEnv: process.env.BFE_D52_UV_ENV } : {}),
};

test.skipIf(!ready)(
  "the docker scorer gives the seed 1 and a damaged copy less, and its prints are captured",
  async () => {
    const [docker] = await loadDelegate52(FIXTURE, { samples: ["docker1"] });
    const self = await runBridge(options, docker!, docker!.seedFiles);
    expect(self.score).toBeCloseTo(1, 6);
    expect(self.error).toBeNull();
    expect(self.scorerOutput).toContain("score");
    const damaged = await runBridge(options, docker!, { Dockerfile: "FROM debian:12\n" });
    expect(damaged.score!).toBeLessThan(1);
  },
  120_000,
);

test.skipIf(!ready)(
  "the json scorer compares parsed trees and gives invalid JSON 0",
  async () => {
    const [json] = await loadDelegate52(FIXTURE, { samples: ["json1"] });
    const reordered = await runBridge(options, json!, {
      "config.json": '{"port": 8080, "name": "demo"}',
    });
    expect(reordered.score).toBe(1);
    const broken = await runBridge(options, json!, { "config.json": '{"name": "demo", "port": }' });
    expect(broken.score).toBe(0);
    expect(broken.error).toBe("gen_parse_error");
  },
  120_000,
);

test("the bridge refuses a domain outside docker and json", async () => {
  const [json] = await loadDelegate52(FIXTURE, { samples: ["json1"] });
  expect(runBridge(options, { ...json!, domain: "python" }, {})).rejects.toThrow("python");
});
