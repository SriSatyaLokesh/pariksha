import { describe, it, expect, vi, afterEach } from "vitest";
import { readGround, writeGround } from "../src/lib/ground";

/**
 * D20's switch, per viewer (spec §11). `theme.css` keys the light palette
 * off `:root[data-theme="light"]`, so the whole mechanism is: read a
 * preference, put it on `<html>`.
 *
 * `matchMedia` is stubbed in every test that reaches the seed because jsdom
 * does not implement it. The stub is here and not a guard in `ground.ts`:
 * a real browser always has `matchMedia`, so a production branch for its
 * absence would be a line no test could honestly exercise (`AG3`).
 */
function prefersLight(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query.includes("prefers-color-scheme: light"),
  }));
}

/** A private window, cleared site data, or storage blocked by policy: the
 *  access itself throws, not just the write. */
function stubStorageToThrow(): void {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("The operation is insecure.");
    },
    setItem() {
      throw new Error("The operation is insecure.");
    },
  });
}

describe("readGround", () => {
  afterEach(() => {
    // Unstub first: the throwing stub above has no `clear`.
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("returns the stored choice when there is one", () => {
    // The key spelt out rather than imported: it is a contract with every
    // returning viewer's browser, so a rename has to fail a test.
    localStorage.setItem("pariksha.ground", "light");
    // The OS says dark. An explicit choice still wins.
    prefersLight(false);

    expect(readGround()).toBe("light");
  });

  it("seeds from prefers-color-scheme when there is no stored choice", () => {
    prefersLight(true);

    expect(readGround()).toBe("light");
  });

  it("returns dark and does not throw when localStorage throws", () => {
    stubStorageToThrow();

    expect(readGround()).toBe("dark");
  });
});

describe("writeGround", () => {
  afterEach(() => {
    // Unstub first: the throwing stub above has no `clear`.
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("applies the ground to <html>, where theme.css reads it", () => {
    writeGround("light");

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("remembers the choice for the next visit", () => {
    writeGround("light");

    expect(readGround()).toBe("light");
  });

  it("does not throw when localStorage throws", () => {
    stubStorageToThrow();

    expect(() => writeGround("light")).not.toThrow();
  });
});
