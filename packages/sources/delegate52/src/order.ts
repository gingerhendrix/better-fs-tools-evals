import type { RelaySample } from "@bfe/core";

/**
 * The forward targets for each round trip of one relay. This follows
 * `build_forward_state_sequence` in upstream `run_relay.py`: whole shuffled
 * cycles over the start state's targets, then the head of one more shuffle.
 *
 * Upstream uses Python's global `random`, so its order is not reproducible.
 * Here the generator is seeded from `seed` and the sample id. Every arm and
 * model then gets the same edit sequence for a sample.
 */
export function forwardOrder(sample: RelaySample, roundTrips: number, seed: number): string[] {
  const start = sample.states.find((s) => s.id === sample.startState);
  if (start === undefined) throw new Error(`${sample.id}: no start state`);
  const targets = start.prompts.map((p) => p.targetState);
  if (targets.length === 0) throw new Error(`${sample.id}: the start state has no prompts`);
  const random = mulberry32(fnv1a(`${seed}:${sample.id}`));
  const order: string[] = [];
  while (order.length < roundTrips) {
    order.push(...shuffle(targets, random).slice(0, roundTrips - order.length));
  }
  return order;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** 32-bit FNV-1a of a string. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** A small seeded generator. Values are in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
