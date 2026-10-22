// `D8` (Phase 7c Task 5, `T5-R1`): the watermark sits over the paper and
// does not reflow it. This file is the half of that ruling jsdom cannot
// answer — `test/exam/watermark.test.tsx`'s own header explains why at
// length: the brief's own draft asserted this with
// `getBoundingClientRect()` inside jsdom, which reports every box as all
// zeros, so `expect(after.top).toBe(before.top)` was `0 === 0` whatever the
// watermark actually did to the layout underneath it.
//
// TWO ATTEMPTS, NOT ONE TOGGLED. `watermark` is baked into an attempt's
// resolved proctoring at `/start` — there is no control that flips it at
// runtime on an open attempt — so "before" and "after" here are two
// separately seeded tests with the SAME single question, one with the
// control on and one off, each opened fresh at the same viewport. The
// option's position is compared ACROSS the two pages rather than across one
// page's two states, which is also why a bare "0px spread" would prove
// nothing on its own (`field-rows.spec.ts`'s own warning) — the option's
// box is asserted non-zero first, so an equal pair of zero-area boxes
// cannot pass this silently.
//
// `seedProctoringTest` in `e2e/proctoring.spec.ts` is Task 4's own version
// of this seed, built for exactly one override; this file needs two
// attempts with two different `watermark` values, so it keeps a small local
// copy rather than reach into a helper this task does not own.
//
// Placed in `measurement/` for the reason every file here gives
// (`field-rows.spec.ts`'s header, at length): Playwright runs files in
// sorted-path order under `workers: 1`, and anything sorting before
// `e2e/first-run.spec.ts` would seed a workspace before the test that walks
// the first-run wizard — which needs an instance that has never been set
// up. `measurement/` sorts after it. AND it seeds two workspaces of its
// own, never `workspaces[0]` — the same isolation `D13`'s density ratchet
// needs from every file in this directory.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createWorkspace } from "../seed";

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

async function patchedDraft(request: APIRequestContext, url: string, body: unknown): Promise<void> {
  const res = await request.patch(url, { data: body });
  expect(res.ok(), `PATCH ${url} → ${res.status()} ${await res.text()}`).toBe(true);
}

/** One workspace, one bank, one question, one published test — `desktop_
 *  only: false` so Task 3's device gate never competes for the floor, and
 *  `watermark` set to whatever this call is measuring. */
async function seedWatermarkTest(
  request: APIRequestContext,
  name: string,
  watermark: boolean,
): Promise<SeededAttempt> {
  const slug = `watermark-e2e-${name}`;
  const workspaceId = await createWorkspace(request, `Watermark e2e ${name}`, slug);

  const bankId = await created(request, `/api/v1/workspaces/${workspaceId}/banks`, {
    name: "Watermark e2e bank",
  });
  await ok(request, `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`, {
    format: "pariksha/bank@1",
    name: "Watermark e2e bank",
    questions: [
      { id: "Q01", type: "true_false", prompt: "This statement is true.", key: true, points: 1 },
    ],
  });
  const questions = await request.get(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`);
  expect(questions.ok()).toBe(true);
  const questionId = ((await questions.json()).questions as { id: string }[])[0]?.id;
  expect(typeof questionId, "the imported bank answered no question id").toBe("string");

  const testSlug = `${slug}-${Date.now().toString(36)}`;
  const accessCode = `e2e-${slug}`;
  const testId = await created(request, `/api/v1/workspaces/${workspaceId}/tests`, {
    name: `Watermark e2e ${name}`,
    slug: testSlug,
  });
  await patchedDraft(request, `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`, {
    settings: {
      timing: { duration_minutes: 30 },
      access: { mode: "link_code", access_code: accessCode },
      proctoring: { profile: "off", overrides: { desktop_only: false, watermark } },
    },
    sections: [{ id: "s1", title: "Section", source: { kind: "fixed", questions: [questionId] } }],
  });
  await ok(request, `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`, {});

  return { workspaceSlug: slug, testSlug, accessCode };
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

const VIEWPORT = { width: 1280, height: 800 };

test("the watermark paints over the paper without moving the option it covers (D8)", async ({
  page,
  browser,
  request,
}) => {
  const [withoutSeed, withSeed] = await Promise.all([
    seedWatermarkTest(request, "off", false),
    seedWatermarkTest(request, "on", true),
  ]);

  await page.setViewportSize(VIEWPORT);
  await openAttempt(page, withoutSeed);
  // The watermark really is absent here — the control the "without" case
  // needs, or an equal pair of boxes below would prove nothing about the
  // watermark specifically (it could just as well be two identical pages).
  await expect(page.locator("[data-watermark]")).toHaveCount(0);
  const option = page.getByRole("radio").first();
  const without = await option.boundingBox();
  expect(without, "the option has no layout box without the watermark").not.toBeNull();
  // Non-zero, so the comparison below cannot pass on two boxes that both
  // collapsed to nothing (`field-rows.spec.ts`'s own "zero proves nothing"
  // warning, the same trap one level up).
  expect(without!.width).toBeGreaterThan(0);
  expect(without!.height).toBeGreaterThan(0);

  // A FRESH context, not a second page in the same one: the candidate
  // session is a cookie, and the "without" attempt above already holds one
  // — a second page sharing that context would carry it straight into a
  // resume of the FIRST attempt instead of the second test's own landing
  // page, which is exactly what happened the first time this ran (a 30s
  // timeout waiting for a "Start" button a resumed runner never shows).
  const secondContext = await browser.newContext();
  const page2 = await secondContext.newPage();
  await page2.setViewportSize(VIEWPORT);
  await openAttempt(page2, withSeed);
  // The watermark really is here, painting something — `D8` is "does not
  // reflow", not "is invisible"; a watermark control with no box would make
  // the equality below a comparison against nothing.
  const mark = page2.locator("[data-watermark]");
  await expect(mark).toHaveCount(1);
  const markBox = await mark.boundingBox();
  expect(markBox, "the watermark has no layout box").not.toBeNull();
  expect(markBox!.width).toBeGreaterThan(0);
  expect(markBox!.height).toBeGreaterThan(0);

  const option2 = page2.getByRole("radio").first();
  const withMark = await option2.boundingBox();
  expect(withMark, "the option has no layout box with the watermark").not.toBeNull();

  console.log(
    `WATERMARK ${VIEWPORT.width}x${VIEWPORT.height}: option without=${JSON.stringify(without)} ` +
      `with=${JSON.stringify(withMark)} mark=${JSON.stringify(markBox)}`,
  );

  // The ruling itself: the same question, the same markup, the same
  // viewport — the option sits in exactly the same place whether or not
  // the watermark is mounted over it.
  expect(withMark).toEqual(without);

  await secondContext.close();
});
