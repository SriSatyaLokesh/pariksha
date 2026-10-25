// The two screenshots the README needs and the audit walkthrough does not
// produce: the candidate's paper, and the analytics screen once an attempt
// has been scored.
//
// The files land in `e2e/screenshots/` (git-ignored) as 1280x800 PNGs.
// What the README actually carries is `docs/screens/*.webp` at 840px —
// 152 KB for all six against 692 KB of full-size PNG, on a page that loads
// every one of them. One command, run by hand after a re-capture:
//
//   ffmpeg -i e2e/screenshots/10-exam-runner-desktop.png -vf scale=840:-1
//     -quality 82 ../../docs/screens/exam-runner.webp
//
// Deliberately not a script: ffmpeg is not in this repository's toolchain,
// and a build step that assumes a binary nobody declared is worse than a
// documented line. Re-capture is rare.
//
// `ui-audit-walkthrough.spec.ts` already shoots every organiser screen, and
// those files are reused verbatim — this file exists only because its own
// candidate step resolves to "This test is not available" and because
// nothing in the harness scores an attempt, so `?view=analytics` would be
// shot empty.
//
// Written against the recipe `proctoring.spec.ts` proves: a `link_code`
// test is the only access mode a bare API-created test can satisfy with no
// email provider and no invite payload. `createWorkspace` rather than the
// default seed workspace, per `seed.ts`'s own note — the density gate
// measures `workspaces[0]` and must not see these rows.

import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createWorkspace, signIn } from "../seed";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "e2e/screenshots");
const DESKTOP = { width: 1280, height: 800 };
const ACCESS_CODE = "campus-screening-1";
const WORKSPACE_SLUG = "marketing-shots";

/**
 * The worked example, imported as itself. Seventeen questions covering all
 * twelve types — the same file `examples/reasoning-aptitude/` documents and
 * the README sends readers to, so a screenshot of the paper is a screenshot
 * of content anyone can read beside it.
 */
const BANK = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "../../examples/reasoning-aptitude/questions.json"),
    "utf-8",
  ),
) as { name: string; questions: { id: string }[] };

async function created(request: APIRequestContext, url: string, body: unknown): Promise<string> {
  const res = await request.post(url, { data: body });
  expect(res.ok(), `POST ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()).id as string;
}

async function shoot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-desktop.png`) });
}

interface Seeded {
  workspaceId: string;
  testId: string;
  testSlug: string;
}

async function seedPublishedTest(request: APIRequestContext): Promise<Seeded> {
  const workspaceId = await createWorkspace(request, "Campus screening", WORKSPACE_SLUG);

  const bankId = await created(request, `/api/v1/workspaces/${workspaceId}/banks`, {
    name: BANK.name,
  });
  const imported = await request.post(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`,
    { data: BANK },
  );
  expect(imported.ok(), `import → ${imported.status()} ${await imported.text()}`).toBe(true);

  const listed = await request.get(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`);
  const questionIds = ((await listed.json()).questions as { id: string }[]).map((q) => q.id);
  expect(questionIds).toHaveLength(BANK.questions.length);

  const testSlug = "campus-screening";
  const testId = await created(request, `/api/v1/workspaces/${workspaceId}/tests`, {
    name: "Campus screening — reasoning and aptitude",
    slug: testSlug,
  });
  const draft = await request.patch(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    {
      data: {
        settings: {
          timing: { duration_minutes: 45 },
          access: { mode: "link_code", access_code: ACCESS_CODE },
          proctoring: { profile: "off", overrides: { desktop_only: false } },
        },
        // Three sections, as the worked example has: the palette is one of
        // the things the screenshot is for, and one section renders it as a
        // single undifferentiated row.
        sections: [
          {
            id: "sec-1",
            title: "Logical reasoning",
            source: { kind: "fixed", questions: questionIds.slice(0, 6) },
          },
          {
            id: "sec-2",
            title: "Quantitative aptitude",
            source: { kind: "fixed", questions: questionIds.slice(6, 12) },
          },
          {
            id: "sec-3",
            title: "Written reasoning",
            source: { kind: "fixed", questions: questionIds.slice(12) },
          },
        ],
      },
    },
  );
  expect(draft.ok(), `draft → ${draft.status()} ${await draft.text()}`).toBe(true);

  const published = await request.post(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`,
    { data: {} },
  );
  expect(published.ok(), `publish → ${published.status()} ${await published.text()}`).toBe(true);

  return { workspaceId, testId, testSlug };
}

/** Landing → access code → registration → the paper, as a candidate. */
async function openPaper(page: Page, testSlug: string): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await page.goto(`/${WORKSPACE_SLUG}/${testSlug}`);
  await page.getByRole("button", { name: /^start/i }).click();
  await page.getByLabel("Access code").fill(ACCESS_CODE);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /register and start/i }).click();
  await expect(page.locator(".exam-submit")).toBeVisible();
}

/**
 * The correct option text for every single-answer question in the bank,
 * keyed by the first line of its prompt.
 *
 * Matched on **text**, never on position: both question order and option
 * order shuffle per candidate, so an index taken from the bank file points
 * at a different option on every paper. Reading the prompt back off the
 * screen is the only mapping that survives the shuffle — and it is also
 * what makes the cohort's scores real rather than a cosmetic number.
 */
const plain = (s: string) => s.replace(/[*`_]/g, "").replace(/\s+/g, " ").trim();

interface Answer {
  /** How the paper renders it. */
  kind: "radio" | "checkbox" | "number";
  /** Option text to click, or the number to type. */
  values: string[];
}

const CORRECT = new Map<string, Answer>();
for (const q of BANK.questions as Record<string, unknown>[]) {
  const head = plain(String(q.prompt).split("\n")[0] ?? "");
  const options = (q.options ?? []) as { id: string; text: string }[];
  const textOf = (ids: string[]) =>
    ids.map((id) => options.find((o) => o.id === id)?.text).filter((t): t is string => !!t);

  if (q.type === "single") {
    CORRECT.set(head, { kind: "radio", values: textOf([q.key as string]) });
  } else if (q.type === "true_false") {
    CORRECT.set(head, { kind: "radio", values: [q.key === true ? "True" : "False"] });
  } else if (q.type === "multiple" || q.type === "select_k") {
    CORRECT.set(head, { kind: "checkbox", values: textOf(q.key as string[]) });
  } else if (q.type === "numeric") {
    const key = q.key as { value: number };
    CORRECT.set(head, { kind: "number", values: [String(key.value)] });
  }
  // matching, multi_matching, ordering, fill_blank, assertion_reason, short
  // and long answer are left alone: each needs its own control vocabulary,
  // and a cohort that leaves the hard half blank is the realistic one.
}

/**
 * Walk the first `count` questions, answering every one this helper knows
 * the shape of — correctly, except every `wrongEvery`-th, which is what
 * gives the cohort a distribution instead of one score repeated eight
 * times.
 *
 * `.exam-options` scopes the option query: the view controls above the
 * paper are radios too, and an unscoped `getByRole("radio")` sets the text
 * size rather than answering anything.
 */
async function answerSome(page: Page, count: number, wrongEvery: number): Promise<void> {
  const palette = page.locator(".exam-palette-grid button");
  const total = Math.min(count, await palette.count());
  for (let i = 0; i < total; i += 1) {
    await palette.nth(i).click();

    const head = (await page.locator(".exam-question").innerText())
      .split("\n")
      .map(plain)
      .find((line) => CORRECT.has(line));
    const answer = head && CORRECT.get(head);
    if (!answer) continue;

    const wrong = i % wrongEvery === 0;
    if (answer.kind === "number") {
      const value = Number(answer.values[0]);
      await page.locator(".exam-numeric input").fill(String(wrong ? value + 1 : value));
      continue;
    }

    const boxes = page.locator(`.exam-options input[type=${answer.kind}]`);
    if ((await boxes.count()) === 0) continue;
    if (wrong) {
      await boxes.first().check();
      continue;
    }
    for (const text of answer.values) {
      await page.locator(".exam-option-row", { hasText: text }).first().click();
    }
  }
}

/**
 * Leave the paper on its multi-matching question before the shot.
 *
 * Question order shuffles per attempt, so "question 1" is a different type
 * on every run — and the README and the landing page both describe this
 * image in words. Picking the question by what it RENDERS rather than by
 * its position is what keeps the caption true: multi-matching fills the
 * frame, and no other type in the bank draws an `.exam-match-grid`.
 */
async function showMultiMatching(page: Page): Promise<void> {
  const palette = page.locator(".exam-palette-grid button");
  const total = await palette.count();
  for (let i = 0; i < total; i += 1) {
    await palette.nth(i).click();
    if ((await page.locator(".exam-match-grid").count()) > 0) {
      await page.waitForTimeout(300);
      return;
    }
  }
  throw new Error("no multi-matching question on the paper — the shot's caption would be wrong");
}

async function submit(page: Page): Promise<void> {
  await page.locator(".exam-submit").click();
  await page.getByRole("button", { name: /submit and finish/i }).click();
  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
}

test("marketing shots: the candidate's paper, and the analytics screen behind it", async ({
  page,
  request,
  browser,
}) => {
  const seeded = await seedPublishedTest(request);

  // The candidate, with no account of any kind.
  await openPaper(page, seeded.testSlug);
  await answerSome(page, 6, 5);
  await showMultiMatching(page);
  await shoot(page, "10-exam-runner");
  await submit(page);

  // A cohort behind the first one. Analytics reads as a product screen only
  // with a distribution to show, and one attempt is a bar of height one.
  for (let candidate = 1; candidate <= 7; candidate += 1) {
    const context = await browser.newContext();
    const other = await context.newPage();
    await openPaper(other, seeded.testSlug);
    await answerSome(other, 11 + (candidate % 7), 2 + (candidate % 5));
    await submit(other);
    await context.close();
  }

  // The organiser, on the attempts those eight left behind.
  //
  // Clicked rather than deep-linked. `OrganiserApp` boots on
  // `workspaces[0]` and no URL parameter names a workspace, so
  // `?view=analytics&test=…` renders this test's id against whichever
  // workspace happens to be first — which is this one only when this file
  // runs alone. The switcher is the one thing that holds in both cases.
  await signIn(page);
  // The switcher only renders once there are two workspaces to switch
  // between (`OrganiserShell`'s `D4b`), and running this file alone there
  // is one — which is already the right one.
  const switcher = page.getByLabel("Workspace");
  if ((await switcher.count()) > 0) {
    await switcher.selectOption({ label: "Campus screening" });
  }
  await page.getByRole("navigation", { name: "Organiser" }).getByRole("button", { name: "Tests" }).click();
  await page.getByRole("link", { name: /campus screening/i }).or(
    page.locator("table.testbuilder-list tbody tr .button-link"),
  ).first().click();
  await expect(page.getByRole("heading", { name: "Sections" })).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, "13-test-builder");

  await page.getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
  await page.waitForTimeout(600);
  await shoot(page, "11-analytics");

  // The bank the paper was drawn from: all twelve types, in the rows the
  // worked example documents.
  await page.getByRole("navigation", { name: "Organiser" }).getByRole("button", { name: "Banks" }).click();
  await page.locator(".bank-list__item").first().click();
  await expect(page.locator("table.bank-browser__table")).toBeAttached();
  await page.waitForTimeout(400);
  await shoot(page, "12-bank-browser");
});
