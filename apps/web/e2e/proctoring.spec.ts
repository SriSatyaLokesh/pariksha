// Phase 7c Task 4 (`AC-18`): fullscreen and window-leave, through a real
// browser.
//
// `T4-R7`: Playwright is the one place the Fullscreen API is real — jsdom
// ships none of it at all (`test/exam/fullscreen.test.tsx`'s own header
// explains, at length, how `installFullscreenApi` stands in for it there).
// What belongs here is exactly what that file cannot prove:
//
//   - a REAL `requestFullscreen()` call, from a REAL click (Chromium
//     refuses it without a genuine user gesture — `page.evaluate()` does
//     not count, `page.click()` does), and the REAL `fullscreenchange`
//     event it dispatches, not a synthetic one `fireEvent` constructs;
//   - leaving fullscreen through the BROWSER's own escape hatch (Escape,
//     pressed through CDP input, exits real Chromium fullscreen) rather
//     than through the dialog — there is none to escape (`Q2b`), and this
//     is the proof that the candidate's *only* way out is the one this
//     suite drives;
//   - `Q7a`: the warning's count and a follow-up `GET /api/v1/run/attempt`
//     agree — the server really counted, independent of whatever the page
//     chose to render.
//
// What is NOT here: the focus trap, the no-Escape-on-the-dialog rule, the
// `aria-hidden`/`inert` covering, and the "stays mounted" assertions —
// `fullscreen.test.tsx` already proves all four and a browser adds nothing
// to any of them. Nor is this a second seed helper: `seedProctoringTest`
// below is the one thing `e2e/seed.ts` cannot build (it never sets
// `proctoring` or a custom `access`), kept to exactly that gap.
//
// One honest limitation, stated rather than quietly skipped: `AC-18`'s own
// wording asks for "one event row with a duration". Phase 7c exposes no
// route that reads a candidate's individual event rows back — that surface
// is Phase 8's review page (handoff §3, "where `observed: false` appears").
// What IS exposed and IS asserted below is the derived fact the row exists
// to produce: the server's own violation count, read back over a second,
// independent request.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createWorkspace } from "./seed.ts";

interface SeededAttempt {
  workspaceSlug: string;
  testSlug: string;
  accessCode: string;
}

async function created(request: APIRequestContext, url: string, body: unknown): Promise<string> {
  const res = await request.post(url, { data: body });
  expect(res.ok(), `POST ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  const id = (await res.json()).id;
  expect(typeof id, `${url} answered no id`).toBe("string");
  return id as string;
}

async function ok(request: APIRequestContext, url: string, body: unknown): Promise<void> {
  const res = await request.post(url, { data: body });
  expect(res.ok(), `POST ${url} → ${res.status()} ${await res.text()}`).toBe(true);
}

async function patched(request: APIRequestContext, url: string, body: unknown): Promise<void> {
  const res = await request.patch(url, { data: body });
  expect(res.ok(), `PATCH ${url} → ${res.status()} ${await res.text()}`).toBe(true);
}

/**
 * One workspace, one bank, one question, one published test — `require_
 * fullscreen` on and everything else proctoring-related off, so this
 * exercises Task 4 alone. `access.mode: "link_code"` is the only mode a
 * bare API-created test can satisfy with no email provider and no invite
 * payload (`apps/api/src/routes/run.ts`'s own `switch`): a fixed code,
 * entered once, same as a real candidate's invitation email would carry.
 * `registration_form` and `consent` are both omitted, so the registration
 * screen's second stage has no field on it at all — one button.
 */
async function seedProctoringTest(request: APIRequestContext): Promise<SeededAttempt> {
  const workspaceId = await createWorkspace(request, "Proctoring e2e", "proctoring-e2e");

  const bankId = await created(request, `/api/v1/workspaces/${workspaceId}/banks`, {
    name: "Proctoring e2e bank",
  });
  await ok(request, `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`, {
    format: "pariksha/bank@1",
    name: "Proctoring e2e bank",
    questions: [
      { id: "Q01", type: "true_false", prompt: "This statement is true.", key: true, points: 1 },
    ],
  });
  const questions = await request.get(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`);
  expect(questions.ok()).toBe(true);
  const questionId = ((await questions.json()).questions as { id: string }[])[0]?.id;
  expect(typeof questionId, "the imported bank answered no question id").toBe("string");

  const testSlug = `fullscreen-e2e-${Date.now().toString(36)}`;
  const accessCode = "e2e-fullscreen-1";
  const testId = await created(request, `/api/v1/workspaces/${workspaceId}/tests`, {
    name: "Fullscreen e2e",
    slug: testSlug,
  });
  await patched(request, `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`, {
    settings: {
      timing: { duration_minutes: 30 },
      access: { mode: "link_code", access_code: accessCode },
      // `off` carries every other control false (`PROCTORING_DEFAULTS.off`
      // in `packages/core`) — the one override turns on exactly what this
      // task adds, and `desktop_only: false` means Task 3's device gate
      // never competes for the floor with this suite's own assertions.
      proctoring: { profile: "off", overrides: { require_fullscreen: true } },
    },
    sections: [{ id: "s1", title: "Section", source: { kind: "fixed", questions: [questionId] } }],
  });
  await ok(request, `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`, {});

  return { workspaceSlug: "proctoring-e2e", testSlug, accessCode };
}

/** Landing → access code → (no registration fields) → the runner. */
async function openAttempt(page: Page, seeded: SeededAttempt): Promise<void> {
  await page.goto(`/${seeded.workspaceSlug}/${seeded.testSlug}`);
  await page.getByRole("button", { name: /^start/i }).click();
  await page.getByLabel("Access code").fill(seeded.accessCode);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /register and start/i }).click();
  await expect(page.getByRole("navigation", { name: /question palette/i })).toBeVisible();
}

test("AC-18: fullscreen exit and a window-leave both reach the overlay, and the server counts both", async ({
  page,
  request,
}) => {
  page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
  page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));
  const seeded = await seedProctoringTest(request);
  await openAttempt(page, seeded);
  await page.waitForTimeout(500);
  console.log("DEBUG fullscreenEnabled:", await page.evaluate(() => document.fullscreenEnabled));
  console.log("DEBUG requestFullscreen type:", await page.evaluate(() => typeof document.documentElement.requestFullscreen));
  console.log("DEBUG overlay html present:", await page.locator(".exam-proctoring-overlay").count());
  console.log("DEBUG runner inert:", await page.evaluate(() => document.querySelector(".exam-runner")?.getAttribute("inert")));
  console.log("DEBUG fullscreenElement:", await page.evaluate(() => document.fullscreenElement));
  console.log("DEBUG body html:", (await page.content()).includes("exam-proctoring-overlay"));
  console.log("DEBUG has runner:", await page.locator(".exam-runner").count());
  console.log("DEBUG has count badge:", await page.locator(".exam-proctoring-count").count());

  // P-03: the test starts only from a click that enters fullscreen —
  // the runner has just mounted, never fullscreen yet, so the overlay is
  // already up with nothing simulated.
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: /fullscreen required/i })).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(false);

  // The click IS the user gesture Chromium requires for requestFullscreen()
  // to resolve at all — page.evaluate() calling it directly would not count.
  await page.getByRole("button", { name: /enter fullscreen/i }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true);

  // Leaving through the BROWSER's own control, not the dialog — there is
  // none to Escape (`Q2b`), and this is what proves it: Escape here exits
  // real Chromium fullscreen, which is exactly the signal `fullscreenchange`
  // reports back to `ProctoringLayer`.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(false);

  // Q7a: the server counts, checked over a second, independent request —
  // same session cookie the page itself holds, never the page's own text.
  const afterExit = await page.request.get("/api/v1/run/attempt");
  expect(afterExit.ok()).toBe(true);
  const violationsAfterExit = (await afterExit.json()).violations as number;
  expect(violationsAfterExit).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: /enter fullscreen/i }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // P-04: a real elapsed window-leave, with a real duration — jsdom cannot
  // produce a real wall-clock gap between a blur and the focus it pairs
  // with, which is the one thing `awayMs` is actually for.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });

  await expect(page.getByText(/Leaving the test window is not allowed\./)).toBeVisible();

  const afterLeave = await page.request.get("/api/v1/run/attempt");
  expect(afterLeave.ok()).toBe(true);
  const violationsAfterLeave = (await afterLeave.json()).violations as number;
  // Strictly more than the fullscreen exit alone counted — one more
  // violation for the window-leave, not zero and not two (`T4-R4`'s "a
  // count that cannot double").
  expect(violationsAfterLeave).toBe(violationsAfterExit + 1);
  await expect(
    page.getByText(new RegExp(`Warning ${String(violationsAfterLeave)} of 5\\.`)),
  ).toBeVisible();

  // Acknowledging it is the only way out — there is no Escape here either.
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // The paper is still answerable underneath everything above — `Q2a`'s
  // whole point, now proven in a real browser instead of jsdom.
  const option = page.getByRole("radio").first();
  await option.check();
  await expect(option).toBeChecked();
});
