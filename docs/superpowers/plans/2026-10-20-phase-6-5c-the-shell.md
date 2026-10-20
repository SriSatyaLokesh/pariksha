# Phase 6.5c — The Organiser Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the organiser a persistent shell — sidebar, top bar, shared page chrome across every screen — with view state in the query string, a workspace switcher that appears only above one membership, and Home turned into a real agenda built from reads that already exist (#181, `D3`–`D6`).

**Architecture:** `OrganiserApp` is a state machine over a `View` union with no router (`apps/web/src/routes/organiser.tsx`, 238 lines, eleven `case` arms). The chrome hoists out of the individual screens into `OrganiserApp`, so each screen supplies a title and a primary action instead of rendering its own `OrganiserHeader`. View state moves into `?view=` and is read on first paint and on `popstate`, exactly as `sectionFromUrl()` already does in `test.tsx:39`. Home becomes an agenda grouped by time horizon, derived from `client.tests()` and `client.listBanks()` plus one new field on the wire.

**Tech Stack:** Preact/React + TypeScript, Hono (`apps/api`), Vitest + Testing Library, CSS custom properties.

**Spec:** [`docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md`](../specs/2026-10-20-phase-6-5-design-pass-design.md) — §5 (`D3`, `D3a`, `D4`, `D4a`, `D4b`, `D5`, `D6`, `D6a`, `D6b`), §11 (`D21`, `D21a`, `D21b`), §12.

**Depends on:** **6.5b** for `theme.css`'s semantic names and `readGround`/`writeGround`. **6.5a** for `D13`'s before-figures, which this plan's screens are measured against.

**Goals covered:** `G2` — the organiser gets a persistent shell: sidebar, a top bar that carries something, shared page chrome across all twelve screens (#181).

## Global Constraints

Copied verbatim from the spec's §12. Every task's requirements implicitly include this section.

- **`DESIGN.md` front matter is the only place a colour may be declared.** All CSS here reads 6.5b's semantic names (`--ground`, `--ink`, `--accent`…). No raw hex, no new `rgb()` literal.
- `no-hex-colors.test.ts` strips only `/* */` comments. **Issue references in CSS go in block comments.**
- **`AG1`** — a scanning surface must not end up showing fewer rows. Enforced by 6.5a's `apps/web/e2e/density.spec.ts`. **Scope: scanning surfaces only** (`D12`) — the test list, bank list, bank browser and question picker. It does **not** apply to the builder, the question editor, the wizard or sign-in.
- **`AG2`** — never make a gate green by moving a bar. `maxWorkers` and the 1 s `asyncUtilTimeout` are not knobs.
- **`AG3`** — every guard exercises behaviour or asserts an invariant.
- **Reachability (`D14`)** — every assertion starts at `OrganiserApp` and clicks its way there. Any test file this plan edits is rewritten to that standard; the lighter mechanical prop-drop was offered and refused.
- **`D15` — two spacing scales.** Inside a component: 4 / 6 / 8 / 12 / 16. Between the page and its edges: 20 / 28 / 36 / 56. The existing `--space-*` tokens cover both ranges, so this is a usage rule, not new tokens.
- `pnpm build` needs `SITE_URL`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`, independent of the 10 s `testTimeout`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-6-5c/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **Switching workspace while a test id is in the URL** — `?view=tests&test=tst_8c21a4` carried into workspace B is a 404 at best and a cross-tenant read at worst. `D4a` requires the switch to clear every id-bearing parameter. Task 4.
2. **A hand-typed or stale `?view=` naming a test or bank the actor cannot reach** — a deep link is a URL anyone can edit. It must land on an error or Home, never render a shell around nothing. Task 2.
3. **Back and forward through several views** — `popstate` is the only thing standing in for a router, and the spec's whole argument for `D5` is that a persistent nav makes Back a visible problem. Task 2.
4. **An actor with exactly one membership, and one with three** — `D4`'s two shapes. The always-no-op control is the thing `D4` exists to avoid. Task 4.
5. **A test whose `closes_at` is absent, in the past, or unparseable** — the agenda sorts by it and must not throw or mis-group. Task 3.

---

### Task 1: hoist the chrome into `OrganiserApp`

**Files:**
- Modify: `apps/web/src/routes/organiser.tsx:49-238`
- Create: `apps/web/src/components/OrganiserShell.tsx`
- Delete: `apps/web/src/components/OrganiserHeader.tsx` (after its last caller is gone)
- Create: `apps/web/src/styles/shell.css`
- Test: `apps/web/test/organiser.test.tsx`

**Interfaces:**
- Consumes: 6.5b's semantic names and `readGround`/`writeGround` from `apps/web/src/lib/ground.ts`.
- Produces:

```tsx
export function OrganiserShell(props: {
  current: NavKey;                  // "home" | "banks" | "tests"
  crumb?: string;
  title: string;
  lead?: string;
  actions?: ReactNode;
  workspaces: Workspace[];          // drives D4's two shapes
  actor: Actor;
  onNavigate: (key: NavKey) => void;
  onSignOut: () => void;
  children: ReactNode;
}): JSX.Element;
```

Every screen in 6.5d and 6.5e renders *inside* `children` and supplies `title` and `actions`. They no longer render chrome, and `onSignOut`/`onBack`/`backLabel` are deleted from their props.

**Rules from `D3`:**
- "You are here" is **three signals, never hue alone** — an accent left bar, a heavier label, and `aria-current="page"`.
- Nav items carry **icon and label**. Nothing in the sidebar is a primary action.
- Sidebar order: Home, then Banks and Tests. **Phase 8's Results and Grading are absent**, not dimmed. (The prototype dimmed them only to convey the eventual shape.)
- The sidebar is **not rendered** during sign-in or the first-run wizard — a nav with nothing behind it is the lie `admin.css:99-101` refused.
- Collapsible to 56px.

**`D3a` — below 719px the shell is one column, never a zero column.** The rail leaves the grid (`display: none`) and `grid-template-columns` becomes a single `minmax(0,1fr)`. Writing `0 1fr` instead reproduces the trap `D18` records and the narrow prototype pass hit a second time: with the rail gone, auto-placement drops the page into the 0-wide first track and the screen renders empty. At that width every panel becomes its own scroll container, so a table wider than the screen scrolls inside its panel and **the page itself never scrolls sideways**.

- [ ] **Step 1: Write the failing tests, reachable from `OrganiserApp`**

```tsx
it("shows one persistent sidebar across Home, Banks and Tests", async () => {
  renderOrganiser(); await signedIn();
  await user.click(screen.getByRole("button", { name: "Banks" }));
  expect(screen.getAllByRole("navigation", { name: "Organiser" })).toHaveLength(1);
});

it("marks the current screen with aria-current and not with colour alone", async () => {
  // three signals: aria-current, a heavier label, an accent bar
});

it("does not render the sidebar on sign-in", async () => {
  renderOrganiser({ signedOut: true });
  expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
});

it("does not render the sidebar during the first-run wizard", async () => { /* … */ });

it("omits Results and Grading entirely", async () => {
  expect(screen.queryByRole("button", { name: /Results|Grading/ })).toBeNull();
});

it("collapses the rail to icons and back", async () => { /* aria-expanded on the toggle */ });
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- organiser`
Expected: FAIL — several navigations, no persistent nav.

- [ ] **Step 3: Build `OrganiserShell` and render every `View` arm inside it**

Move the chrome out of each `case` arm in `organiser.tsx`'s switch. The arms keep deciding *what* renders; the shell decides *where*. `loading`, `error`, `signin` and `setup` render without the shell.

- [ ] **Step 4: Write `shell.css` against 6.5b's names and `D15`'s two scales**

Rail 236px / 56px collapsed, top bar 56px — the prototype's proportions, and `D15`'s page scale between the page and its edges.

- [ ] **Step 5: Run the tests, the axe assertions and the contrast suite**

Run: `npx turbo run test --filter=@pariksha/web -- organiser contrast`
Expected: PASS. New selectors need their `SURFACE` entries **on both grounds** (6.5b, Task 3) or the audit throws.

- [ ] **Step 6: Delete `OrganiserHeader.tsx` and its now-dead props**

Run: `grep -rn "OrganiserHeader\|backLabel\|onBack" apps/web/src` — expected empty.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/organiser.tsx apps/web/src/components/OrganiserShell.tsx \
        apps/web/src/styles/shell.css apps/web/test/organiser.test.tsx
git rm apps/web/src/components/OrganiserHeader.tsx
git commit -m "feat(web): hoist the organiser chrome into a persistent shell (#181, D3)"
```

---

### Task 2: view state in the query string

**Files:**
- Modify: `apps/web/src/routes/organiser.tsx`
- Create: `apps/web/src/lib/view-url.ts`
- Test: `apps/web/test/organiser-url.test.tsx`

**Interfaces:**
- Produces: `readView(search: string): ViewParams` and `writeView(params: ViewParams): void` from `apps/web/src/lib/view-url.ts`, where `ViewParams` is `{ view: NavKey | "test" | "bank" | "question"; test?: string; bank?: string; section?: string; panel?: string }`. 6.5d's `?panel=` and 6.5e's `?section=` go through these; neither parses the query string itself.
- Consumes: the existing pattern in `apps/web/src/routes/test.tsx:39` (`sectionFromUrl`) and its `popstate` listener at `:160`. **Replace that local helper with `readView`** rather than leaving two parsers.

**`D5` — no router library.** A path router needs a server rewrite the static host does not have, and #183 is exactly what happens when we assume a platform rewrite behaves as modelled. Routing is one `switch`; manual nesting is contained in one file.

- [ ] **Step 1: Write the failing tests**

```tsx
it("opens the view named in the query string on first paint", async () => {
  renderOrganiser({ search: "?view=banks" });
  expect(await screen.findByRole("heading", { name: "Banks" })).toBeVisible();
});

it("follows the Back button between views", async () => {
  // navigate home -> banks -> tests, then popstate twice
});

it("lands safely when the query string names a test the actor cannot reach", async () => {
  renderOrganiser({ search: "?view=test&test=tst_nope" });
  // an error or Home — never a shell wrapped around nothing
});

it("ignores an unknown view name", async () => {
  renderOrganiser({ search: "?view=wat" });
  expect(await screen.findByRole("heading", { name: "Home" })).toBeVisible();
});

it("keeps returnTo working alongside the new parameters", async () => { /* … */ });
```

`?returnTo=` already survives the identity round trip and is validated by `lib/api`'s `safeReturnTo`. **Do not change that validation**; `readView` must leave the parameter alone.

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- organiser-url`

- [ ] **Step 3: Implement `view-url.ts` and wire it into the switch**

Read on first paint and on `popstate`. Every navigation pushes a history entry.

- [ ] **Step 4: Replace `test.tsx`'s local `sectionFromUrl`**

Delete the helper at `test.tsx:39` and its listener's parser at `:160`; both call `readView` now.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx turbo run test --filter=@pariksha/web -- organiser-url testbuilder`
Expected: PASS, including the existing section-open-by-URL behaviour.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/view-url.ts apps/web/src/routes/organiser.tsx \
        apps/web/src/routes/test.tsx apps/web/test/organiser-url.test.tsx
git commit -m "feat(web): view state in the query string, one parser (D5)"
```

---

### Task 3: `closesAt` on the wire, and Home becomes an agenda

**Files:**
- Modify: `apps/api/src/routes/tests.ts:435-466` (`TestWire` and `toWire`)
- Modify: `apps/web/src/lib/api.ts` (the mirrored type)
- Create: `apps/web/src/routes/home.tsx`
- Test: `apps/api/test/tests.test.ts`, `apps/web/test/organiser-home.test.tsx`

**Interfaces:**
- Produces: `TestWire` gains `closesAt: number | null`. **One field of data the route already holds** — `toWire` destructures `publishedTiming`, uses it to derive `state`, and throws it away. Not a new query, not a new endpoint, not a schema change.
- Consumes: `client.tests(workspaceId)` → `state`, `reviewRequested`, `draftVersion`, `currentVersion`, `updatedAt`, and now `closesAt`; `client.listBanks(workspaceId)` → `questionCount`. **Two calls answer every figure on the page.**

**`D6` — Home may call no endpoint that does not already exist.** The endpoint constraint is what keeps this inside #187's scope line. If Home ever wants an aggregate, that is Phase 8's analytics work and the answer is no.

**`D6a` — Home is an agenda, not a tile grid.** Grouped by **time horizon** — Today / This week / Whenever you like — as 40px single-line rows: time in mono on the left, a 7px urgency dot, subject in bold with the reason muted on the same line, action revealed on hover and focus. A group header carries its count; **a horizon with nothing in it is not rendered**; overflow collapses. The shape is identical at four items and at forty, and its height is bounded.

**`D21` — Home never scrolls, and the strip at its foot is a control.** Chrome and status strip stay on screen; the two panes between them scroll inside themselves. Four pills, each counting a set and **selecting** it: pressing one marks every row it counts in both panes, pressing again or Escape clears. One at a time. Marking, **not** filtering — nothing moves or hides; unmatched rows recede to `opacity: 0.8` and no further, because past that secondary text drops under the 3:1 `DESIGN.md` requires.

- **`D21b`** — the tone on a pill is a round dot, not a rail: a straight bar inside a fully-rounded capsule puts the component's only square edge beside its roundest one. It is the same construct the agenda uses for urgency.
- A pill that counts a set with **no rows on this page would be dead on click**, so the two scale figures (total tests, total questions) are the page lead, not pills.

**"Blocking publish" is not an agenda row** — it needs one checklist computation per test, and it lives in the builder's rail (6.5d), where the checklist already runs.

- [ ] **Step 1: Write the failing API test**

```ts
it("returns closesAt from the published timing", async () => {
  const body = await listTests();
  expect(body.tests[0].closesAt).toBe(CLOSES_AT_MS);
});
it("returns null for a test that has never been published", async () => { /* … */ });
it("returns null when the published timing sets no closing time", async () => { /* … */ });
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx turbo run test --filter=@pariksha/api -- tests`

- [ ] **Step 3: Add `closesAt` to `TestWire` and `toWire`**

Read it off the already-destructured `publishedTiming`; `?? null`. Mirror the field in the web client's type.

- [ ] **Step 4: Write the failing Home tests**

```tsx
it("groups what needs you by time horizon", async () => { /* Today / This week / Whenever you like */ });
it("does not render a horizon with nothing in it", async () => { /* … */ });
it("never scrolls the page itself", async () => { /* the page element, not the panes */ });
it("marks the rows a pill counts, in both panes, and clears on Escape", async () => { /* … */ });
it("leaves unmatched rows readable rather than hiding them", async () => { /* … */ });
it("reads the same at four items and at forty", async () => { /* bounded height */ });
it("handles a test whose closesAt is null, past, or unparseable", async () => { /* no throw */ });
it("calls only tests() and listBanks()", async () => {
  expect(clientCalls()).toEqual(["setupStatus", "me", "workspaces", "tests", "listBanks"]);
});
```

The last one is the guard that keeps `D6`'s endpoint constraint honest — an invariant, not a mechanism (`AG3`).

- [ ] **Step 5: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- organiser-home`

- [ ] **Step 6: Build Home**

Derive the rows: never published (`currentVersion === null`), awaiting review (`reviewRequested`), changes since publish (`draftVersion > currentVersion`), closing (`closesAt`). Sorting and grouping are pure functions over the two payloads — put them in `home.tsx` beside the component, not in a new module, until a second caller exists.

- [ ] **Step 7: Run the tests, axe and contrast**

Run: `npx turbo run test --filter=@pariksha/web -- organiser-home contrast`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/tests.ts apps/api/test/tests.test.ts \
        apps/web/src/lib/api.ts apps/web/src/routes/home.tsx \
        apps/web/test/organiser-home.test.tsx
git commit -m "feat: Home becomes an agenda, and closesAt joins the wire (D6, D6b, D21)"
```

---

### Task 4: the workspace switcher, and what a switch does to the URL

**Files:**
- Modify: `apps/web/src/components/OrganiserShell.tsx`
- Modify: `apps/web/src/lib/view-url.ts`
- Test: `apps/web/test/organiser.test.tsx`

**Interfaces:**
- Consumes: `workspaces: Workspace[]`, which `OrganiserApp` already fetches to pick `workspaces[0]` — **so the count is free**.
- Produces: `resetViewForWorkspace(): void` in `view-url.ts`, clearing every id-bearing parameter.

**`D4`** — the top bar always names the workspace, the person and sign-out. It becomes a *switcher* only when the actor holds **more than one** membership. Most people have one workspace and an always-no-op control is noise.

**`D4b`** — the control is a native `<select>`. It carries the keyboard, the mobile picker and an accessible name for free; a custom menu is focus-management work for no gain. The visible "Workspace" label is the `<label>`, and below 719px it is clipped to the accessibility tree rather than removed, so the select keeps its name while **Sign out stays whole** — the narrow prototype pass found the bar clipping it.

**`D4a` — switching workspace resets the view to `?view=home`.** This is the part of `D4` that can ship broken and the part no prototype can show. Under `D5` the view lives in the query string; a switch that keeps it asks workspace B for a test id belonging to workspace A — a 404 if the route checks membership, a cross-tenant read if it does not. The switch clears `test`, `bank`, `section` and `panel`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("names the workspace and offers no switcher at one membership", async () => {
  renderOrganiser({ memberships: 1 });
  expect(screen.getByText("Aurora Institute")).toBeVisible();
  expect(screen.queryByRole("combobox", { name: /workspace/i })).toBeNull();
});

it("becomes a switcher at two memberships", async () => {
  renderOrganiser({ memberships: 3 });
  expect(await screen.findByRole("combobox", { name: /workspace/i })).toBeVisible();
});

it("clears every id-bearing parameter when the workspace changes", async () => {
  renderOrganiser({ memberships: 2, search: "?view=test&test=tst_8c21a4&panel=timing" });
  await user.selectOptions(screen.getByRole("combobox", { name: /workspace/i }), "Northfield");
  expect(window.location.search).toBe("?view=home");
});

it("does not request the other workspace's test after a switch", async () => {
  // the assertion that matters: no call carrying tst_8c21a4 to workspace B
});
```

The last two are `D4a`. **Assert by switching with a test id in the URL**, not by reading the reducer (`AG3`).

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- organiser`

- [ ] **Step 3: Implement both shapes and the reset**

- [ ] **Step 4: Run the tests and verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/OrganiserShell.tsx apps/web/src/lib/view-url.ts \
        apps/web/test/organiser.test.tsx
git commit -m "feat(web): workspace switcher above one membership, resetting the view (D4, D4a)"
```

---

### Task 5: the density gate still passes

**Files:**
- Modify: `apps/web/e2e/density.spec.ts` (figures only if a surface legitimately improved)

- [ ] **Step 1: Run 6.5a's gate against the new shell**

Run: `npx playwright test apps/web/e2e/density.spec.ts --reporter=line`
Expected: PASS. The shell adds a 236px rail to every scanning surface, which is exactly the regression `AG1` exists to catch.

- [ ] **Step 2: If a surface shows fewer rows, fix the surface**

**Do not lower a figure** (`AG2`). The rail is collapsible and the bank browser opens with it collapsed (`D18`); if a scanning surface is short of rows, that is the lever, not the gate.

- [ ] **Step 3: Commit only if a figure legitimately rose**

```bash
git commit -am "test(web): record the shell's density figures (AG1)"
```
