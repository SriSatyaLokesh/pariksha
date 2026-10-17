import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageAdapter } from "../src/adapter.js";
import { memoryAdapter } from "../src/memory.js";
import { diskAdapter } from "../src/disk.js";

// One contract, every implementation. An adapter that passes here is one the
// API can be pointed at without reading its source — which is the whole
// reason the seam exists (ADR 0002): an organiser who outgrows R2 moves to
// MinIO or a disk without a rewrite.

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (body: ArrayBuffer | null) =>
  body === null ? null : new TextDecoder().decode(body);

const tempRoot = mkdtempSync(join(tmpdir(), "pariksha-storage-"));

const adapters: [string, () => StorageAdapter][] = [
  ["memory", () => memoryAdapter()],
  [
    "disk",
    () =>
      diskAdapter({
        root: mkdtempSync(join(tempRoot, "disk-")),
        baseUrl: "https://example.test/files",
        secret: "test-secret",
      }),
  ],
];

afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

describe.each(adapters)("%s adapter", (_name, make) => {
  let adapter: StorageAdapter;

  beforeAll(() => {
    adapter = make();
  });

  it("round-trips an object", async () => {
    await adapter.put("snap/a.jpg", bytes("one"), { contentType: "image/jpeg" });
    expect(text(await adapter.get("snap/a.jpg"))).toBe("one");
  });

  it("returns null for a key that was never written", async () => {
    // Not an exception: a missing snapshot is an ordinary outcome, and a
    // proctoring read must never throw into the answering path.
    expect(await adapter.get("snap/missing.jpg")).toBeNull();
  });

  it("lists the keys under a prefix, and only those", async () => {
    await adapter.put("att/1/a.jpg", bytes("a"), { contentType: "image/jpeg" });
    await adapter.put("att/1/b.jpg", bytes("b"), { contentType: "image/jpeg" });
    await adapter.put("att/2/c.jpg", bytes("c"), { contentType: "image/jpeg" });

    const { keys } = await adapter.list("att/1/");
    expect([...keys].sort()).toEqual(["att/1/a.jpg", "att/1/b.jpg"]);
  });

  it("deletes several keys in one call", async () => {
    await adapter.put("bulk/x", bytes("x"), { contentType: "text/plain" });
    await adapter.put("bulk/y", bytes("y"), { contentType: "text/plain" });

    await adapter.delete(["bulk/x", "bulk/y"]);

    expect(await adapter.get("bulk/x")).toBeNull();
    expect(await adapter.get("bulk/y")).toBeNull();
  });

  it("deleting a key that is not there is not an error", async () => {
    await expect(adapter.delete(["bulk/never"])).resolves.toBeUndefined();
  });

  it("overwrites a key rather than appending to it", async () => {
    await adapter.put("snap/over.jpg", bytes("first"), {
      contentType: "image/jpeg",
    });
    await adapter.put("snap/over.jpg", bytes("second"), {
      contentType: "image/jpeg",
    });
    expect(text(await adapter.get("snap/over.jpg"))).toBe("second");
  });

  describe("a key is a key, not a path", () => {
    // A snapshot key is built from an attempt ID, and an attempt ID arrives
    // over the network. Traversal is refused at the adapter, so no caller has
    // to remember to sanitise it.
    const refused = ["../escape", "a/../../escape", "/absolute", "a//b", ""];

    it.each(refused)("refuses to write %j", async (key) => {
      await expect(
        adapter.put(key, bytes("nope"), { contentType: "text/plain" }),
      ).rejects.toThrow(/key/i);
    });

    it.each(refused)("refuses to read %j", async (key) => {
      await expect(adapter.get(key)).rejects.toThrow(/key/i);
    });

    it("refuses a traversal key inside a batch delete, without deleting the rest", async () => {
      await adapter.put("bulk/keep", bytes("keep"), { contentType: "text/plain" });
      await expect(adapter.delete(["bulk/keep", "../escape"])).rejects.toThrow(
        /key/i,
      );
      expect(text(await adapter.get("bulk/keep"))).toBe("keep");
    });
  });
});
