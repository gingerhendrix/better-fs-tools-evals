import { expect, test } from "bun:test";

import { datasetSha256, loadDelegate52 } from "../src/dataset.ts";
import { forwardOrder } from "../src/order.ts";

const FIXTURE = new URL("./fixtures/two-samples.jsonl", import.meta.url).pathname;

test("loads seed files, distractor files, and states from the jsonl", async () => {
  const samples = await loadDelegate52(FIXTURE);
  expect(samples.map((s) => s.id)).toEqual(["docker1", "json1"]);
  const docker = samples[0]!;
  expect(docker.domain).toBe("docker");
  expect(docker.license).toBe("MIT");
  expect(docker.startState).toBe("basic_state");
  expect(Object.keys(docker.seedFiles)).toEqual(["Dockerfile"]);
  expect(docker.seedFiles.Dockerfile).toStartWith("FROM debian:12\n");
  expect(Object.keys(docker.distractorFiles).sort()).toEqual(["compose.yml", "notes.txt"]);
  expect(docker.states.find((s) => s.id === "split")?.targetFiles).toEqual(["Dockerfile.*"]);
  expect(docker.states[0]!.prompts.map((p) => p.targetState)).toEqual([
    "alpine",
    "split",
    "commented",
  ]);
});

test("filters by domain and by sample id, in the given order", async () => {
  expect((await loadDelegate52(FIXTURE, { domains: ["json"] })).map((s) => s.id)).toEqual([
    "json1",
  ]);
  expect(
    (await loadDelegate52(FIXTURE, { samples: ["json1", "docker1"] })).map((s) => s.id),
  ).toEqual(["json1", "docker1"]);
  expect(loadDelegate52(FIXTURE, { samples: ["docker9"] })).rejects.toThrow("docker9");
  expect(loadDelegate52(FIXTURE, { domains: ["docker"], samples: ["json1"] })).rejects.toThrow(
    "json1",
  );
});

test("datasetSha256 hashes the file bytes", async () => {
  expect(await datasetSha256(FIXTURE)).toMatch(/^[0-9a-f]{64}$/);
});

test("forward order is seeded, covers every target once per cycle, and changes with the seed", async () => {
  const [docker] = await loadDelegate52(FIXTURE, { samples: ["docker1"] });
  const order = forwardOrder(docker!, 5, 52);
  expect(order).toEqual(forwardOrder(docker!, 5, 52));
  expect(order).toHaveLength(5);
  // Whole shuffled cycles first: the first 3 entries hold each target once.
  expect(order.slice(0, 3).sort()).toEqual(["alpine", "commented", "split"]);
  expect(new Set(order.slice(3)).size).toBe(2);
  const orders = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => forwardOrder(docker!, 3, seed).join());
  expect(new Set(orders).size).toBeGreaterThan(1);
});
