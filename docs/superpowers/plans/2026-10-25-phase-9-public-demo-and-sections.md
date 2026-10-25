# Phase 9 — Public Demo Instance and Candidate Exam Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver section division in the candidate exam runner and a public demo instance that evaluators can test-drive without signing in, engineered for zero Cloudflare billing via single-fetch client caching, local scoring, and no image proctoring.

**Architecture:** Candidate exam runner gains first-class section headers, section tabs, and a section-grouped question palette across `free`, `linear`, and `per_section` navigation modes. The public demo provides instant zero-login entry from the landing page, serving a multi-section sample test across all 12 question types with `proctoring: "off"` (0 R2 writes) and CDN/client caching (1 fetch, 0 repeated API hits). Ephemeral demo workspaces for organiser evaluation are rate-limited, strictly isolated, and automatically cleaned up after 1 hour.

**Tech Stack:** TypeScript (strict), React/Preact, Hono, `@pariksha/core`, `@pariksha/db`, Vitest, Playwright.

**Spec:** [`../../ROADMAP.md`](../ROADMAP.md) (Phase 9), [`../../design.md`](../design.md), [`../specs/2026-10-21-phase-7-proctoring-design.md`](../specs/2026-10-21-phase-7-proctoring-design.md), [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md).

## Global Constraints

- **Zero Cloudflare Bill / Cost Ceiling**: Public demo test sits behind `Cache-Control: public, max-age=3600, s-maxage=86400` on the edge, or is loaded from static assets; candidate demo runs entirely local-first (0 D1 write rows per answer, 0 R2 image uploads, `proctoring: "off"`).
- **No Image Proctoring in Demo (`P-05`, `P-06`)**: Demo test definition has `proctoring: { camera: "none", fullscreen: "none", tabSwitch: "none" }`. Zero snapshot uploads, zero storage subrequests.
- **Section Integrity (`C-02`, `T-13`)**: Under `per_section` navigation, sections before `maxIndex` remain strictly locked; under `linear`, questions before `maxIndex` are locked; under `free`, candidates may freely switch sections.
- **Roving Tabindex & WCAG 2.1 AA (`UX-18`)**: Sectioned palette maintains single tab-stop roving navigation with arrow keys; screen readers announce section titles and item counts.
- **Demo Abuse Boundary**: Demo workspaces are tagged with `is_demo = 1` or slug prefix `demo-`. They cannot send email (`resend`), cannot register webhooks, cannot store BYOK keys, and are wiped after 1 hour.

## Review Focus

1. **Section boundary transition in `per_section` mode**: Moving past the last question of Section 1 auto-locks Section 1 and activates Section 2 without dropping unsubmitted answers.
2. **Palette square indexing across section gaps**: When a section has 0 questions or filtered questions, flat numbering (`Q1...QN`) remains continuous and matches server grading indices.
3. **Demo candidate reload mid-test without server state**: Reloading the page during a cached demo attempt resumes questions and timer from `sessionStorage`/`localStorage` with 0 server queries.
4. **Local scoring parity**: Instant client-side submission in demo mode uses `@pariksha/core`'s `scoreAttempt` and produces exact results identical to the API's scoring engine.
5. **Demo workspace isolation breach attempt**: A demo session cookie or demo workspace ID cannot read, list, or modify non-demo tenant data (404/403 enforced).

---

### Task 1: Candidate Exam Section Header & Navigation Tabs

**Files:**
- Create: `apps/web/src/components/exam/SectionNav.tsx`
- Modify: `apps/web/src/components/exam/Runner.tsx`
- Test: `apps/web/test/exam/section-nav.test.tsx`

**Interfaces:**
- Consumes: `AttemptPaper`, `PaperSection`, `CandidateQuestion` from `apps/web/src/lib/paper.ts`.
- Produces: `SectionNavProps`, `<SectionNav />` component displaying active section title, section switcher tabs (in `free` mode), section time countdown (when `timeLimitMinutes` is configured), and a collapsible section instructions drawer.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/test/exam/section-nav.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SectionNav } from "../../src/components/exam/SectionNav";
import type { PaperSection } from "../../src/lib/paper";

const sampleSections: PaperSection[] = [
  {
    id: "sec_1",
    title: "General Knowledge",
    instructions: "Answer all 5 questions. No negative marking.",
    timeLimitMinutes: null,
    questions: [{ id: "q1", type: "multiple_choice", prompt: "Capital of India?", points: 1 }],
  },
  {
    id: "sec_2",
    title: "Mathematics",
    instructions: "Calculators permitted.",
    timeLimitMinutes: 15,
    questions: [{ id: "q2", type: "numeric", prompt: "2 + 2 = ?", points: 2 }],
  },
];

describe("SectionNav Component", () => {
  it("renders the active section title and question count", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="free"
        onSelectSection={vi.fn()}
      />,
    );
    expect(screen.getByText("General Knowledge")).toBeInTheDocument();
  });

  it("permits switching sections in free navigation mode", () => {
    const onSelect = vi.fn();
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="free"
        onSelectSection={onSelect}
      />,
    );
    const mathTab = screen.getByRole("tab", { name: /Mathematics/i });
    fireEvent.click(mathTab);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("disables future section switching in per_section mode", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="per_section"
        onSelectSection={vi.fn()}
      />,
    );
    const mathTab = screen.getByRole("tab", { name: /Mathematics/i });
    expect(mathTab).toBeDisabled();
  });

  it("toggles section instructions modal/drawer when instructions exist", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="free"
        onSelectSection={vi.fn()}
      />,
    );
    const infoButton = screen.getByRole("button", { name: /section instructions/i });
    fireEvent.click(infoButton);
    expect(screen.getByText(/Answer all 5 questions/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test apps/web/test/exam/section-nav.test.tsx`
Expected: FAIL ("Cannot find module SectionNav")

- [ ] **Step 3: Implement `SectionNav.tsx` and integrate into `Runner.tsx`**

Create `apps/web/src/components/exam/SectionNav.tsx`:
- Render accessible tablist (`role="tablist"`, `aria-label="Exam Sections"`).
- Render each section with title, question count, and badge indicators.
- In `per_section` mode, past sections render locked, current is active, future are disabled.
- In `free` mode, clicking any tab invokes `onSelectSection(index)`.
- Include an info button to view section instructions when present.

In `apps/web/src/components/exam/Runner.tsx`:
- Derive current section index: `const currentSectionIndex = sectionOfIndex(paper)[index] ?? 0;`.
- Render `<SectionNav />` above the question pane.
- Handle section jump: calculate the first question index of the chosen section and call `onIndex(firstIndex)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test apps/web/test/exam/section-nav.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/exam/SectionNav.tsx apps/web/src/components/exam/Runner.tsx apps/web/test/exam/section-nav.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(exam): add section navigation tabs and instruction drawers to candidate runner"
```

---

### Task 2: Section-Grouped Question Palette

**Files:**
- Modify: `apps/web/src/components/exam/Palette.tsx`
- Modify: `apps/web/src/components/exam/Runner.tsx`
- Test: `apps/web/test/exam/palette.test.tsx`

**Interfaces:**
- Consumes: `PaletteSectionGroup { id: string; title: string; questions: PaletteQuestion[] }`.
- Produces: Updated `<Palette />` component supporting grouped sections with distinct headers, per-section tally ("X/Y answered"), and collapsible or visually separated question grids.

- [ ] **Step 1: Write the failing tests**

```tsx
// in apps/web/test/exam/palette.test.tsx
it("renders question squares grouped under section headings", () => {
  const sections = [
    {
      id: "sec_1",
      title: "Section 1: Quantitative",
      questions: [
        { id: "q1", number: 1, state: "answered" as const },
        { id: "q2", number: 2, state: "unanswered" as const },
      ],
    },
    {
      id: "sec_2",
      title: "Section 2: Verbal",
      questions: [
        { id: "q3", number: 3, state: "unanswered" as const },
      ],
    },
  ];

  render(
    <Palette
      sections={sections}
      onJump={vi.fn()}
    />,
  );

  expect(screen.getByText("Section 1: Quantitative")).toBeInTheDocument();
  expect(screen.getByText("Section 2: Verbal")).toBeInTheDocument();
  expect(screen.getByText(/1\/2 answered/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test apps/web/test/exam/palette.test.tsx`
Expected: FAIL ("Palette does not render section headings")

- [ ] **Step 3: Implement section grouping in `Palette.tsx`**

- Accept `sections?: PaletteSectionGroup[]` alongside fallback `questions?: PaletteQuestion[]` for backward compatibility.
- For each section, render:
  - Header with section title and tally (`${answeredCount}/${totalCount} answered`).
  - Container with `role="group"` and `aria-label={section.title}`.
  - The grid of 36px squares maintaining keyboard navigation (`COLUMNS = 5`).
- Maintain roving tabindex across all squares in all sections sequentially so arrow keys smoothly cross section boundaries.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test apps/web/test/exam/palette.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/exam/Palette.tsx apps/web/src/components/exam/Runner.tsx apps/web/test/exam/palette.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(exam): group question palette squares under section headers with progress tallies"
```

---

### Task 3: Zero-Cost Client-Cached Demo Exam Runner

**Files:**
- Create: `apps/web/src/lib/demo-test.ts`
- Create: `apps/web/src/lib/demo-client.ts`
- Test: `apps/web/test/exam/demo-client.test.ts`

**Interfaces:**
- Produces:
  - `DEMO_PAPER_FIXTURE: AttemptPaper` containing 3 sections (Logic, Technical, Essay/Fill) covering all 12 question types with `proctoring: "off"`.
  - `createDemoClient(): RunClient` that executes start, answer save, and submit completely in-memory and in `sessionStorage` with zero network requests.
  - Local scoring integration with `@pariksha/core`'s `scoreAttempt`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/test/exam/demo-client.test.ts
import { describe, expect, it } from "vitest";
import { createDemoClient } from "../../src/lib/demo-client";
import { DEMO_PAPER_FIXTURE } from "../../src/lib/demo-test";

describe("Demo Exam Client (Zero Cloudflare Subrequests)", () => {
  it("initializes attempt paper from local fixture with proctoring off", async () => {
    const client = createDemoClient();
    const paper = await client.start("demo-token");
    expect(paper.sections.length).toBeGreaterThanOrEqual(2);
    expect(paper.proctoring.camera).toBe("none");
    expect(paper.proctoring.fullscreen).toBe("none");
  });

  it("saves answers locally in storage without making network fetch", async () => {
    const client = createDemoClient();
    await client.start("demo-token");
    const saveResult = await client.saveAnswer("q1", { selectedId: "opt_1" }, 1);
    expect(saveResult.ok).toBe(true);
    
    // Resume reads saved answers
    const resumed = await client.resume();
    expect(resumed.responses["q1"]).toEqual({ selectedId: "opt_1" });
  });

  it("scores attempt locally using @pariksha/core and returns receipt", async () => {
    const client = createDemoClient();
    await client.start("demo-token");
    await client.saveAnswer("q1", { selectedId: "opt_1" }, 1);
    const receipt = await client.submit("manual");
    expect(receipt.attemptId).toBe(DEMO_PAPER_FIXTURE.attemptId);
    expect(receipt.total).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test apps/web/test/exam/demo-client.test.ts`
Expected: FAIL ("Cannot find module demo-client")

- [ ] **Step 3: Implement `demo-test.ts` and `demo-client.ts`**

- `demo-test.ts`: Define a rich static `AttemptPaper` object with 3 sections:
  1. "Section 1: General Logic" (Multiple Choice, Multiple Response, True/False, Fill in Blank)
  2. "Section 2: Quantitative Aptitude" (Numeric, Assertion & Reason, Matrix Match, Ordering)
  3. "Section 3: Conceptual Analysis" (Short Answer, Extended Text, Comprehension Group)
  All questions configured with `proctoring: { camera: "none", fullscreen: "none", tabSwitch: "none", copyPaste: "none" }`.
- `demo-client.ts`: Implement `RunClient` interface completely client-side:
  - `start()`: returns `DEMO_PAPER_FIXTURE`, loads any persisted session state.
  - `saveAnswer(questionId, value, clientSeq)`: updates in-memory responses and saves to `sessionStorage`.
  - `submit(reason)`: calculates score using `@pariksha/core` and returns `Receipt` with release payload. Zero Cloudflare D1/Worker subrequests.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test apps/web/test/exam/demo-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/demo-test.ts apps/web/src/lib/demo-client.ts apps/web/test/exam/demo-client.test.ts
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(demo): add client-cached demo exam client with local scoring and zero Cloudflare subrequests"
```

---

### Task 4: Public Demo Provisioning API & Seeded Showcase

**Files:**
- Create: `apps/api/src/routes/demo.ts`
- Create: `packages/db/src/repo/demo.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/demo.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/demo/provision`: Rate-limited endpoint (max 5 per IP / hour) that creates an ephemeral demo workspace (`wsp_demo_...`), seeds sample banks, published sample test, and 5 pre-scored attempts (2 clean, 2 review flags, 1 scoring blocked) for full organiser preview.
  - Sets an ephemeral demo session cookie (`session=...`) scoped to the demo workspace.
  - Enforces route budget: <= 12 subrequests via single transactional batch.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/demo.test.ts
import { describe, expect, it } from "vitest";
import { createApp, ROUTE_AUTH, ROUTE_BUDGETS } from "../src/app.js";
import { testDeps } from "./deps.js";

describe("Public Demo Provisioning (POST /api/v1/demo/provision)", () => {
  it("provisions an ephemeral demo workspace with sample data and session cookie", async () => {
    const { deps } = await testDeps();
    const app = createApp(deps);

    const res = await app.request("/api/v1/demo/provision", {
      method: "POST",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.workspace.isDemo).toBe(true);
    expect(body.workspace.slug).toMatch(/^demo-/);
    expect(res.headers.get("set-cookie")).toContain("session=");
  });

  it("enforces route budget ceiling", () => {
    expect(ROUTE_BUDGETS["/api/v1/demo/provision"]).toBeDefined();
    expect(ROUTE_BUDGETS["/api/v1/demo/provision"]).toBeLessThanOrEqual(15);
  });

  it("blocks demo workspaces from creating webhooks or registering BYOK keys", async () => {
    const { deps } = await testDeps();
    const app = createApp(deps);

    const demoRes = await app.request("/api/v1/demo/provision", { method: "POST" });
    const cookie = demoRes.headers.get("set-cookie")!;
    const { workspace } = await demoRes.json();

    // Attempting to register webhook in demo workspace
    const hookRes = await app.request(`/api/v1/workspaces/${workspace.id}/webhooks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://attacker.com/hook", events: ["attempt.submitted"] }),
    });
    expect(hookRes.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/api test apps/api/test/demo.test.ts`
Expected: FAIL ("Cannot find module demo routes")

- [ ] **Step 3: Implement `packages/db/src/repo/demo.ts` and `apps/api/src/routes/demo.ts`**

- In `packages/db`:
  - `seedDemoWorkspace(db, now)`: inserts a workspace with `settings_json: { is_demo: true, expires_at: now + 3600_000 }`.
  - Batch inserts sample question bank, sample published test with 3 sections, and 5 candidate attempt rows with pre-calculated scores and verdicts.
- In `apps/api/src/routes/demo.ts`:
  - IP-based rate limiting (memory/KV/D1 rate check).
  - Call `seedDemoWorkspace`, issue user session with Owner role in that demo workspace.
  - In `guard.ts` or routes: block `POST /webhooks`, email dispatch, and key creation if `workspace.settings.is_demo` is true.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/api test apps/api/test/demo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repo/demo.ts apps/api/src/routes/demo.ts apps/api/src/app.ts apps/api/test/demo.test.ts
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(demo): add demo workspace provisioning API with rate limiting and abuse guards"
```

---

### Task 5: Landing Page "Try Live Demo" Entry & Demo Banner

**Files:**
- Create: `apps/web/src/components/demo/DemoBanner.tsx`
- Modify: `apps/web/src/routes/landing.tsx`
- Modify: `apps/web/src/routes/organiser.tsx`
- Modify: `apps/web/src/routes/exam.tsx`
- Test: `apps/web/test/demo/landing-demo.test.tsx`

**Interfaces:**
- Produces:
  - "Try Live Demo" primary action in landing page hero and navbar.
  - Fast selection modal: "Take Sample Test (Candidate)" vs "Explore Dashboard (Organiser)".
  - `<DemoBanner />` displayed at top of Organiser and Exam in demo mode, stating expiration timer and "Sign Up / Reset" buttons.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/test/demo/landing-demo.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Landing } from "../../src/routes/landing";

describe("Landing Page Demo CTA", () => {
  it("renders 'Try Live Demo' button in hero section", () => {
    render(<Landing />);
    const demoButtons = screen.getAllByRole("button", { name: /try.*demo/i });
    expect(demoButtons.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test apps/web/test/demo/landing-demo.test.tsx`
Expected: FAIL ("Unable to find an element with text /try.*demo/i")

- [ ] **Step 3: Implement Landing Page Demo CTA & DemoBanner**

- Update `apps/web/src/routes/landing.tsx`:
  - Add "Try Live Demo" button beside "Sign in".
  - On click, prompt evaluator:
    - "Take Sample Exam" -> redirects directly to `/exam?demo=true` which uses `createDemoClient()`.
    - "Explore Organiser Dashboard" -> calls `POST /api/v1/demo/provision` and redirects to `/w/:demoWorkspaceSlug`.
- Update `apps/web/src/components/demo/DemoBanner.tsx`:
  - Fixed dismissible top pill: "Demo Workspace (resets in 58m) • No account required".

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test apps/web/test/demo/landing-demo.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/demo/DemoBanner.tsx apps/web/src/routes/landing.tsx apps/web/src/routes/organiser.tsx apps/web/src/routes/exam.tsx apps/web/test/demo/landing-demo.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): add Try Live Demo actions to landing page and persistent demo workspace banner"
```

---

### Task 6: Ephemeral Demo Retention Sweep & Cleanup Job

**Files:**
- Create: `apps/api/src/retention/demo-sweep.ts`
- Modify: `apps/api/src/scheduled.ts`
- Test: `apps/api/test/retention/demo-sweep.test.ts`

**Interfaces:**
- Consumes: `ScheduledJob` from `apps/api/src/scheduled.ts`.
- Produces: `demoCleanupJob: ScheduledJob` that deletes demo workspaces where `expires_at <= now`, cascading delete to tests, attempts, responses, and events in batches of 50.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/retention/demo-sweep.test.ts
import { describe, expect, it } from "vitest";
import { demoCleanupJob } from "../../src/retention/demo-sweep.js";
import { testDeps } from "../deps.js";
import { seedDemoWorkspace } from "@pariksha/db";

describe("Demo Workspace Retention Sweep", () => {
  it("deletes expired demo workspaces and leaves active non-demo workspaces intact", async () => {
    const { deps } = await testDeps({ now: () => 2_000_000 });
    // Seed expired demo workspace (expired at 1_000_000)
    const expired = await seedDemoWorkspace(deps.db, 500_000);
    // Seed active non-demo workspace
    const activeNonDemo = "wsp_real_1";
    await deps.db.run("INSERT INTO workspace (id, slug, name, created_at) VALUES (?, ?, ?, ?)", [
      activeNonDemo, "real", "Production Team", 1_000_000,
    ]);

    const result = await demoCleanupJob.run(deps);
    expect(result.deletedWorkspaces).toBeGreaterThanOrEqual(1);

    const remainingDemo = await deps.db.query("SELECT * FROM workspace WHERE id = ?", [expired.id]);
    expect(remainingDemo).toHaveLength(0);

    const remainingReal = await deps.db.query("SELECT * FROM workspace WHERE id = ?", [activeNonDemo]);
    expect(remainingReal).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/api test apps/api/test/retention/demo-sweep.test.ts`
Expected: FAIL ("Cannot find module demo-sweep")

- [ ] **Step 3: Implement `demo-sweep.ts` and register in `scheduled.ts`**

- `apps/api/src/retention/demo-sweep.ts`:
  - Query workspaces where `settings_json` contains `"is_demo": true` and `expires_at <= now`.
  - Batch delete associated records in `attempt`, `response`, `event`, `question`, `test`, `workspace`.
  - Bound subrequests to 10 per execution cycle.
- In `apps/api/src/scheduled.ts`: register `demoCleanupJob` into `SCHEDULED_JOBS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/api test apps/api/test/retention/demo-sweep.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/retention/demo-sweep.ts apps/api/src/scheduled.ts apps/api/test/retention/demo-sweep.test.ts
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(retention): add demo workspace sweep job to scheduled cron triggers"
```

---

### Task 7: Full Monorepo Verification & E2E Acceptance

**Files:**
- Create: `apps/web/e2e/demo-flow.spec.ts`
- Test: Full monorepo verification (`turbo run test`, `turbo run lint`, `turbo run typecheck`, Worker integration tests).

- [ ] **Step 1: Write E2E Playwright test for demo flow & section navigation**

```ts
// apps/web/e2e/demo-flow.spec.ts
import { test, expect } from "@playwright/test";

test("Evaluator clicks Try Live Demo, switches sections, and submits exam", async ({ page }) => {
  await page.goto("/");
  await page.click("button:has-text('Try Live Demo')");
  await page.click("button:has-text('Take Sample Exam')");

  // Verify section header is visible
  await expect(page.locator(".exam-section-nav")).toBeVisible();
  await expect(page.locator(".exam-section-nav")).toContainText("Section 1");

  // Verify palette groups questions by section
  await expect(page.locator(".palette-section-group").first()).toBeVisible();

  // Answer question in Section 1
  await page.click(".exam-option >> nth=0");

  // Switch to Section 2
  await page.click("button[role='tab']:has-text('Section 2')");
  await expect(page.locator(".exam-section-nav")).toContainText("Section 2");

  // Submit test
  await page.click("button:has-text('Finish')");
  await page.click("button:has-text('Confirm Submit')");

  // Verify receipt page
  await expect(page.locator(".exam-receipt")).toBeVisible();
});
```

- [ ] **Step 2: Run monorepo typecheck, lint, and test suites**

```bash
npx turbo run lint
npx turbo run typecheck
npx turbo run test --force --concurrency=1
cd apps/api && npx vitest run -c vitest.workers.config.ts
```
Expected: All suites exit 0.

- [ ] **Step 3: Commit E2E and verification updates**

```bash
git add apps/web/e2e/demo-flow.spec.ts
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "test(e2e): add end-to-end acceptance test for demo flow and section navigation"
```
