import { describe, it, expect } from "vitest";
import { makeRng, shuffle, shuffleOptions } from "../src/rng.js";
import type { QuestionOption } from "../src/types.js";

const TEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

describe("makeRng / shuffle", () => {
  it("the same seed gives the same order, a different seed usually gives another", () => {
    expect(shuffle(TEN, makeRng("att_1"))).toEqual(shuffle(TEN, makeRng("att_1")));
    expect(shuffle(TEN, makeRng("att_1"))).not.toEqual(shuffle(TEN, makeRng("att_2")));
  });

  it("shuffle is a permutation: same length, same members, no duplicates, no drops", () => {
    const result = shuffle(TEN, makeRng("perm-check"));
    expect(result).toHaveLength(TEN.length);
    expect(new Set(result)).toEqual(new Set(TEN));
    expect([...result].sort((a, b) => a - b)).toEqual(TEN);
  });

  it("an empty list and a single-item list are returned unchanged", () => {
    expect(shuffle([], makeRng("empty"))).toEqual([]);
    expect(shuffle(["only"], makeRng("single"))).toEqual(["only"]);
  });

  it("makeRng returns values in [0, 1)", () => {
    const rng = makeRng("range-check");
    for (let i = 0; i < 50; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("shuffleOptions", () => {
  const a: QuestionOption = { id: "a", text: "A" };
  const b: QuestionOption = { id: "b", text: "B" };
  const c: QuestionOption = { id: "c", text: "C" };
  const d: QuestionOption = { id: "d", text: "D", pinned: true };

  it("pinned options keep their index while the rest move", () => {
    const opts = [a, b, c, d]; // "All of the above" last, pinned
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const result = shuffleOptions(opts, makeRng(seed));
      expect(result[3]?.id).toBe("d");
      expect(new Set(result.map((o) => o.id))).toEqual(new Set(["a", "b", "c", "d"]));
    }
  });

  it("a pin at the first index holds while the rest shuffle around it", () => {
    const pinnedFirst: QuestionOption = { id: "p", text: "P", pinned: true };
    const opts = [pinnedFirst, a, b, c];
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const result = shuffleOptions(opts, makeRng(seed));
      expect(result[0]?.id).toBe("p");
      expect(new Set(result.map((o) => o.id))).toEqual(new Set(["p", "a", "b", "c"]));
    }
  });

  it("a pin in the middle holds while the rest shuffle around it", () => {
    const pinnedMiddle: QuestionOption = { id: "m", text: "M", pinned: true };
    const opts = [a, pinnedMiddle, b, c];
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const result = shuffleOptions(opts, makeRng(seed));
      expect(result[1]?.id).toBe("m");
      expect(new Set(result.map((o) => o.id))).toEqual(new Set(["a", "m", "b", "c"]));
    }
  });

  it("with no pinned options, shuffleOptions is a full permutation", () => {
    const opts = [a, b, c];
    const result = shuffleOptions(opts, makeRng("no-pins"));
    expect(new Set(result.map((o) => o.id))).toEqual(new Set(["a", "b", "c"]));
    expect(result).toHaveLength(3);
  });

  it("an empty list and a single-item list are returned unchanged", () => {
    expect(shuffleOptions([], makeRng("empty-opts"))).toEqual([]);
    expect(shuffleOptions([a], makeRng("single-opt"))).toEqual([a]);
  });
});
