# Phase 6.5a — The Two UX Defects and the Measurement Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `D9`'s two reported defects (#186's unread finish message, #179's 0-minute test) and land `D13`'s density measurement gate with its before-figures captured on `main`, so every later Phase 6.5 plan has a gate to pass.

**Architecture:** Three independent slices. The #179 fix is a two-line extension of an existing blocking checklist row in the API, so a 0-duration test can no longer be published at all. The #186 fix carries `branding.finish_message` onto the existing `Receipt` payload and renders it on the finish page the way `exam.tsx:183` already renders the start message. The `D13` harness is a new Playwright spec that seeds through the API and counts primary rows on each scanning surface at 1440×900; it ships last in this plan and its figures are recorded against `main` before any restyling commit exists.

**Tech Stack:** TypeScript, Hono (`apps/api`), Preact/React + Vite (`apps/web`), Vitest, Playwright, SQLite.

**Spec:** [`docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md`](../specs/2026-10-20-phase-6-5-design-pass-design.md) — §8 (`D9`) and §11 (`D13`). Direction and both prototypes are locked; this plan contains **no restyling**, so it does not depend on `D1`, `D20` or the shell.

**Goals covered:** `G4` — the two UX defects ship. Plus `D13`, the gate every later plan is measured against.

## Global Constraints

Copied verbatim from the spec's §12. Every task's requirements implicitly include this section.

- **`AG2` — never make a gate green by moving a bar.** `maxWorkers` and the 1 s `asyncUtilTimeout` are not knobs. No raised timeout, lowered threshold or weakened assertion.
- **`AG3` — behaviour over text.** Every guard exercises behaviour or asserts an invariant. Never "the rule is present, therefore the behaviour happens".
- **Reachability** — every web assertion starts at `OrganiserApp` or `ExamApp` and clicks its way there.
- `pnpm build` needs `SITE_URL`: `SITE_URL='https://pariksha.example' pnpm build`.
- `pnpm test --force` does not work. Use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one** — pnpm junctions have twice deleted `packages/core/**` and `packages/db/**`. Read a frozen commit with `git show <sha>:<path>`.
- `apps/web/test/no-hex-colors.test.ts` strips only `/* */` comments, so a `//` comment containing a colour word or an issue reference like `#155` fails it. Issue references in CSS go in block comments.
- `apps/web`'s vitest is capped at `maxWorkers: min(availableParallelism(), 4)`.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`, independent of the 10 s `testTimeout`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A` where untracked phase notes live.
- Every merge to `main` needs `node deploy/cloudflare/setup.mjs` afterwards.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-6-5a/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

Input classes the spec implies that no task's tests would otherwise exercise. Each has its test added to the owning task.

1. **A draft whose `timing` object exists but is empty** (`timing: {}`) — the only shape that reaches the #179 hole, because `draftSchema()` strips `required`, so TypeScript's `duration_minutes: number` is a lie at runtime. Task 1.
2. **`duration_minutes: 0` explicitly set** — distinct from absent, and `run.ts:152`'s `?? 0` makes the two indistinguishable downstream. Task 1.
3. **A test whose sections exist but all have zero questions** — `questionCount` sums to 0 and the paper is empty though `no_sections` does not fire. Task 1.
4. **A finish message on a `release.when = "never"` test** — the receipt is the whole answer there, so the message must render with no score alongside it. Task 2.
5. **A finish message containing markup or a very long string** — it is organiser-authored free text reaching a candidate's screen, so it must render as text, never as HTML. Task 2.

---

### Task 1: `#179` — a test with no duration cannot be published

**Files:**
- Modify: `apps/api/src/publish/checklist.ts:158-166` (the `timing_missing` row)
- Test: `apps/api/test/lifecycle.test.ts` — the publish-gate suite. There is **no** `checklist.test.ts`; `buildChecklist` is exercised through `POST …/publish` and `GET …/checklist`, which is the reachability rule already in force. Do not add a unit test that calls `buildChecklist` directly.

**Interfaces:**
- Consumes: `buildChecklist(input: ChecklistInput): ChecklistRow[]`, already exported from `apps/api/src/publish/checklist.ts`. `ChecklistRow` is `{ id: string; severity: "blocking" | "advisory"; field: string; message: string }`.
- Produces: nothing new. The row keeps the id `timing_missing` and the field `timing.duration_minutes` so the builder's rail and `POST …/publish` need no change — this is a widening of one existing condition, not a new row.

**Why this and not `run.ts`:** `apps/api/src/routes/run.ts:152` reads `timing.duration_minutes ?? 0`, and `apps/api/src/run/attempt.ts:339` already throws `paper_unavailable` when it is undefined. The leak is that such a version can be *published* at all. The fix belongs at the gate; `run.ts` is not touched.

- [ ] **Step 1: Write the failing tests**

Add these to `apps/api/test/lifecycle.test.ts`, driving the routes with its existing
`post`/`get` helpers, `publishUrl()` and `rowIds(body)`. PATCH the draft into the shape under
test, then assert on the gate's own answer — publishing must be **refused**, not merely flagged.

```ts
it("refuses to publish a draft whose timing object carries no duration", async () => {
  await patchDraft({ settings: { timing: {} } });
  const { status, body } = await publish();
  expect(status).toBe(422);
  expect(rowIds(body)).toContain("timing_missing");
});

it("refuses to publish a draft whose duration is explicitly zero", async () => {
  await patchDraft({ settings: { timing: { duration_minutes: 0 } } });
  expect((await publish()).status).toBe(422);
});

it("still publishes a draft with a positive duration", async () => {
  expect((await publish()).status).toBe(200);
});

it("refuses to publish when every section is empty", async () => {
  await patchDraft({ sections: [{ id: "s1", title: "A", questions: [] }] });
  const { status, body } = await publish();
  expect(status).toBe(422);
  expect(rowIds(body)).toContain("no_questions");
});

it("reports both rows on GET .../checklist as well as at the gate", async () => {
  await patchDraft({ settings: { timing: {} }, sections: [{ id: "s1", title: "A", questions: [] }] });
  const body = await getChecklist();
  expect(rowIds(body)).toEqual(expect.arrayContaining(["timing_missing", "no_questions"]));
});
```

`patchDraft` and `getChecklist` are thin wrappers over the file's existing `patchReq`/`get`
helpers and `draftUrl()`; add them local to the file if they are not already there. The status code
is whatever the publish gate already returns for a blocking row — read it from a neighbouring test
rather than assuming 422.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx turbo run test --filter=@pariksha/api -- lifecycle`
Expected: the four new refusal cases FAIL (publish returns 200); the positive-duration case passes already.

- [ ] **Step 3: Widen the `timing_missing` condition and add `no_questions`**

In `apps/api/src/publish/checklist.ts`, change the `settings.timing === undefined` guard so the row is also pushed when `timing` is present and `duration_minutes` is absent or not greater than zero. Keep the id, severity, field and message exactly as they are — the builder's rail keys off the id.

Add a sibling blocking row, in the same block as `no_sections` so the two read together:

```ts
{ id: "no_questions", severity: "blocking", field: "sections",
  message: "every section is empty, so there is nothing for a candidate to answer" }
```

Count questions the way the rest of the file reaches into a section; do not add a new traversal helper if one exists.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx turbo run test --filter=@pariksha/api -- lifecycle`
Expected: PASS, and the rest of the lifecycle suite unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/publish/checklist.ts apps/api/test/lifecycle.test.ts
git commit -m "fix(api): refuse to publish a test with no duration or no questions (#179)"
```

- [ ] **Step 6: Read-only check of the deployed instance, and report**

Per the spec: new publishes only, and an existing 0-duration published version is **reported, not silently repaired**. Query the deployed instance read-only for any published version whose `timing.duration_minutes` is absent or zero. Write the result — including "none found" — into `.superpowers/sdd/phase-6-5a/progress.md`. **Do not write to the deployed instance.** If any is found, stop and ask.

---

### Task 2: `#186` — the finish message reaches the candidate

**Files:**
- Modify: `apps/api/src/run/submit.ts:64-76` (the `Receipt` interface) and the function that builds it
- Modify: `apps/web/src/lib/run.ts` (the web-side `Receipt` type)
- Modify: `apps/web/src/components/exam/Receipt.tsx`
- Test: `apps/api/test/run/submit.test.ts`, `apps/web/test/exam/submit.test.tsx` — the existing suite that already renders `ExamApp` and clicks through to submission. Add to it; do not create a `receipt.test.tsx`.

**Interfaces:**
- Consumes: `Receipt` from `apps/api/src/run/submit.ts`; `branding.finish_message?: string` from `packages/core/src/types.ts:430`; the start-message precedent at `apps/web/src/routes/exam.tsx:183`.
- Produces: `Receipt` gains `finishMessage: string | null`. Null, not absent, matching `startMessage: string | null` at `apps/api/src/routes/run.ts:102`. Later plans rendering a receipt rely on this name.

**Why the Receipt and not the start payload:** the finish page renders from the submit response, so the value has to travel on the receipt. It is **test content, not candidate data**, so it takes no scrub exception — confirm that against `apps/api/test/run/scrub-scan.test.ts` rather than assuming it.

- [ ] **Step 1: Write the failing API test**

```ts
it("carries the pinned version's finish message on the receipt", async () => {
  const { receipt } = await submitAttempt(/* fixture with branding.finish_message set */);
  expect(receipt.finishMessage).toBe("Thank you. Your organiser will be in touch.");
});

it("sends null when the test has no finish message", async () => {
  const { receipt } = await submitAttempt(/* fixture with branding empty */);
  expect(receipt.finishMessage).toBeNull();
});

it("reads the message from the attempt's pinned version, not the live draft", async () => {
  // publish v1 with message A, start an attempt, edit the draft to message B, submit
  expect(receipt.finishMessage).toBe("A");
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/api -- submit`
Expected: FAIL — `finishMessage` is not a property of `Receipt`.

- [ ] **Step 3: Add `finishMessage` to the receipt**

Add `finishMessage: string | null;` to the `Receipt` interface with a one-line doc comment in the file's voice, and populate it where the receipt is built, reading `branding.finish_message` from **the version the attempt is pinned to** — the same source the rest of `submit.ts` already reads settings from — with `?? null`.

- [ ] **Step 4: Run and verify they pass**

Run: `npx turbo run test --filter=@pariksha/api -- submit`
Expected: PASS.

- [ ] **Step 5: Confirm the scrub scan still passes and says why**

Run: `npx turbo run test --filter=@pariksha/api -- scrub-scan`
Expected: PASS with no new exception added. If it fails, the field has been misclassified as candidate data — stop and ask rather than adding an exception.

- [ ] **Step 6: Write the failing web test, reachable from `ExamApp`**

Per the spec: **tested from `ExamApp`, clicked through to submission** — not by rendering `Receipt` directly.

Use the file's own `render(<ExamApp client={…} />)` pattern and its run-client stub
(`apps/web/test/exam/run-client-stub.ts`) rather than a new helper.

```tsx
it("shows the organiser's finish message after submitting", async () => {
  renderExamApp(/* test whose branding.finish_message is set, release.when = "never" */);
  await startAttempt(); await submit();
  expect(await screen.findByText("Thank you. Your organiser will be in touch.")).toBeVisible();
});

it("shows no empty message block when the organiser set none", async () => {
  renderExamApp(/* branding empty */);
  await startAttempt(); await submit();
  expect(screen.queryByTestId("exam-finish-message")).toBeNull();
});

it("renders the message as text, never as markup", async () => {
  renderExamApp(/* finish_message: '<img src=x onerror="alert(1)">bye' */);
  await startAttempt(); await submit();
  expect(await screen.findByText('<img src=x onerror="alert(1)">bye')).toBeVisible();
  expect(document.querySelector("#exam-root img")).toBeNull();
});
```

- [ ] **Step 7: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- exam/submit`
Expected: FAIL — no such text.

- [ ] **Step 8: Mirror the field and render it**

Add `finishMessage: string | null` to the web-side `Receipt` type in `apps/web/src/lib/run.ts`. In `apps/web/src/components/exam/Receipt.tsx`, render it when non-null as a paragraph carrying `data-testid="exam-finish-message"`, placed above `NO_RESULT_NOTE`. Use JSX text interpolation — never `dangerouslySetInnerHTML`. Reuse the existing finish-page type scale; add no new colour (see Global Constraints: `no-hex-colors`).

- [ ] **Step 9: Run the web tests and the axe assertions**

Run: `npx turbo run test --filter=@pariksha/web -- exam/submit`
Expected: PASS, including the file's existing axe assertion.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/run/submit.ts apps/api/test/run/submit.test.ts \
        apps/web/src/lib/run.ts apps/web/src/components/exam/Receipt.tsx \
        apps/web/test/exam/submit.test.tsx
git commit -m "fix: render the organiser's finish message on the receipt (#186)"
```

---

### Task 3: Audit every `branding` field for a writer with no reader

**Files:**
- Create: `docs/superpowers/notes/2026-10-20-branding-field-audit.md`
- Test: none — this task produces a finding, not behaviour.

**Interfaces:**
- Consumes: `TestBranding` in `packages/core/src/types.ts:414-432`; `BrandingPanel.tsx` as the writer; `apps/api/src/routes/run.ts:178` and Task 2's receipt as the known readers.

**Why:** the spec requires it in the same breath as #186 — "walk every field an organiser can set in `branding` and ask which reach a candidate. Anything else with a writer and no reader is **reported, not quietly wired**." #186 was one instance of a class; this task finds the rest.

- [ ] **Step 1: Enumerate writers and readers**

For each field of `TestBranding`, record: where the organiser sets it, every place it is read on a candidate-facing path, and the verdict — *reaches a candidate* / *writer with no reader* / *deliberately deferred*.

- [ ] **Step 2: Write the note**

One table, one row per field. `branding.logo` is already known-unread and **deliberately deferred** — record it as such with its two standing constraints (it needs its own branding-scoped route, and it must never ride `layout.media`).

- [ ] **Step 3: Report, do not wire**

If the audit finds a field with a writer and no reader other than `logo`, **stop and ask**. Do not implement it; it is new capability and outside #187's scope line.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-10-20-branding-field-audit.md
git commit -m "docs: audit branding fields for writers with no reader (#186)"
```

---

### Task 4: `D13` — the density gate, with before-figures from `main`

**Files:**
- Create: `apps/web/e2e/seed.ts` (API-driven fixture builder)
- Create: `apps/web/e2e/density.spec.ts`
- Modify: `apps/web/playwright.config.ts` (admit the new spec; do not change `workers` or any timeout)
- Create: `docs/superpowers/notes/2026-10-20-density-before.md`

**Interfaces:**
- Consumes: the existing e2e harness behind `apps/web/e2e/first-run.spec.ts` — 4 tests, `workers: 1`, `:memory:`, against an empty instance — and `apps/web/e2e/stub-idp.mjs` for sign-in.
- Produces: `seedWorkspace(request, { banks, questionsPerBank, tests }): Promise<SeedResult>` from `apps/web/e2e/seed.ts`, where `SeedResult` carries the created workspace id and the bank and test ids. Later Phase 6.5 plans reuse this; it is the only seeding helper.
- Produces: `countPrimaryRows(page, surface): Promise<number>` from `apps/web/e2e/density.spec.ts`'s helper module, where `surface` is one of the four scanning surfaces.

**Why a real browser:** `apps/web`'s suite is jsdom — no layout, `getBoundingClientRect()` returns zeros — and `component-dimensions.test.ts` parses CSS text and cannot count what fits in a viewport.

**Scope — `D12`.** The gate covers **scanning** surfaces only: test list, bank list, bank browser, question picker. It does **not** cover the builder, the question editor, the wizard or sign-in.

- [ ] **Step 1: Write the seeding helper and prove it seeds**

```ts
it("seeds a workspace reachable in the organiser", async ({ page, request }) => {
  const seed = await seedWorkspace(request, { banks: 6, questionsPerBank: 20, tests: 14 });
  await signIn(page);
  await expect(page.getByRole("button", { name: /Tests/ })).toContainText("14");
});
```

Seed **through the API**, never by writing to the database — a fixture that bypasses the routes stops matching what the product produces.

- [ ] **Step 2: Run it and verify it fails**

Run: `npx playwright test apps/web/e2e/density.spec.ts --reporter=line`
Expected: FAIL — `seedWorkspace` is not defined.

- [ ] **Step 3: Implement `seedWorkspace` in `apps/web/e2e/seed.ts`**

Create the workspace, banks, questions and tests over HTTP using the same endpoints the organiser calls. Make the row counts parameters, not constants.

- [ ] **Step 4: Write the density assertions**

At `1440×900`, for each of the four scanning surfaces, count primary rows whose bounding box is fully inside the viewport, and assert against a figure recorded in the file as a named constant with a comment saying it was captured on `main`:

```ts
const BEFORE = { testList: 0, bankList: 0, bankBrowser: 0, questionPicker: 0 }; // filled in Step 6

for (const surface of SURFACES) {
  it(`shows no fewer rows than main on ${surface}`, async ({ page, request }) => {
    await seedAndOpen(page, request, surface);
    expect(await countPrimaryRows(page, surface)).toBeGreaterThanOrEqual(BEFORE[surface]);
  });
}
```

A row counts only if its full height is within the viewport — a half-visible row is not a row you can read.

- [ ] **Step 5: Run and verify the spec executes against the current UI**

Run: `npx playwright test apps/web/e2e/density.spec.ts --reporter=line`
Expected: the four tests run and pass trivially against `BEFORE` of 0.

- [ ] **Step 6: Capture the before-figures on `main` and fill them in**

With the working tree on `main`'s UI, run the spec in reporting mode and record the four counts. Write them into `BEFORE` **and** into `docs/superpowers/notes/2026-10-20-density-before.md` with the date, the commit sha and the viewport, so a later reader can tell a regression from a re-measurement.

This is the figure every later Phase 6.5 plan is measured against. **It must be captured before the first restyling commit exists** — which is why this plan ships before the shell, the builder and the screens.

- [ ] **Step 7: Run the whole e2e suite and verify nothing else moved**

Run: `npx playwright test --reporter=line`
Expected: PASS, including the 4 pre-existing `first-run` tests. `workers` stays at 1 and no timeout changes (`AG2`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/e2e/seed.ts apps/web/e2e/density.spec.ts \
        docs/superpowers/notes/2026-10-20-density-before.md
git commit -m "test(web): add the AG1 density gate with before-figures from main (D13)"
```

---

## Remaining plans for Phase 6.5

This plan is one of six. The spec covers six independently shippable subsystems, and each of the others gets its own plan:

| plan | covers | depends on |
| --- | --- | --- |
| **6.5a** (this one) | `D9` defects, `D13` density gate | nothing |
| 6.5b — the ground | `D1`, `D2`, `D20`, ADR 0010, `DESIGN.md` front matter, token regeneration, the light/dark switch, doubling `contrast-usage.test.ts` | nothing |
| 6.5c — the shell | `D3`–`D6`, `D3a`, `D4a`/`D4b`, `D5` URL state, `D6a`/`D6b` Home and `closesAt` on the wire | 6.5a, 6.5b |
| 6.5d — the builder | `D7`, `D7a`–`D7d`, `D16`, `D16a`, `D17` | 6.5b, 6.5c |
| 6.5e — the screens | `D10`, `D12`, `D15`, `D18`, `D19`, `D21`, `D21a`/`D21b`, `D14` test migration | 6.5b, 6.5c |
| 6.5f — the runtime | `D8` literal sweep | 6.5b. **Cut first** under §15 if the phase runs long |

6.5a and 6.5b are independent of each other and of everything else, so they can run in either order or in parallel.
