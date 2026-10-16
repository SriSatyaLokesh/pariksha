import { describe, it, expect } from "vitest";
import { CORE_VERSION } from "../src/index.js";

describe("core package", () => {
  it("exports a version string", () => {
    expect(CORE_VERSION).toBe("1");
  });
});
