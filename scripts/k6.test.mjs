import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("k6 Load-Testing Suite Quality Gate (AC-29)", () => {
  it("load-test.js exists and exports valid 500-VU options and AC-29 thresholds", () => {
    const filePath = resolve("scripts/k6/load-test.js");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");
    // Verify target 500 VUs
    expect(content).toMatch(/target:\s*500/);

    // Verify AC-29 thresholds: error rate < 0.5% and p95 <= 300ms
    expect(content).toMatch(/http_req_failed:\s*\[['"]rate\s*<\s*0\.005['"]\]/);
    expect(content).toMatch(/http_req_duration:\s*\[['"]p\(95\)\s*<=\s*300['"]\]/);

    // Verify candidate lifecycle phases
    expect(content).toMatch(/\/run\/.*\/register/);
    expect(content).toMatch(/\/run\/.*\/start/);
    expect(content).toMatch(/\/run\/attempt\/answer/);
    expect(content).toMatch(/\/run\/attempt\/events/);
    expect(content).toMatch(/\/run\/attempt\/submit/);
  });

  it("README.md provides Docker and native execution commands", () => {
    const readmePath = resolve("scripts/k6/README.md");
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, "utf8");
    expect(content).toMatch(/k6 run/);
    expect(content).toMatch(/grafana\/k6/);
  });
});
