import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./tokens.mjs";

const workflow = parse(
  readFileSync(join(REPO_ROOT, ".github/workflows/deploy-web.yml"), "utf8"),
);
const deploy = workflow.jobs.deploy;
const steps = deploy.steps;

const runOf = (step) => String(step.run ?? "");
const indexOfRun = (needle) => steps.findIndex((s) => runOf(s).includes(needle));

describe("deploy-web workflow", () => {
  it("does not run at all until someone opts the repository in", () => {
    // Without an opt-in gate the job runs on every push to main, and with no
    // Cloudflare secrets configured it can only fail — a red default branch
    // for every merge until someone sets them up.
    expect(deploy.if).toContain("vars.DEPLOY_WEB == 'true'");
  });

  it("never interpolates a secret into a shell script body", () => {
    // `${{ secrets.X }}` inside `run:` is substituted into the script the
    // runner writes to disk, so a value carrying a quote, a backtick or a
    // newline changes what that script does. Secrets reach a step through
    // `env:`, where the value is passed, not pasted.
    for (const step of steps) {
      expect(runOf(step)).not.toContain("secrets.");
    }
  });

  it("runs the test suite before it deploys", () => {
    // The site's only correctness guarantees — the CSP, the contrast ratios,
    // the no-hex rule, the bundle split — are tests. CI is a separate
    // workflow on the same event, so a red CI run does not hold this one back.
    const test = indexOfRun("pnpm test");
    const publish = indexOfRun("wrangler deploy");

    expect(test).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(-1);
    expect(test).toBeLessThan(publish);
  });
});
