import { describe, expect, it } from "vitest";
import { ID_PREFIXES, newId, isId } from "../src/ids.js";

// Crockford base32, lowercase, without i, l, o and u — so an ID read aloud
// over a phone to a candidate who lost their link is unambiguous.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ID = new RegExp(`^tst_[${ALPHABET}]{12}$`);

describe("newId", () => {
  it("T-01: a test ID is tst_ followed by 12 characters", () => {
    expect(newId("tst")).toMatch(ID);
  });

  it("uses the same shape for every prefix the data model defines", () => {
    for (const prefix of ID_PREFIXES) {
      expect(newId(prefix)).toMatch(
        new RegExp(`^${prefix}_[${ALPHABET}]{12}$`),
      );
    }
  });

  it("produces no collision across 100000 draws", () => {
    const s = new Set(Array.from({ length: 100_000 }, () => newId("att")));
    expect(s.size).toBe(100_000);
  });

  it("draws every character of the alphabet and none outside it", () => {
    // A biased or truncated alphabet still passes the regex above; this is
    // what catches one that silently never emits its last characters.
    const seen = new Set(
      Array.from({ length: 20_000 }, () => newId("qst"))
        .flatMap((id) => [...id.slice(4)])
        .values(),
    );
    expect([...seen].sort().join("")).toBe(ALPHABET);
  });
});

describe("isId", () => {
  it("checks the prefix when one is given", () => {
    const id = newId("wsp");
    expect(isId(id, "wsp")).toBe(true);
    expect(isId(id, "tst")).toBe(false);
    expect(isId("tst_SHORT", "tst")).toBe(false);
  });

  it("accepts any known prefix when none is given, and rejects unknown ones", () => {
    expect(isId(newId("whk"))).toBe(true);
    expect(isId("xyz_abcdefghjkmn")).toBe(false);
  });

  it("rejects anything that is not exactly prefix_12", () => {
    const body = "abcdefghjkmn";
    expect(isId(`att_${body}x`, "att")).toBe(false);
    expect(isId(`att_${body.slice(1)}`, "att")).toBe(false);
    expect(isId(`att_${body.toUpperCase()}`, "att")).toBe(false);
    expect(isId(`att_abcdefghjkmi`, "att")).toBe(false); // 'i' is not in the alphabet
    expect(isId("", "att")).toBe(false);
    expect(isId(`ATT_${body}`, "att")).toBe(false);
  });
});
