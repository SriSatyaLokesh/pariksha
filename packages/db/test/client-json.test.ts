import { describe, it, expect } from "vitest";
import { sqliteClient, pgClient } from "../src/client.js";

describe("DbClient jsonParam and jsonValue", () => {
  it("sqliteClient decodes JSON strings and text objects correctly", () => {
    const db = sqliteClient(":memory:");
    try {
      expect(db.jsonValue(JSON.stringify("a_false_r_true"))).toBe("a_false_r_true");
      expect(db.jsonValue(JSON.stringify({ key: "val" }))).toEqual({ key: "val" });
      expect(db.jsonValue(JSON.stringify(["tag1", "tag2"]))).toEqual(["tag1", "tag2"]);
      expect(db.jsonValue("non-json-plain-text")).toBe("non-json-plain-text");
      expect(db.jsonValue(null)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("pgClient decodes already-parsed jsonb values without throwing", () => {
    // pgClient constructor only creates a postgres() instance; does not connect until query
    const db = pgClient("postgres://dummy:dummy@localhost:5432/dummy");
    try {
      // postgres.js returns raw strings for jsonb scalar strings (e.g. choice_single question key)
      expect(db.jsonValue("a_false_r_true")).toBe("a_false_r_true");
      expect(db.jsonValue({ key: "val" })).toEqual({ key: "val" });
      expect(db.jsonValue(["tag1", "tag2"])).toEqual(["tag1", "tag2"]);
      expect(db.jsonValue(42)).toBe(42);
      expect(db.jsonValue(true)).toBe(true);
      expect(db.jsonValue(null)).toBeNull();
    } finally {
      // Avoid dangling client
      db.close().catch(() => {});
    }
  });
});
