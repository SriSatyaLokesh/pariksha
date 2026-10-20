// D13 — the AG1 density gate.
//
// Placed in a subdirectory, deliberately. Playwright collects `testDir`
// recursively and runs the files in sorted-path order, and with
// `workers: 1` and `fullyParallel: false` that order is the run order.
// `first-run.spec.ts` must go first: its first test is what completes
// instance setup, and `GET /setup/status` answers `needed: true` only
// while no workspace row exists. A spec at `e2e/density.spec.ts` sorts
// *before* `first-run.spec.ts` ('d' < 'f'), seeds a workspace, and the
// first-run wizard is then gone before the test that walks it ever runs.
// `measurement/density.spec.ts` sorts after ('f' < 'm'), which is the
// whole reason for the directory. `playwright.config.ts` is untouched
// (AG2).

import { expect, test } from "@playwright/test";
import { seedWorkspace, signIn } from "../seed";

test.use({ viewport: { width: 1440, height: 900 } });

test("seeds a workspace reachable in the organiser", async ({ page, request }) => {
  const seed = await seedWorkspace(request, { banks: 3, questionsPerBank: 4, tests: 5 });
  expect(seed.bankIds).toHaveLength(3);
  expect(seed.testIds).toHaveLength(5);

  await signIn(page);
  await page.getByRole("button", { name: "Create your first test" }).click();
  await expect(page.locator("table.testbuilder-list tbody tr")).toHaveCount(5);
});
