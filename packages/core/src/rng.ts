// Seeded randomness for presentation order ONLY (question order, option
// order). This is a plain PRNG, not a cryptographic primitive: outputs are
// predictable to anyone who learns the seed, and the seed itself is often a
// non-secret value such as an attempt ID. NEVER use this (or its seed) for
// attempt tokens, access codes, passwords, or anything an adversary benefits
// from predicting — use `crypto.getRandomValues` for those instead.
import type { QuestionOption } from "./types.js";

/** Hashes a string to a 32-bit unsigned integer (FNV-1a). */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Builds a deterministic generator of numbers in [0, 1) from a seed string.
 * Same seed in, same sequence out, every time — via mulberry32 driven by a
 * 32-bit hash of the seed.
 */
export function makeRng(seed: string): () => number {
  let state = hashSeed(seed);
  return function mulberry32(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle, driven by `rng`. Does not mutate `items`. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue; // i, j are always in range; this satisfies noUncheckedIndexedAccess
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/**
 * Shuffles `options`, except any option with `pinned: true`, which keeps its
 * authored index ("All of the above" stays last, however the rest move).
 */
export function shuffleOptions(
  options: readonly QuestionOption[],
  rng: () => number,
): QuestionOption[] {
  const movableIndexes: number[] = [];
  const movable: QuestionOption[] = [];
  options.forEach((option, index) => {
    if (!option.pinned) {
      movableIndexes.push(index);
      movable.push(option);
    }
  });

  const shuffledMovable = shuffle(movable, rng);

  const result = options.slice();
  movableIndexes.forEach((originalIndex, position) => {
    const option = shuffledMovable[position];
    if (option === undefined) return; // movableIndexes and shuffledMovable always have equal length
    result[originalIndex] = option;
  });
  return result;
}
