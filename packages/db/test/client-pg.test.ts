import { describe, it, expect } from "vitest";
import { pgClient, toNumberedPlaceholders } from "../src/client.js";

describe("pgClient offline capabilities", () => {
  it("creates instance with dummy URL and dialect is pg", async () => {
    const db = pgClient("postgres://dummy:dummy@localhost:5432/dummy");
    try {
      expect(db.dialect).toBe("pg");
      expect(typeof db.exec).toBe("function");
      expect(typeof db.query).toBe("function");
      expect(typeof db.run).toBe("function");
      expect(typeof db.batch).toBe("function");
    } finally {
      await db.close().catch(() => {});
    }
  });

  it("serializes objects, arrays, numbers, and strings with jsonParam", async () => {
    const db = pgClient("postgres://dummy:dummy@localhost:5432/dummy");
    try {
      expect(db.jsonParam({ hello: "world" })).toBe('{"hello":"world"}');
      expect(db.jsonParam([1, 2, 3])).toBe("[1,2,3]");
      expect(db.jsonParam(123)).toBe("123");
      expect(db.jsonParam("hello")).toBe('"hello"');
      expect(db.jsonParam(true)).toBe("true");
      expect(db.jsonParam(null)).toBe("null");
    } finally {
      await db.close().catch(() => {});
    }
  });

  it("passes through pre-parsed jsonb objects, arrays, scalars, and null with jsonValue", async () => {
    const db = pgClient("postgres://dummy:dummy@localhost:5432/dummy");
    try {
      const obj = { foo: "bar", nested: { a: 1 } };
      expect(db.jsonValue(obj)).toBe(obj);

      const arr = ["item1", "item2"];
      expect(db.jsonValue(arr)).toBe(arr);

      expect(db.jsonValue("scalar_string")).toBe("scalar_string");
      expect(db.jsonValue(42)).toBe(42);
      expect(db.jsonValue(false)).toBe(false);
      expect(db.jsonValue(null)).toBeNull();
    } finally {
      await db.close().catch(() => {});
    }
  });

  it("rewrites ? placeholders to $1, $2, etc.", () => {
    expect(toNumberedPlaceholders("SELECT * FROM workspace WHERE id = ?")).toBe(
      "SELECT * FROM workspace WHERE id = $1",
    );
    expect(
      toNumberedPlaceholders("INSERT INTO candidate (id, workspace_id, email) VALUES (?, ?, ?)"),
    ).toBe(
      "INSERT INTO candidate (id, workspace_id, email) VALUES ($1, $2, $3)",
    );
    expect(toNumberedPlaceholders("SELECT 1")).toBe("SELECT 1");
  });
});
