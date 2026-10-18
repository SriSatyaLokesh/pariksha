# Phase 4 — Question Banks and Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an Author somewhere to write. Banks with a browser that survives a few hundred questions, an editor for each of the 12 types built on one five-block skeleton, Markdown with LaTeX and code rendered by the one shared renderer the preview and the candidate runtime both import, passage groups, and import and export that round-trip `pariksha/bank@1` without loss — Pariksha JSON for every type, CSV and Moodle GIFT for the five the PRD scopes, all-or-nothing with positioned errors.

**Architecture:** Three seams, and the discipline is in what each one refuses to do. **`@pariksha/core` already owns the import rules** — `validateBank` implements every line of question-format.md's "Rules checked on import" and this phase calls it rather than re-deriving it; the CSV and GIFT importers are *converters into `pariksha/bank@1`*, not validators. **The renderer is one shared module** ([ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md)): the API stores Markdown and nothing but Markdown, `apps/web/src/render/markdown.ts` turns it into HTML in whichever browser is displaying it, and KaTeX arrives through a dynamic `import()` only when the content actually contains LaTeX. No HTML is stored, so there is no sanitiser and nothing to keep in step with the source. **The API speaks `pariksha/question@1`** — routes take and return format documents, and `packages/db/src/repo/banks.ts` is the one place a document becomes a row, which is what makes export a mapping rather than a serialiser.

**Tech Stack:** `markdown-it` 14 (`html: false`) in the initial chunk, `katex` 0.16 with `output: "mathml"` via `@vscode/markdown-it-katex` behind a dynamic `import()`, `@cfworker/json-schema` for runtime schema validation on Workers (Ajv compiles with `new Function`, which Workers forbid), plus what Phases 2 and 3 already brought: Hono 4, Drizzle, React 19, Vite, TanStack Router, Vitest, Testing Library, `jest-axe`.

**Spec:** [`docs/design.md`](../../design.md) — the binding interaction design; `UX-01`–`UX-09` and `UX-19`–`UX-21`, screen inventory rows 1–5 · [`docs/PRD.md`](../../PRD.md#data-model-question-format-and-api) `D-01`, `D-02`, `AC-05`, `AC-06`, `AC-07`, the non-functional table · [`docs/question-format.md`](../../question-format.md) · [`schemas/question-1.json`](../../../schemas/question-1.json), [`schemas/bank-1.json`](../../../schemas/bank-1.json) · [`docs/ROADMAP.md`](../../ROADMAP.md#phase-4--question-banks-and-authoring) · [ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md)

## Precondition

**Phase 3's API is complete before this phase starts.** Every API task here consumes Phase 3 Task 5's `requires(action)` guard and `appendAudit` (issue [#29](https://github.com/SriSatyaLokesh/pariksha/issues/29)) and Phase 3 Task 1's `can()` from `@pariksha/core` (issue [#25](https://github.com/SriSatyaLokesh/pariksha/issues/25)), and every web task consumes Phase 3 Task 9's `apps/web/src/lib/api.ts` and the admin router. The action every route in this phase guards is `banks.edit`. Do not plan around their absence and do not re-implement them; they appear in `Consumes:` by name.

## Global Constraints

- Everything from Phases 1–3 still holds: Node 22, pnpm, strict TypeScript, DCO sign-off on every commit, epoch-millisecond timestamps everywhere, one error envelope `{ "error": { "code", "message", "details"? } }`, 404-not-403 across workspaces.
- `tsconfig.base.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `erasableSyntaxOnly`. **`erasableSyntaxOnly` bans TypeScript parameter properties** — a constructor writes its own fields.
- **Workers limits: 50 subrequests and 10 ms CPU per invocation.** `apps/api/src/instrument.ts` enforces a per-route budget and `apps/api/test/budget.test.ts` asserts that `ROUTE_BUDGETS` in `apps/api/src/app.ts` names every mounted route. **Every route this phase adds adds a line to `ROUTE_BUDGETS` or the suite fails.** A bulk import of 200 questions is not 200 writes.
- Every table holding tenant data carries `workspace_id`; every repository function takes it first and goes through `scoped()` in `packages/db/src/repo/guard.ts`, which registers it in `REPO_FUNCTIONS` for the isolation suite to enumerate.
- **No hex colour literal in `apps/web/src`** outside the two generated token files — `apps/web/test/no-hex-colors.test.ts` also catches `rgb()`, `hsl()`, `oklch()` and the named colours. Every value comes from `DESIGN.md` through `tokens.css` / `tokens.ts`. This is why no third-party stylesheet is vendored into `src/`.
- **No third-party browser request** (`S-11`), CSP `default-src 'self'`. Anything a renderer needs is self-hosted, fonts included. Authored images are proxied by the API, never redirected to a storage origin.
- **The candidate's budget is 300 KB gzipped** (PRD non-functional table), and this phase spends 41 KB of it on `markdown-it`. KaTeX's further 76 KB is lazy and must stay lazy: no initial chunk may contain `katex` ([ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md)).
- Accessibility is a requirement, not a later pass (`O-04`, WCAG 2.1 AA): keyboard reachable, labelled, visible focus, and a `jest-axe` assertion per screen.
- **Reordering is buttons-first, and buttons-only in this phase.** Move-up / move-down controls and a numeric position field are the control on option rows (`UX-07`), `ordering` items (`UX-08`) and matching columns. Drag-only reordering fails WCAG 2.1.1, so the buttons are what has to exist; pointer drag is a deferred enhancement and ships in no task here (see "Known deferrals"), which is why `AC-07` is only partly met. **No drag-and-drop dependency, and no drag.**
- **`@pariksha/core`'s `validateBank` is the import rules.** No task writes a second copy of them. `packages/core` stays a pure leaf package with no runtime dependencies; the only thing this phase adds to it is plain data.
- **Everything is testable locally** — in-memory SQLite, the in-memory storage adapter, jsdom. No task may require a deployed Worker or a Cloudflare credential. Cloudflare deployment is issue [#23](https://github.com/SriSatyaLokesh/pariksha/issues/23) and is out of scope.

## Review Focus

1. **KaTeX drifting into the initial chunk.** The entire budget case for [ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md) is that KaTeX's 76 KB gzipped is paid only by content that actually contains LaTeX. One static `import` of it — a convenience re-export from the renderer's module, a preview component that imports the plugin only to type a prop, a test helper that leaks into `src/` — moves it into the initial chunk, and **nothing fails**. Every rendering test still passes, every formula still renders, and every candidate quietly pays 76 KB on every exam, on a 300 KB budget that Phases 6 and 7 have not drawn on yet. It is invisible until someone measures a production bundle. The structural answer is that `katex` and `@vscode/markdown-it-katex` are named in exactly one `await import()`, inside `apps/web/src/render/markdown.ts`, and that Task 1's bundle test walks the *static* import graph of every entry and asserts `katex` is not in it. — Task 1, and re-run by every later task that touches the renderer.
2. **Orphaned type-specific fields surviving a type change.** `UX-06` keeps the prompt and drops the answer block when the type changes. If `toQuestionRow` merges into `extra_json` instead of replacing it, a question that went `select_k` → `single` keeps `k: 3`. Nothing catches it: `schemas/question-1.json` has no top-level `additionalProperties: false`, so the stale field passes the schema, passes `validateBank`, and exports cleanly. It surfaces months later when someone switches the type back and the editor shows `k = 3` against a two-entry key, or when another installation's importer is stricter. — Task 3, caught by Task 9's round-trip.
3. **An import that issues one write per question.** It passes every test at ten questions and fails in production at sixty, because the 50-subrequest ceiling is per invocation and nothing warns before it is hit. D1 also caps bound parameters per statement, so "one big INSERT" is not the fix either — `DbClient` gains a `batch()` that is one subrequest on D1, one transaction elsewhere, and `ROUTE_BUDGETS` pins the import route at a constant that does not move with the file's size. — Task 7.
4. **A second copy of the import rules inside the CSV and GIFT converters, and the positions getting lost on the way out.** Both halves come from the same seam. A converter that builds questions field by field invites checking as it goes — and that copy will drift from `validateBank`, so the same defect reports differently depending on which file format it arrived in. Converting to `pariksha/bank@1` and handing the whole document to `validateBank` fixes that and creates the other half: `ImportIssue.index` is an index into `bank.questions`, which is not CSV row 14 and not GIFT line 73. `AC-05` asks for "the line and reason", so the converter must return a position map alongside the document and the route must translate every issue through it — including the header row offset, which is the off-by-one that will be there. — Tasks 7 and 8.
5. **Focus lost after a move-up / move-down.** The button moves the DOM node, React re-keys the list, and focus falls back to `document.body`. A keyboard user reorders one row and then has to tab back through the whole list to reach the next one — reordering five options becomes unusable while every unit test passes and `jest-axe` reports nothing, because it is a focus-management defect, not a markup defect. The moved row's button must be focused after the move and the new position announced in a live region. — Task 3.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/src/schema/columns.ts` | Modified: the Phase 4 columns on `question_bank` and `question`, and the `real` column class |
| `packages/db/migrations/{sqlite,pg}/0001_*.sql` | The Phase 4 schema delta, generated for both dialects |
| `packages/db/src/client.ts` | Modified: `batch()` — one subrequest on D1, one transaction on SQLite and Postgres |
| `packages/db/src/repo/banks.ts` | Bank and question reads and writes, and `toQuestionDocument` / `toQuestionRow` — the one place a format document becomes a row |
| `apps/api/src/routes/banks.ts` | `/banks`, `/banks/:bankId`, `/banks/:bankId/groups`, `/banks/:bankId/media`, `/tags` |
| `apps/api/src/routes/questions.ts` | `/banks/:bankId/questions*` |
| `apps/api/src/routes/media.ts` | `GET /media/:key` — proxies bytes from `StorageAdapter`, never redirects |
| `apps/api/src/import/schema.ts` | `@cfworker/json-schema` compiled against `schemas/*.json`, as structural issues |
| `apps/api/src/import/json.ts` | `pariksha/bank@1` import: schema, then `validateBank`, then one batch |
| `apps/api/src/import/csv.ts` | CSV → `pariksha/bank@1` + a position map |
| `apps/api/src/import/gift.ts` | Moodle GIFT → `pariksha/bank@1` + a position map |
| `apps/api/src/import/rows.ts` | RFC 4180 reader: quotes, embedded newlines, CRLF, BOM |
| `apps/api/src/export/bank.ts` | Rows → `pariksha/bank@1` and `pariksha/question@1` documents |
| `apps/web/src/render/markdown.ts` | `hasLatex` and `renderMarkdown` — the one shared renderer. markdown-it eagerly, KaTeX behind `await import()` |
| `apps/web/src/components/authoring/RenderedHtml.tsx` | The one `dangerouslySetInnerHTML` site in the application — and it only ever receives output `renderMarkdown` just produced |
| `apps/web/src/components/authoring/PromptEditor.tsx` | `UX-19`–`UX-21`: textarea, toolbar, `{{id}}` placeholders, image upload hook |
| `apps/web/src/components/authoring/PreviewPane.tsx` | `UX-09`: candidate view with an "as the reviewer sees it" toggle |
| `apps/web/src/components/authoring/ReorderableList.tsx` | Buttons-first reordering with focus management and a live region |
| `apps/web/src/components/authoring/TypePicker.tsx` | `UX-06`, `UX-07`: 12 cards grouped choice · match · written |
| `apps/web/src/components/authoring/QuestionEditor.tsx` | The five-block skeleton every type shares, and the type-change confirmation |
| `apps/web/src/components/authoring/answer/Choice.tsx` | `single`, `multiple`, `select_k`, `true_false`, `assertion_reason` |
| `apps/web/src/components/authoring/answer/Structured.tsx` | `matching`, `multi_matching`, `ordering` |
| `apps/web/src/components/authoring/answer/Written.tsx` | `fill_blank`, `numeric`, `short_answer`, `long_answer` |
| `apps/web/src/components/authoring/ScoringRow.tsx` | Points, mode (filtered by `APPLICABLE_MODES`), negative fraction |
| `apps/web/src/components/authoring/ImportDialog.tsx` | Screen 5: format choice, dry run, the positioned error report |
| `apps/web/src/routes/banks.tsx` | Screen 1 — bank list (`UX-02`) |
| `apps/web/src/routes/bank.tsx` | Screen 2 — bank browser: table, left-rail filters, bulk select (`UX-03`–`UX-05`) |
| `apps/web/src/routes/question.tsx` | Screens 3 and 4 — type picker and editor with preview |
| `apps/web/src/styles/authoring.css` | Rendered-content and editor styling, every value from tokens |

---

## Task 1: The shared renderer and the Phase 4 schema delta (#49, P4.5)

**Files:**
- Create: `apps/web/src/render/markdown.ts`, `apps/web/src/components/authoring/RenderedHtml.tsx`, `apps/web/src/components/authoring/PromptEditor.tsx`, `apps/web/src/components/authoring/PreviewPane.tsx`, `apps/web/src/styles/authoring.css`
- Create: `apps/web/test/authoring/render.test.tsx`, `apps/web/test/fixtures/every-construct.md`
- Modify: `packages/db/src/schema/columns.ts`, `packages/db/src/schema/sqlite.ts`, `packages/db/src/schema/pg.ts`, `packages/db/test/parity.test.ts`, `apps/web/test/bundle.test.ts`, `apps/web/package.json`
- Generated: `packages/db/migrations/sqlite/0001_*.sql`, `packages/db/migrations/pg/0001_*.sql`, `packages/db/src/migrations.generated.ts`

**Interfaces:**
- Consumes: `TABLE_MANIFEST`, `ColumnClass` (`packages/db/src/schema/columns.ts`).
- Produces:
  ```ts
  // apps/web/src/render/markdown.ts — the one renderer. The admin preview imports
  // it today and Phase 6's exam runtime imports it next; admin.html, index.html and
  // the island are already Rollup inputs of this same Vite application
  // (apps/web/vite.config.ts), so "shared" is an import and not a package.
  export function hasLatex(source: string): boolean;          // the dynamic-import trigger
  export function renderMarkdown(source: string): Promise<string>;

  // apps/web/src/components/authoring/*
  /** The one dangerouslySetInnerHTML site. Takes Markdown, not HTML, so no call
      site can hand it a string the renderer did not just produce. */
  export function RenderedHtml(props: { markdown: string; className?: string }): JSX.Element;
  export function PromptEditor(props: {
    value: string;
    onChange: (next: string) => void;
    onUploadImage?: (file: File) => Promise<{ src: string; alt: string }>;
    label: string;
  }): JSX.Element;
  export function PreviewPane(props: { question: Question; reveal: boolean; onRevealChange: (next: boolean) => void }): JSX.Element;
  ```

[ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md) **is** this task, and `UX-09` — the preview "is the same renderer the candidate runtime uses" — is what it implements, now literally rather than approximately: `PreviewPane` calls `renderMarkdown`, and so will Phase 6's exam runtime, because there is only one.

`markdown-it` is a static import configured `{ html: false, linkify: false, typographer: false }` — 41 KB gzipped in the initial chunk, paid by everything. `hasLatex(source)` gates everything else: when and only when it is true, `renderMarkdown` does `await import("katex")` and `@vscode/markdown-it-katex` and renders through a second, memoised `markdown-it` instance carrying the plugin at `{ output: "mathml", trust: false, throwOnError: false }` — a broken formula renders as its red source, which is exactly what `UX-20` wants the author to see. `hasLatex` is deliberately conservative: a false negative shows `$x^2$` as literal text, which the author sees in the preview immediately; a false positive costs 76 KB on one question, which nobody sees.

There is no sanitiser, no allowlist and no stored HTML. `html: false` escapes raw HTML to text, so the only HTML in play is HTML `renderMarkdown` produced in the same tick for the page that is about to show it.

The schema delta lands here because every later task needs it first. ADR 0004 is why it is three columns shorter than it looks: `prompt_html`, `explanation_html` and `render_version` are not added, because nothing is stored but Markdown. **Columns Phase 4 adds** — everything else `question_bank` and `question` need already exists from Phase 2:

| Table | Column | Class | Why |
| --- | --- | --- | --- |
| `question_bank` | `description` | text, null | `pariksha/bank@1` field; export round-trip |
| `question_bank` | `license` | text, null | `pariksha/bank@1` field; export round-trip |
| `question_bank` | `groups_json` | json, null | Passage groups (Task 6). A bank holds a handful; a table would be three CRUD surfaces for a list that is always read whole |
| `question_bank` | `updated_at` | timestamp | `UX-04`'s "last edited" column |
| `question` | `ref_id` | text | The question's `id` **inside the bank file** (`^[A-Za-z0-9_.-]{1,64}$`). The row's `id` is `qst_…` and is not what a file carries. Unique on `(bank_id, ref_id)` |
| `question` | `group_ref` | text, null | The format's `group` field |
| `question` | `extra_json` | json, null | Every type-specific field with no column of its own: `k`, `left`, `right`, `items`, `blanks`, `unit`, `assertion`, `reason`, `max_length`, `model_answer`, `rubric`, `shuffle_options`. Eleven columns that are null for most types, or one |
| `question` | `updated_at` | timestamp | `UX-04` |

Two Phase 2 corrections ride along: a `real` `ColumnClass` (SQLite `real`, Postgres `double precision`) because `schemas/question-1.json` gives `scoring.points` `"type": "number"` and the existing `int("points")` would round `0.5` to `0`; and the unique `(bank_id, ref_id)`.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/test/authoring/render.test.tsx
let katexLoads = 0;
vi.mock("katex", async (orig) => { katexLoads += 1; return await orig<object>(); });

it("UX-20: $x^2$ becomes MathML, not KaTeX HTML, and loads no stylesheet", async () => {
  const html = await renderMarkdown("Area is $x^2$.");
  expect(html).toContain("<math");
  expect(html).not.toContain("katex-html");
  expect(html).not.toMatch(/<link|katex\.css/);
});

it("raw HTML in a prompt is escaped text, never an element", async () => {
  expect(await renderMarkdown("<script>alert(1)</script>")).toContain("&lt;script&gt;");
});

it.each([
  ["Area is $x^2$.", true],
  ["$$\\int_0^1 x\\,dx$$", true],
  ["Costs $5 and $7, total $12.", false],       // conservative, but a false positive is only 76 KB
  ["```sql\nSELECT 1\n```", false],
  ["No maths here at all.", false],
])("hasLatex(%j) is %s", (src, expected) => expect(hasLatex(src)).toBe(expected));

// THE LOAD-BEARING ASSERTION. If this ever goes green by accident the ADR's
// budget case is gone and nothing else in the suite will say so.
it("a bank with no maths never loads KaTeX", async () => {
  katexLoads = 0;
  const bank = JSON.parse(readFileSync("../../examples/reasoning-aptitude/questions.json", "utf8"));
  for (const q of bank.questions) {
    expect(hasLatex(q.prompt), q.id).toBe(false);
    await renderMarkdown(q.prompt);
    if (q.explanation) await renderMarkdown(q.explanation);
  }
  expect(katexLoads).toBe(0);
});

it("a question that does contain maths loads KaTeX exactly once, however many times it renders", async () => {
  katexLoads = 0;
  await renderMarkdown("$a$"); await renderMarkdown("$b$"); await renderMarkdown("$c$");
  expect(katexLoads).toBe(1);
});

it("UX-09: the preview shows the candidate's view, and the toggle reveals key and explanation", async () => {
  render(<PreviewPane question={singleFixture} reveal={false} onRevealChange={noop} />);
  expect(screen.queryByText(/correct answer/i)).toBeNull();
  await userEvent.click(screen.getByRole("switch", { name: /as the reviewer sees it/i }));
  // re-rendered with reveal=true by the harness
  expect(await screen.findByText(/correct answer/i)).toBeVisible();
});

it("UX-20: an image cannot be inserted without alt text", async () => {
  render(<PromptEditor value="" onChange={noop} onUploadImage={uploadStub} label="Prompt" />);
  await userEvent.click(screen.getByRole("button", { name: /image/i }));
  await userEvent.upload(screen.getByLabelText(/image file/i), pngFile);
  expect(screen.getByRole("button", { name: /insert/i })).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/alt text/i), "A bar chart of loans");
  expect(screen.getByRole("button", { name: /insert/i })).toBeEnabled();
});

it("the editor and preview have no axe violations", async () => {
  expect(await axe(container)).toHaveNoViolations();
});
```

```ts
// apps/web/test/bundle.test.ts (extended)
// Review Focus 1. buildChunks() and twoEntryChunks already exist in this file;
// the only new machinery is walking `imports` (static) WITHOUT `dynamicImports`,
// which is exactly the distinction the ADR rests on. Add `dynamicImports?: string[]`
// to BuildOutputChunk.
function staticModules(chunks: BuildOutputChunk[], entryName: string): string[] {
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const entry = chunks.find((c) => c.isEntry && c.name === entryName);
  expect(entry, entryName).toBeDefined();
  const seen = new Set<string>();
  const queue = [entry!.fileName];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of byFile.get(file)?.imports ?? []) queue.push(next);  // static edges only
  }
  return [...seen].flatMap((f) => Object.keys(byFile.get(f)?.modules ?? {}));
}

it("markdown-it is in the initial chunk and KaTeX is not (ADR 0004)", () => {
  for (const entry of ["admin", "island"]) {
    const modules = staticModules(twoEntryChunks, entry).join("\n");
    for (const lazy of ["katex", "@vscode/markdown-it-katex"]) {
      expect(modules, `${lazy} statically reachable from ${entry}`).not.toContain(lazy);
    }
  }
});

it("KaTeX exists in the build, in a chunk no entry statically reaches", () => {
  const katexChunks = twoEntryChunks.filter((c) =>
    Object.keys(c.modules ?? {}).some((m) => m.includes("katex")));
  expect(katexChunks.length).toBeGreaterThan(0);          // it is bundled, not dropped
  expect(katexChunks.every((c) => !c.isEntry)).toBe(true); // and it is its own chunk
});
```

```ts
// packages/db/test/parity.test.ts (extended)
it("the Phase 4 columns exist in both dialects", () => {
  expect(columnNames(sqliteSchema.question)).toEqual(expect.arrayContaining(
    ["ref_id", "group_ref", "extra_json", "updated_at"]));
  expect(columnSpec(sqliteSchema.question)).toEqual(columnSpec(pgSchema.question));
});

it("no HTML is stored: question has no rendered-content columns (ADR 0004)", () => {
  for (const col of ["prompt_html", "explanation_html", "render_version"]) {
    expect(columnNames(sqliteSchema.question), col).not.toContain(col);
    expect(columnNames(pgSchema.question), col).not.toContain(col);
  }
});

it("points is a real, not an integer, in both dialects", () => {
  expect(sqlType(sqliteSchema, "question.points")).toBe("real");
  expect(sqlType(pgSchema, "question.points")).toBe("double precision");
});

it("a bank cannot hold two questions with the same ref_id", async () => {
  await expect(insertQuestionRow(db, { bankId: b, refId: "SQL-09" })).resolves.toBeDefined();
  await expect(insertQuestionRow(db, { bankId: b, refId: "SQL-09" })).rejects.toThrow(/unique|constraint/i);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db/test/parity.test.ts apps/web/test/authoring apps/web/test/bundle.test.ts`
Expected: FAIL — `markdown.ts` and the columns do not exist.

- [ ] **Step 3: Implement the renderer and the migration**

`markdown.ts` holds two module-level singletons: the plain `markdown-it` instance, built once at module scope, and a `Promise<MarkdownIt>` for the KaTeX-carrying one, created on first need and reused, so the dynamic import resolves once per page however many formulas it renders. `RenderedHtml` takes Markdown and awaits `renderMarkdown` in an effect — one place does the awaiting, which is what stops each call site inventing its own loading state and, more usefully, means no call site can pass it a string the renderer did not produce. Add the Phase 4 columns to `TABLE_MANIFEST` and to both dialect files, then generate the migration for each with `drizzle-kit` and re-run `pnpm --filter @pariksha/db migrations` to refresh the bundle.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/web/test/authoring apps/web/test/bundle.test.ts` and `pnpm --filter @pariksha/db test` with `TEST_POSTGRES_URL` set.
Expected: PASS on both dialects, with `katex` in no entry's static graph.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/web
git commit -s -m "feat(authoring): one shared markdown renderer with katex behind a dynamic import"
```

---

## Task 2: Bank CRUD, question CRUD and the bank browser (#45, P4.1)

**Files:**
- Create: `packages/db/src/repo/banks.ts`, `packages/db/test/repo/banks.test.ts`
- Create: `apps/api/src/routes/banks.ts`, `apps/api/src/routes/questions.ts`, `apps/api/src/routes/media.ts`
- Create: `apps/api/test/banks.test.ts`, `apps/api/test/media.test.ts`
- Create: `apps/web/src/routes/banks.tsx`, `apps/web/src/routes/bank.tsx`
- Create: `apps/web/test/authoring/bank-browser.test.tsx`
- Modify: `packages/db/src/repo/index.ts`, `apps/api/src/app.ts` (mount routes, extend `ROUTE_BUDGETS` and `ROUTE_ACTIONS`)

**Interfaces:**
- Consumes: `scoped`, `newId`, `DbClient`, `StorageAdapter`, `requires("banks.edit")`, `appendAudit`, `can`, `Question`, `Bank`, `PromptEditor`.
- Produces:
  ```ts
  // packages/db/src/repo/banks.ts — every function scoped(), workspaceId first
  export interface BankRow { id: string; name: string; description: string | null; license: string | null; tags: string[]; questionCount: number; createdAt: number; updatedAt: number }
  export interface QuestionRow { id: string; bankId: string; refId: string; document: Question; points: number; usedInTests: number; updatedAt: number }

  export const createBank: ScopedFn<[{ name: string; now?: number }], string>;
  export const getBank: ScopedFn<[bankId: string], BankRow | null>;
  export const listBanks: ScopedFn<[], BankRow[]>;
  export const updateBank: ScopedFn<[bankId: string, patch: { name?: string; description?: string; license?: string; tags?: string[] }], boolean>;
  export const deleteBank: ScopedFn<[bankId: string], { deleted: boolean; blockedBy: string[] }>;
  export const listQuestions: ScopedFn<[bankId: string, filter: QuestionFilter], { rows: QuestionRow[]; cursor?: string }>;
  export const getQuestion: ScopedFn<[bankId: string, questionId: string], QuestionRow | null>;
  /** Writes the Markdown document. There is no second representation to keep in step (ADR 0004). */
  export const upsertQuestion: ScopedFn<[bankId: string, doc: Question, now: number], { id: string; created: boolean }>;
  export const upsertQuestions: ScopedFn<[bankId: string, docs: readonly Question[], now: number], { ids: string[] }>;
  export const deleteQuestion: ScopedFn<[bankId: string, questionId: string], { deleted: boolean; blockedBy: string[] }>;
  export const listWorkspaceTags: ScopedFn<[], string[]>;
  export function toQuestionDocument(row: QuestionRecord): Question;
  export function toQuestionRow(doc: Question): QuestionRecord;

  export interface QuestionFilter { type?: QuestionType; tag?: string; difficulty?: Difficulty; unused?: boolean; search?: string; cursor?: string; limit?: number }
  ```

Routes, each with a `ROUTE_BUDGETS` line and `ROUTE_ACTIONS` entry mapping to `banks.edit`:

| Route | Budget |
| --- | --- |
| `GET /api/v1/banks`, `GET /api/v1/banks/:bankId`, `GET /api/v1/tags` | 1 |
| `POST /api/v1/banks`, `PATCH /api/v1/banks/:bankId` | 2 |
| `DELETE /api/v1/banks/:bankId`, `DELETE /api/v1/banks/:bankId/questions/:qid` | 3 |
| `GET /api/v1/banks/:bankId/questions`, `GET /api/v1/banks/:bankId/questions/:qid` | 1 |
| `POST /api/v1/banks/:bankId/questions`, `PATCH /api/v1/banks/:bankId/questions/:qid` | 2 |
| `POST /api/v1/banks/:bankId/media` | 2 |
| `GET /api/v1/media/:key` | 1 |

`toQuestionRow` **replaces** `extra_json` wholesale from the incoming document — never merges — which is Review Focus item 2. `GET /api/v1/media/:key` reads the object through `StorageAdapter.get` and returns the bytes with `Cache-Control: public, max-age=31536000, immutable`; it does not redirect, because a redirect to a storage origin is a third-party browser request and `default-src 'self'` blocks it. Keys are content-addressed, `media/<workspaceId>/<sha256>.<ext>`, so the immutable cache is honest and a re-uploaded image costs nothing.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/repo/banks.test.ts
it("upsertQuestion stores the Markdown document and nothing derived from it", async () => {
  const { id } = await upsertQuestion(db, ws, bank, singleFixture, T);
  const row = await getQuestion(db, ws, bank, id);
  expect(row!.document).toEqual(singleFixture);
  expect(Object.keys(row!)).not.toContain("promptHtml");
});

it("a question document survives the round trip through the row shape, for all 12 types", () => {
  for (const q of exampleBank.questions) expect(toQuestionDocument(toQuestionRow(q))).toEqual(q);
});

it("toQuestionRow replaces extra_json rather than merging it", () => {
  const asSelectK = { ...base, type: "select_k", k: 3, options, key: ["a", "b", "c"] } as Question;
  const asSingle = { ...base, type: "single", options, key: "a" } as Question;
  expect(toQuestionRow(asSingle).extra_json).not.toHaveProperty("k");
});

it("UX-05: deleting a question a published version references is refused and names the tests", async () => {
  expect(await deleteQuestion(db, ws, bank, questionId)).toEqual({ deleted: false, blockedBy: ["Midterm"] });
});

it("S-09: a bank in another workspace is not found", async () => {
  expect(await getBank(db, wsA, bankInB)).toBeNull();
});
```

```ts
// apps/api/test/banks.test.ts
it("POST /banks takes a name and nothing else (UX-02)", async () => {
  const res = await app.request("/api/v1/banks", post({ name: "SQL basics" }, asAuthor));
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ id: expect.stringMatching(/^bnk_/), name: "SQL basics" });
});

it("a cross-workspace bank is 404, not 403", async () => {
  expect((await app.request(`/api/v1/banks/${bankInB}`, asAuthor)).status).toBe(404);
});

it("a Viewer cannot write a bank", async () => {
  expect((await app.request("/api/v1/banks", post({ name: "x" }, asViewer))).status).toBe(403);
});

it("GET /media/:key returns the bytes itself and never a redirect to storage", async () => {
  const res = await app.request(`/api/v1/media/${key}`, asAuthor);
  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("cache-control")).toContain("immutable");
});

it("media uploaded twice gets one content-addressed key", async () => {
  expect((await upload(png)).key).toBe((await upload(png)).key);
});

it("every route this task mounts has a ROUTE_BUDGETS entry under the ceiling", () => {
  for (const r of mountedRoutes(app).filter((r) => r.includes("bank") || r.includes("media"))) {
    expect(ROUTE_BUDGETS[r], r).toBeLessThan(SUBREQUEST_LIMIT);
  }
});
```

```tsx
// apps/web/test/authoring/bank-browser.test.tsx
it("UX-04: the browser is a table with prompt, type, difficulty, tags, points, last edited and used-in", () => {
  render(<BankBrowser bankId="bnk_1" />);
  for (const h of ["Prompt", "Type", "Difficulty", "Tags", "Points", "Last edited", "Used in"]) {
    expect(screen.getByRole("columnheader", { name: new RegExp(h, "i") })).toBeVisible();
  }
});

it("UX-03: a tag with a slash renders as a breadcrumb chip and groups the left rail", async () => {
  expect(within(screen.getByRole("navigation", { name: /filters/i })).getByText("sdlc")).toBeVisible();
  expect(screen.getByRole("button", { name: "sdlc / agile" })).toBeVisible();
});

it("UX-04: rows select with a checkbox and the bulk bar reports the count", async () => {
  await userEvent.click(screen.getAllByRole("checkbox", { name: /select question/i })[0]!);
  expect(screen.getByText(/1 selected/)).toBeVisible();
});

it("UX-05: a refused delete names the tests holding the question", async () => {
  await userEvent.click(screen.getByRole("button", { name: /delete/i }));
  expect(await screen.findByText(/Midterm/)).toBeVisible();
});

it("the bank list and the browser have no axe violations", async () => {
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db/test/repo/banks.test.ts apps/api/test/banks.test.ts apps/web/test/authoring/bank-browser.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the repository, the routes and the two screens**

Follow `packages/db/src/repo/tests.ts` exactly: raw SQL through `db.query` / `db.run`, JSON through `db.jsonParam`, every export wrapped in `scoped()`. `listQuestions` resolves its filters in SQL with one query — `usedInTests` comes from a join against `test_version`, not a query per row. `listWorkspaceTags` selects `tags_json` for the workspace and unions in memory; note in a comment that a `workspace_tag` table is the upgrade path if it ever gets slow. The left rail, the table and the bulk bar come from `DESIGN.md` through the tokens; no colour literal appears in `authoring.css`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`
Expected: PASS, including the Phase 2 budget and isolation suites with their new entries.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/api apps/web
git commit -s -m "feat(banks): bank and question CRUD with the bank browser and media proxy"
```

---

## Task 3: Question editors — the choice family (#46, P4.2)

**Files:**
- Create: `apps/web/src/components/authoring/TypePicker.tsx`, `QuestionEditor.tsx`, `ScoringRow.tsx`, `ReorderableList.tsx`, `answer/Choice.tsx`
- Create: `apps/web/src/routes/question.tsx`
- Create: `apps/web/test/authoring/reorder.test.tsx`, `apps/web/test/authoring/choice-editor.test.tsx`
- Modify: `apps/web/src/styles/authoring.css`

**Interfaces:**
- Consumes: `PromptEditor`, `PreviewPane`, `RenderedHtml`, `APPLICABLE_MODES`, `QUESTION_TYPES`, `Question`, `apps/web/src/lib/api.ts`.
- Produces:
  ```ts
  export function ReorderableList<T>(props: {
    items: readonly T[];
    keyOf: (item: T) => string;
    labelOf: (item: T) => string;
    onReorder: (from: number, to: number) => void;
    renderItem: (item: T, index: number) => JSX.Element;
    legend: string;
  }): JSX.Element;
  export function TypePicker(props: { value?: QuestionType; onPick: (t: QuestionType) => void }): JSX.Element;
  export function QuestionEditor(props: { bankId: string; initial?: Question; onSaved: (q: Question) => void }): JSX.Element;
  export function ScoringRow(props: { type: QuestionType; value: ScoringConfig; onChange: (next: ScoringConfig) => void }): JSX.Element;
  export const TYPE_GROUPS: Readonly<Record<"choice" | "match" | "written", readonly QuestionType[]>>;
  ```

`QuestionEditor` is the five-block skeleton `UX-07` fixes for all 12 types — **prompt → answer → key and scoring → meta → preview**, in that order, with only the answer block swapped. It is built once here and the next two tasks add answer blocks to it. The type-change confirmation (`UX-06`) names exactly the fields that will be lost, and the save path replaces the type-specific fields wholesale (Review Focus 2).

`ReorderableList` is the buttons-first control: a move-up and a move-down button per row plus a numeric position input. `onReorder(from, to)` is the single mutation both of them call, and is the seam the deferred drag enhancement would later attach to without changing the component's props. It owns Review Focus item 5 — after a move it focuses the button that was pressed, now at the item's new position, and writes "Option B moved to position 2 of 4" into an `aria-live="polite"` region.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/authoring/reorder.test.tsx
it("moves an item with the keyboard and keeps focus on the button that moved it", async () => {
  render(<Options initial={["A", "B", "C"]} />);
  const down = screen.getByRole("button", { name: /move option A down/i });
  down.focus();
  await userEvent.keyboard("{Enter}");
  expect(visibleOrder()).toEqual(["B", "A", "C"]);
  expect(document.activeElement).toHaveAccessibleName(/move option A down/i);
});

it("announces the new position in a live region", async () => {
  await userEvent.click(screen.getByRole("button", { name: /move option A down/i }));
  expect(screen.getByRole("status")).toHaveTextContent("Option A moved to position 2 of 3");
});

it("the numeric position field moves an item to an arbitrary index", async () => {
  await userEvent.clear(screen.getByRole("spinbutton", { name: /position of option C/i }));
  await userEvent.type(screen.getByRole("spinbutton", { name: /position of option C/i }), "1{Enter}");
  expect(visibleOrder()).toEqual(["C", "A", "B"]);
});

it("move up on the first item and move down on the last are disabled, not no-ops", () => {
  expect(screen.getByRole("button", { name: /move option A up/i })).toBeDisabled();
});

it("WCAG 2.1.1: every reorder is reachable without a pointer", async () => {
  expect(await axe(container)).toHaveNoViolations();
  expect(screen.queryByText(/drag/i)).toBeNull();      // no drag at all in this phase — see Known deferrals
});
```

```tsx
// apps/web/test/authoring/choice-editor.test.tsx
it("UX-07: the five blocks appear in order for every choice type", () => {
  for (const type of ["single", "multiple", "select_k", "true_false", "assertion_reason"] as const) {
    render(<QuestionEditor bankId="bnk_1" initial={fixtureOf(type)} onSaved={noop} />);
    expect(headingOrder()).toEqual(["Prompt", "Answer", "Key and scoring", "Meta", "Preview"]);
    cleanup();
  }
});

it("the scoring row offers only the modes the type supports", () => {
  render(<ScoringRow type="single" value={{}} onChange={noop} />);
  expect(optionValues("Scoring mode")).toEqual(APPLICABLE_MODES.single);
  cleanup();
  render(<ScoringRow type="multiple" value={{}} onChange={noop} />);
  expect(optionValues("Scoring mode")).toContain("partial");
});

it("AC-07: select_k disables further choices once k options are marked correct", async () => {
  render(<QuestionEditor bankId="bnk_1" initial={{ ...selectK, k: 2 }} onSaved={noop} />);
  await userEvent.click(screen.getByRole("checkbox", { name: /option A is correct/i }));
  await userEvent.click(screen.getByRole("checkbox", { name: /option B is correct/i }));
  expect(screen.getByRole("checkbox", { name: /option C is correct/i })).toBeDisabled();
});

it("an option marked pinned never moves (shuffle_options)", async () => {
  await userEvent.click(screen.getByRole("checkbox", { name: /pin option B/i }));
  expect(screen.getByRole("button", { name: /move option B up/i })).toBeDisabled();
});

it("UX-06: changing the type names exactly what will be lost before it drops it", async () => {
  render(<QuestionEditor bankId="bnk_1" initial={selectKFixture} onSaved={noop} />);
  await userEvent.click(screen.getByRole("button", { name: /change type/i }));
  await userEvent.click(screen.getByRole("button", { name: /true \/ false/i }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(/options.*key.*k/is);
  expect(dialog).not.toHaveTextContent(/prompt|tags|difficulty|explanation/i);
});

it("Review Focus 2: a type changed away and back carries no stale field", async () => {
  const saved = await changeType(changeType(selectKFixture, "single"), "select_k");
  expect(saved).not.toHaveProperty("k");
});

it("the editor has no axe violations and every control has a label", async () => {
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/web/test/authoring`
Expected: FAIL.

- [ ] **Step 3: Implement the skeleton, the reorder control and the choice answer block**

`TYPE_GROUPS` is the picker's three groups — `choice` (`single`, `multiple`, `select_k`, `true_false`, `assertion_reason`), `match` (`matching`, `multi_matching`, `ordering`), `written` (`fill_blank`, `numeric`, `short_answer`, `long_answer`). `ScoringRow` reads `APPLICABLE_MODES` from `@pariksha/core` so the UI and the validator cannot disagree. The type change builds the next document from the shared fields only — `id`, `prompt`, `media`, `group`, `difficulty`, `tags`, `explanation`, `scoring` — and never spreads the old one.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, with no new colour literal and no axe violation.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -s -m "feat(web): question editor skeleton, keyboard reordering and the choice family"
```

---

## Task 4: Question editors — the structured family (#47, P4.3)

**Files:**
- Create: `apps/web/src/components/authoring/answer/Structured.tsx`
- Create: `apps/web/test/authoring/structured-editor.test.tsx`
- Modify: `apps/web/src/components/authoring/QuestionEditor.tsx` (register the three types), `apps/web/src/styles/authoring.css`

**Interfaces:**
- Consumes: `ReorderableList`, `QuestionEditor`, `ScoringRow`, `MatchingQuestion`, `MultiMatchingQuestion`, `OrderingQuestion`.
- Produces: `export function StructuredAnswer(props: { question: MatchingQuestion | MultiMatchingQuestion | OrderingQuestion; onChange: (next: Question) => void }): JSX.Element;`

`UX-07`'s row for this family: two item columns for `matching` and `multi_matching` with the key as a checkbox grid, one ordered list for `ordering` where the written order *is* the key. Both columns and the ordered list reorder through `ReorderableList`, so Task 3's focus and live-region behaviour comes with them. `UX-08`: `ordering` is authored in the correct order and shuffled for candidates, and the editor says so in plain words under the list — the one type where what the author sees is deliberately not what the candidate sees.

- [ ] **Step 1: Write the failing test**

```tsx
it("UX-08: the ordering editor states that candidates see a shuffled list", () => {
  render(<QuestionEditor bankId="bnk_1" initial={orderingFixture} onSaved={noop} />);
  expect(screen.getByText(/candidates see these shuffled/i)).toBeVisible();
});

it("UX-08: the written order is the key — there is no separate key control", () => {
  expect(screen.queryByLabelText(/correct order/i)).toBeNull();
  expect(screen.getByRole("group", { name: /items/i })).toBeVisible();
});

it("ordering offers all_or_nothing and position, and not partial", () => {
  expect(optionValues("Scoring mode")).toEqual(APPLICABLE_MODES.ordering);
  expect(optionValues("Scoring mode")).toContain("position");
});

it("matching: the key grid is single-select per left item and a used right item cannot be used twice", async () => {
  render(<QuestionEditor bankId="bnk_1" initial={matchingFixture} onSaved={noop} />);
  await userEvent.click(screen.getByRole("radio", { name: /INNER JOIN matches Only matching rows/i }));
  expect(screen.getByRole("radio", { name: /LEFT JOIN matches Only matching rows/i })).toBeDisabled();
});

it("AC-07: multi_matching accepts several right items per left item", async () => {
  render(<QuestionEditor bankId="bnk_1" initial={multiMatchingFixture} onSaved={noop} />);
  await userEvent.click(screen.getByRole("checkbox", { name: /A matches X/i }));
  await userEvent.click(screen.getByRole("checkbox", { name: /A matches Y/i }));
  expect(saved().key).toEqual({ A: ["X", "Y"] });
});

it("deleting a right item clears every key entry that named it", async () => {
  await userEvent.click(screen.getByRole("button", { name: /remove right item X/i }));
  expect(JSON.stringify(saved().key)).not.toContain("X");
});

it("a key built in the editor passes validateBank", () => {
  expect(validateBank({ format: "pariksha/bank@1", name: "t", questions: [saved()] }).ok).toBe(true);
});

it("the three structured editors have no axe violations", async () => {
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/web/test/authoring/structured-editor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `Structured.tsx`**

The `matching` grid is a radio group per left item, because the format allows each right item at most once; `multi_matching` is a checkbox grid because it does not. Removing an item from either column must rewrite the key in the same state update, which is what keeps the editor's output passing `validateBank` without the editor containing a copy of its rules.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -s -m "feat(web): matching, multi-matching and ordering editors"
```

---

## Task 5: Question editors — text and manual families (#48, P4.4)

**Files:**
- Create: `apps/web/src/components/authoring/answer/Written.tsx`
- Create: `apps/web/test/authoring/written-editor.test.tsx`
- Modify: `apps/web/src/components/authoring/QuestionEditor.tsx`, `apps/web/src/components/authoring/PromptEditor.tsx` (emit placeholder changes), `apps/web/src/styles/authoring.css`

**Interfaces:**
- Consumes: `PromptEditor`, `QuestionEditor`, `ScoringRow`, `FillBlankQuestion`, `NumericQuestion`, `ShortAnswerQuestion`, `LongAnswerQuestion`.
- Produces:
  ```ts
  export function WrittenAnswer(props: { question: FillBlankQuestion | NumericQuestion | ShortAnswerQuestion | LongAnswerQuestion; onChange: (next: Question) => void }): JSX.Element;
  export function placeholdersIn(prompt: string): string[];   // in prompt order, deduplicated
  ```

`UX-21` is the whole shape of the `fill_blank` editor: typing `{{1}}` in the prompt creates blank `1` with its accepted answers and match mode; deleting the placeholder deletes the row. The blanks list is derived from the prompt, never edited independently, which is what stops the prompt and the blanks drifting into the state `validateBank` rejects. `numeric` gets value, tolerance and tolerance type plus the optional unit; `short_answer` and `long_answer` get max length with the format's ceilings (500 and 5,000) and the rubric rows, with `rubric` the only mode offered.

- [ ] **Step 1: Write the failing test**

```tsx
it("UX-21: typing {{1}} in the prompt grows a blank row for it", async () => {
  render(<QuestionEditor bankId="bnk_1" initial={emptyFillBlank} onSaved={noop} />);
  await userEvent.type(screen.getByLabelText(/prompt/i), "The capital is {{1}}.");
  expect(await screen.findByRole("group", { name: /blank 1/i })).toBeVisible();
});

it("UX-21: deleting the placeholder deletes the row", async () => {
  await userEvent.clear(screen.getByLabelText(/prompt/i));
  expect(screen.queryByRole("group", { name: /blank 1/i })).toBeNull();
});

it("the blanks follow the prompt's order and a repeated placeholder makes one row", () => {
  expect(placeholdersIn("{{b}} then {{a}} then {{b}}")).toEqual(["b", "a"]);
});

it("a fill_blank built in this editor always passes validateBank's placeholder rule", async () => {
  await userEvent.type(screen.getByLabelText(/prompt/i), "{{1}} and {{2}}");
  await userEvent.type(screen.getByLabelText(/accepted answers for blank 1/i), "Delhi");
  await userEvent.type(screen.getByLabelText(/accepted answers for blank 2/i), "Mumbai");
  expect(validateBank(bankOf(saved())).ok).toBe(true);
});

it("a regex match mode rejects a pattern core calls unsafe, inline, before save", async () => {
  await userEvent.selectOptions(screen.getByLabelText(/match mode for blank 1/i), "regex");
  await userEvent.type(screen.getByLabelText(/accepted answers for blank 1/i), "(a+)+$");
  expect(await screen.findByRole("alert")).toHaveTextContent(/unsafe/i);
  expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
});

it("numeric offers value, tolerance, tolerance type and unit, and tolerance type is absolute or percent", () => {
  expect(optionValues("Tolerance type")).toEqual(["absolute", "percent"]);
});

it("max_length is capped at the format's ceiling for each type", async () => {
  expect(screen.getByLabelText(/maximum length/i)).toHaveAttribute("max", "500");   // short_answer
  cleanup();
  render(<QuestionEditor bankId="bnk_1" initial={longAnswerFixture} onSaved={noop} />);
  expect(screen.getByLabelText(/maximum length/i)).toHaveAttribute("max", "5000");
});

it("short_answer and long_answer offer rubric and nothing else", () => {
  expect(optionValues("Scoring mode")).toEqual(["rubric"]);
});

it("a manual type with no rubric warns that it will score 0", () => {
  expect(screen.getByRole("status")).toHaveTextContent(/scores 0 without a rubric/i);
});

it("the four written editors have no axe violations", async () => {
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/web/test/authoring/written-editor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `Written.tsx` and the placeholder hook**

`placeholdersIn` uses the same `/\{\{([^{}]+)\}\}/g` pattern `packages/core/src/validate.ts` uses — copy the expression, not the rule. The blanks array is rebuilt from the prompt on every change, carrying across the accepted answers and match mode of a blank whose ID survived. The regex warning calls the API's dry-run validation rather than re-implementing `assertSafeRegex` in the browser.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -s -m "feat(web): fill-blank, numeric, short-answer and long-answer editors"
```

---

## Task 6: Passage groups (#50, P4.6)

**Files:**
- Create: `apps/web/src/components/authoring/GroupEditor.tsx`
- Create: `apps/api/test/groups.test.ts`, `apps/web/test/authoring/groups.test.tsx`
- Modify: `packages/db/src/repo/banks.ts` (group reads and writes on `groups_json`), `apps/api/src/routes/banks.ts`, `apps/web/src/routes/bank.tsx`, `apps/web/src/components/authoring/QuestionEditor.tsx` (the meta block's group select)

**Interfaces:**
- Consumes: `getBank`, `updateBank`, `renderMarkdown`, `PassageGroup`.
- Produces:
  ```ts
  export const listGroups: ScopedFn<[bankId: string], (PassageGroup & { questionCount: number })[]>;
  export const upsertGroup: ScopedFn<[bankId: string, group: PassageGroup, now: number], void>;
  export const deleteGroup: ScopedFn<[bankId: string, groupId: string], { deleted: boolean; blockedBy: string[] }>;
  export function GroupEditor(props: { bankId: string; group?: PassageGroup; onSaved: (g: PassageGroup) => void }): JSX.Element;
  ```

Routes: `GET/POST /api/v1/banks/:bankId/groups` (budget 2), `PATCH/DELETE /api/v1/banks/:bankId/groups/:groupId` (budget 3). Groups live in `question_bank.groups_json`, which is why there is no new table and no migration here: a bank holds a handful of them and every read wants all of them. A group's `passage` is Markdown and renders through the same `renderMarkdown` as a prompt, in the browser that shows it — the JSON entry holds the Markdown and nothing else.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/groups.test.ts
it("a group is created with an id, an optional title and a Markdown passage", async () => {
  const res = await app.request(`/api/v1/banks/${bank}/groups`, post({ id: "orders-table", title: "Orders", passage: "| a |\n| - |" }, asAuthor));
  expect(res.status).toBe(201);
});

it("a duplicate group id in the same bank is rejected with the field named", async () => {
  const res = await app.request(`/api/v1/banks/${bank}/groups`, post({ id: "orders-table", passage: "x" }, asAuthor));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatchObject({ code: "duplicate_group", details: { field: "id" } });
});

it("deleting a group that questions reference is refused and names them", async () => {
  const res = await app.request(`/api/v1/banks/${bank}/groups/orders-table`, del(asAuthor));
  expect(res.status).toBe(409);
  expect((await res.json()).error.details.questions).toEqual(["DIN-001", "DIN-002"]);
});

it("a question cannot name a group that does not exist — the same rule validateBank enforces", async () => {
  const res = await app.request(`/api/v1/banks/${bank}/questions`, post({ ...single, group: "nope" }, asAuthor));
  expect(res.status).toBe(422);
  expect((await res.json()).error.details.issues[0]).toMatchObject({ field: "group" });
});

it("the passage is stored as Markdown, verbatim, and the entry carries no rendered form", async () => {
  const row = await groupRow(bank, "orders-table");
  expect(row.passage).toBe("| a |\n| - |");
  expect(Object.keys(row)).not.toContain("passage_html");
});

it("export carries groups and questions keep their group reference", async () => {
  const doc = await json(`/api/v1/banks/${bank}/export`, asAuthor);
  expect(doc.groups).toContainEqual(expect.objectContaining({ id: "orders-table" }));
  expect(doc.questions.find((q) => q.id === "DIN-001").group).toBe("orders-table");
});
```

```tsx
// apps/web/test/authoring/groups.test.tsx
it("the group's passage renders above each question in its group in the preview", () => {
  render(<QuestionEditor bankId="bnk_1" initial={questionInGroup} onSaved={noop} />);
  const preview = screen.getByRole("region", { name: /preview/i });
  expect(within(preview).getByRole("table")).toBeVisible();          // the passage's Markdown table
  expect(previewOrder()).toEqual(["passage", "prompt"]);
});

it("the meta block offers the bank's groups and 'no group'", () => {
  expect(optionValues("Passage group")).toEqual(["", "orders-table", "library-loans"]);
});

it("the group editor has no axe violations", async () => {
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/groups.test.ts apps/web/test/authoring/groups.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the group repository functions, routes and editor**

Read-modify-write on `groups_json` inside one statement per change, and keep the write a single `UPDATE question_bank SET groups_json = ? WHERE workspace_id = ? AND id = ?`. The group-exists rule is `validateBank`'s, reached by validating the one-question bank the route constructs — not by a second check in the route.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/api apps/web
git commit -s -m "feat(banks): passage groups with shared rendering and referenced-group protection"
```

---

## Task 7: Import — Pariksha JSON, all-or-nothing with positioned errors (#51, P4.7)

**Files:**
- Create: `apps/api/src/import/schema.ts`, `apps/api/src/import/json.ts`, `apps/api/test/import/json.test.ts`
- Create: `apps/web/src/components/authoring/ImportDialog.tsx`, `apps/web/test/authoring/import-dialog.test.tsx`
- Modify: `packages/db/src/client.ts` (add `batch`), `packages/db/test/migrate.test.ts` (batch behaviour), `apps/api/src/routes/banks.ts`, `apps/api/src/app.ts`, `apps/api/package.json`

**Interfaces:**
- Consumes: `validateBank`, `ImportIssue` (`@pariksha/core`), `upsertQuestions`, `upsertGroup`, `appendAudit`, `requires("banks.edit")`.
- Produces:
  ```ts
  // packages/db/src/client.ts
  export interface DbClient { /* … */ batch(statements: readonly { sql: string; params?: unknown[] }[]): Promise<void> }

  // apps/api/src/import/schema.ts
  export interface StructuralIssue { questionId: string | null; index: number; field: string; message: string }
  export function validateBankDocumentStructure(doc: unknown): StructuralIssue[];

  // apps/api/src/import/json.ts
  export interface ImportReport { imported: number; issues: (ImportIssue & { line?: number })[] }
  export function importBankJson(deps: AppDeps, workspaceId: string, bankId: string, body: unknown, opts: { dryRun: boolean; now: number }): Promise<ImportReport>;
  export const IMPORT_MAX_QUESTIONS = 500;
  ```

Route: `POST /api/v1/banks/:bankId/import` (budget **4**, constant in the file's size: one bank read, one `batch`, one audit write, one spare). `?dryRun=1` validates and reports without writing, which is what the dialog calls first.

`validateBank` from `@pariksha/core` **is** the cross-field rule set — Phase 1 shipped every rule in question-format.md's "Rules checked on import" and this task calls it. The only thing added here is the structural layer, which is `@cfworker/json-schema` against `schemas/bank-1.json` and `schemas/question-1.json` (imported as JSON modules so they are inlined into the Worker bundle). Ajv is not usable at runtime on Workers: it compiles validators with `new Function`, which the runtime forbids.

This task owns Review Focus item 3: `upsertQuestions` builds one statement per question and hands the array to `db.batch`, which is one `env.DB.batch()` on D1 — one subrequest — and one transaction on SQLite and Postgres.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/import/json.test.ts
it("AC-05: a bank with one bad question imports nothing and reports the position and reason", async () => {
  const doc = withBadKey(exampleBank, "LOG-001");   // key names an option that is not there
  const res = await app.request(`/api/v1/banks/${bank}/import`, post(doc, asAuthor));
  expect(res.status).toBe(422);
  expect(await questionCount(bank)).toBe(0);
  expect((await res.json()).error.details.issues).toContainEqual(
    expect.objectContaining({ questionId: "LOG-001", index: 5, field: "key", message: expect.stringMatching(/not among the options/) }),
  );
});

it("the example bank — one question of every type — imports whole", async () => {
  const res = await app.request(`/api/v1/banks/${bank}/import`, post(exampleBank, asAuthor));
  expect(res.status).toBe(200);
  expect(await questionCount(bank)).toBe(exampleBank.questions.length);
});

it("D-02: structural and cross-field issues arrive together, in one report", async () => {
  const doc = { ...exampleBank, questions: [{ id: "A", type: "single" }, withBadKey(exampleBank).questions[5]] };
  const issues = (await (await post_(doc)).json()).error.details.issues;
  expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(["options", "key"]));
});

it("Review Focus 3: importing 200 questions stays within the route's budget", async () => {
  const { counts } = await withCountingDeps(() => post_(bankOf(200)));
  expect(counts().total).toBeLessThanOrEqual(ROUTE_BUDGETS["POST /api/v1/banks/:bankId/import"]);
  expect(counts().total).toBeLessThan(10);
});

it("an import over IMPORT_MAX_QUESTIONS is refused before anything is parsed", async () => {
  expect((await post_(bankOf(501))).status).toBe(413);
});

it("an import stores the Markdown source verbatim and derives nothing from it", async () => {
  await post_(exampleBank);
  const row = await questionRow(bank, "LOG-001");
  expect(row.prompt_md).toBe(exampleBank.questions[0].prompt);
});

it("a duplicate ref_id against questions already in the bank is an issue, not a silent overwrite", async () => {
  await post_(exampleBank);
  const issues = (await (await post_(exampleBank)).json()).error.details.issues;
  expect(issues[0]).toMatchObject({ field: "id", message: expect.stringMatching(/already in this bank/) });
});

it("dryRun reports exactly what a real import would and writes nothing", async () => {
  const dry = await (await app.request(`/api/v1/banks/${bank}/import?dryRun=1`, post(exampleBank, asAuthor))).json();
  expect(dry).toMatchObject({ imported: exampleBank.questions.length, issues: [] });
  expect(await questionCount(bank)).toBe(0);
});

it("batch is one subrequest on D1 and one transaction elsewhere, and rolls back whole", async () => {
  await expect(db.batch([good, broken])).rejects.toThrow();
  expect(await questionCount(bank)).toBe(0);
});
```

```tsx
// apps/web/test/authoring/import-dialog.test.tsx
it("the dialog shows the dry-run report before anything is written, with one row per issue", async () => {
  await userEvent.upload(screen.getByLabelText(/file/i), badJsonFile);
  expect(await screen.findByText(/nothing was imported/i)).toBeVisible();
  expect(screen.getAllByRole("row", { name: /LOG-001/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
});

it("the import dialog has no axe violations and the report is readable by a screen reader", async () => {
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db apps/api/test/import apps/web/test/authoring/import-dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `batch`, the structural layer and the import route**

`batch` is `binding.batch(stmts.map(s => binding.prepare(s.sql).bind(...)))` on D1, `BEGIN … COMMIT` around the statements on `better-sqlite3`, and `sql.begin` on `postgres`. The route's order is: size check, structural validation, `validateBank`, duplicate check against the bank's existing `ref_id`s, then one `batch`. Any issue at any stage returns 422 with every issue found and writes nothing — `validateBank` already collects rather than throwing at the first, which is why the whole report arrives at once.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web` and `pnpm vitest run apps/api/test/budget.test.ts`
Expected: PASS, with the import route inside its budget at 200 questions.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/api apps/web
git commit -s -m "feat(import): all-or-nothing pariksha json import with positioned errors"
```

---

## Task 8: Import — CSV and Moodle GIFT (#52, P4.8)

**Files:**
- Create: `apps/api/src/import/rows.ts`, `apps/api/src/import/csv.ts`, `apps/api/src/import/gift.ts`
- Create: `apps/api/test/import/csv.test.ts`, `apps/api/test/import/gift.test.ts`, `apps/api/test/fixtures/import/*.csv`, `*.gift`
- Modify: `apps/api/src/import/json.ts` (accept a position map), `apps/api/src/routes/banks.ts`, `apps/web/src/components/authoring/ImportDialog.tsx`, `docs/question-format.md` (document the CSV columns)

**Interfaces:**
- Consumes: `importBankJson`, `validateBank`, `ImportIssue`.
- Produces:
  ```ts
  export function readDelimited(text: string): string[][];            // RFC 4180: quotes, "" escapes, embedded newlines, CRLF, BOM
  export interface Converted { bank: Bank; lines: number[]; issues: (ImportIssue & { line: number })[] }
  export function convertCsv(text: string): Converted;
  export function convertGift(text: string): Converted;
  export const CSV_TYPES = ["single", "multiple", "true_false", "numeric", "fill_blank"] as const;
  export const CSV_COLUMNS = ["id", "type", "prompt", "options", "key", "points", "mode", "difficulty", "tags", "explanation"] as const;
  ```

Route: `POST /api/v1/banks/:bankId/import?format=csv|gift` on the same handler and the same budget. `Converted.lines[i]` is the source line that produced `bank.questions[i]`, and the route translates every `ImportIssue.index` through it before reporting — the second half of Review Focus item 4. A converter never validates: it builds `pariksha/bank@1` and reports only what it could not parse at all.

**GIFT covers exactly the five types the CSV importer covers** — `single`, `multiple`, `true_false`, `numeric`, `fill_blank` — matching the PRD's CSV scope in `D-01`. Hand-written parser, no dependency. **A GIFT construct outside that set is a positioned error, never a silent skip**: a matching question (`->`), an essay (`{}`), a `$CATEGORY` line, a numeric range (`..`) that the format cannot express — each reports its line and what it was, and the import fails whole.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/import/csv.test.ts
it.each([
  ['a,"b,c",d\n', [["a", "b,c", "d"]]],
  ['a,"line\nbreak",c\n', [["a", "line\nbreak", "c"]]],
  ['a,"say ""hi""",c\n', [["a", 'say "hi"', "c"]]],
  ['﻿a,b\r\nc,d\r\n', [["a", "b"], ["c", "d"]]],
])("readDelimited parses %j", (text, rows) => expect(readDelimited(text)).toEqual(rows));

it("the five CSV types convert into pariksha/bank@1 and pass validateBank", () => {
  const { bank, issues } = convertCsv(read("five-types.csv"));
  expect(issues).toEqual([]);
  expect(bank.questions.map((q) => q.type)).toEqual(["single", "multiple", "true_false", "numeric", "fill_blank"]);
  expect(validateBank(bank).ok).toBe(true);
});

it("Review Focus 4: a bad key reports the CSV line, not the question index", async () => {
  const res = await importCsv("bad-key.csv");      // header + 3 rows, defect on row 3 => line 4
  expect((await res.json()).error.details.issues[0]).toMatchObject({ line: 4, field: "key" });
  expect(await questionCount(bank)).toBe(0);
});

it("Review Focus 4: the message is identical to the one the same defect gets as JSON", async () => {
  const viaCsv = (await (await importCsv("bad-key.csv")).json()).error.details.issues[0].message;
  const viaJson = (await (await importJson(sameDefectAsJson)).json()).error.details.issues[0].message;
  expect(viaCsv).toBe(viaJson);
});

it("a CSV naming a type outside the five is a positioned error", async () => {
  expect((await (await importCsv("ordering-row.csv")).json()).error.details.issues[0])
    .toMatchObject({ line: 2, field: "type", message: expect.stringMatching(/csv import supports.*ordering/i) });
});

it("a row with the wrong column count reports its line rather than shifting every field", async () => {
  expect((await (await importCsv("short-row.csv")).json()).error.details.issues[0]).toMatchObject({ line: 3 });
});
```

```ts
// apps/api/test/import/gift.test.ts
it("converts the five supported GIFT forms", () => {
  const { bank, issues } = convertGift(read("five-types.gift"));
  expect(issues).toEqual([]);
  expect(bank.questions.map((q) => q.type)).toEqual(["single", "multiple", "true_false", "numeric", "fill_blank"]);
  expect(validateBank(bank).ok).toBe(true);
});

it("GIFT ~%50% weights land as a partial-scoring multiple", () => {
  expect(convertGift("::q:: Pick {~%50%A ~%50%B ~%-100%C}").bank.questions[0]).toMatchObject({ type: "multiple", key: ["A", "B"] });
});

it.each([
  ["matching", "::m:: Match {=a -> 1 =b -> 2}", /matching/i],
  ["essay", "::e:: Discuss {}", /essay/i],
  ["category", "$CATEGORY: /top/sub", /\$CATEGORY/],
  ["numeric range", "::n:: Value {#1..3}", /range/i],
])("an unsupported GIFT construct (%s) is a positioned error, never a silent skip", (_n, src, re) => {
  const { issues, bank } = convertGift(src);
  expect(bank.questions).toEqual([]);
  expect(issues[0]).toMatchObject({ line: 1, message: expect.stringMatching(re) });
});

it("GIFT comments, blank-line separation and escaped specials are handled", () => {
  expect(convertGift("// a comment\n\n::q:: 2 \\+ 2 is {#4}").bank.questions).toHaveLength(1);
});

it("a GIFT file with any error imports nothing", async () => {
  await importGift("one-bad.gift");
  expect(await questionCount(bank)).toBe(0);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/import`
Expected: FAIL.

- [ ] **Step 3: Implement the reader and the two converters**

`readDelimited` is a character-state loop, roughly forty lines: in-quotes, `""` is a literal quote, `\r\n` and `\n` both end a row outside quotes, and a leading BOM is dropped. It is written here rather than taken from a dependency because the Worker bundle is size-constrained and the format is one we define — swap it for `papaparse` if the test matrix ever outgrows those four cases. `convertGift` splits on blank lines outside `{}`, strips `//` comments, and recognises exactly the five supported forms; everything else it recognises *as unsupported* and reports with its line, which is the difference between a positioned error and a silent skip.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web docs/question-format.md
git commit -s -m "feat(import): csv and moodle gift converters with source-line positions"
```

---

## Task 9: Export — bank and question JSON round-trip (#53, P4.9)

**Files:**
- Create: `apps/api/src/export/bank.ts`, `apps/api/test/export/round-trip.test.ts`
- Modify: `apps/api/src/routes/banks.ts`, `apps/api/src/app.ts`, `apps/web/src/routes/bank.tsx` (export from the bulk bar), `apps/web/src/components/authoring/ImportDialog.tsx`, `docs/ROADMAP.md` (Progress table)

**Interfaces:**
- Consumes: `getBank`, `listQuestions`, `listGroups`, `toQuestionDocument`, `importBankJson`, `validateBank`.
- Produces:
  ```ts
  export function toBankDocument(bank: BankRow, groups: readonly PassageGroup[], questions: readonly QuestionRow[]): Bank;
  ```

Routes: `GET /api/v1/banks/:bankId/export` (budget 3) and `GET /api/v1/banks/:bankId/questions/:qid/export` (budget 1), plus `?ids=` on the first so the browser's bulk bar exports a selection. The exported document carries `$schema`, `format: "pariksha/bank@1"`, name, description, license, groups and questions — the Markdown source, which under [ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md) is the only representation there is, so export is a mapping with nothing to strip. This task closes `AC-05`'s other half and the Phase 4 gate: every type authored, previewed and round-tripped with no loss.

- [ ] **Step 1: Write the failing test**

```ts
it("AC-04 / AC-05: the example bank round-trips byte-for-byte through import and export", async () => {
  await importJson(exampleBank);
  const out = await json(`/api/v1/banks/${bank}/export`, asAuthor);
  expect(out).toEqual({ ...exampleBank, $schema: expect.any(String) });
});

it("the exported document validates against bank-1.json and question-1.json", async () => {
  expect(validateBankDocumentStructure(out)).toEqual([]);
  expect(validateBank(out).ok).toBe(true);
});

it("every one of the 12 types survives the round trip, field for field", async () => {
  for (const q of exampleBank.questions) {
    expect(out.questions.find((e) => e.id === q.id), q.type).toEqual(q);
  }
});

it("Review Focus 2: a question whose type was changed away and back exports no stale field", async () => {
  await patchQuestion(selectKId, asSingle);
  await patchQuestion(selectKId, backToSelectK);
  const q = (await json(`/api/v1/banks/${bank}/export`, asAuthor)).questions.find((e) => e.id === "QNT-003");
  expect(validateBank({ format: "pariksha/bank@1", name: "x", questions: [q] }).ok).toBe(true);
});

it("export carries no internal identifier", async () => {
  const text = await (await app.request(`/api/v1/banks/${bank}/export`, asAuthor)).text();
  for (const leak of ["workspace_id", "qst_", "bnk_"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("a re-export after an unrelated question is edited leaves the others identical", async () => {
  expect(exportWithout(out2, "LOG-001")).toEqual(exportWithout(out, "LOG-001"));
});

it("?ids= exports only the selected questions and still validates", async () => {
  const sel = await json(`/api/v1/banks/${bank}/export?ids=LOG-001,QNT-003`, asAuthor);
  expect(sel.questions.map((q) => q.id)).toEqual(["LOG-001", "QNT-003"]);
});

it("exporting a bank with 200 questions stays within the route's budget", async () => {
  expect((await withCountingDeps(() => exportBank())).counts().total)
    .toBeLessThanOrEqual(ROUTE_BUDGETS["GET /api/v1/banks/:bankId/export"]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/export`
Expected: FAIL.

- [ ] **Step 3: Implement `toBankDocument` and the two routes**

It is a mapping, not a serialiser: `toQuestionDocument` already produced `pariksha/question@1` for every read in Task 2, so export reads the bank, its groups and its questions in three queries and assembles them. Omit every field the format calls optional when the stored value is absent, so a bank that never had a licence does not export `"license": null` and fail a strict importer elsewhere.

- [ ] **Step 4: Run the whole suite**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`, with `TEST_POSTGRES_URL` set.
Expected: all pass, on both dialects.

- [ ] **Step 5: Update the roadmap Progress table and commit**

Move Phase 4 to **Done** in `docs/ROADMAP.md`'s Progress table, naming what landed and the issues that closed.

```bash
git add apps/api apps/web docs/ROADMAP.md
git commit -s -m "feat(export): bank and question json export with a full round-trip suite"
```

---

## Smaller calls made while planning

The planner's calls, not the PRD's or design.md's. Listed so a human can overrule them cheaply.

- **No syntax-highlighting dependency.** `DESIGN.md` §3.2 already decided this for the landing page's code block; Phase 4 keeps it. Fenced code carries `class="language-x"` and the existing code-block styling does the rest.
- **Eleven type-specific fields go into one `extra_json` column**, not eleven columns that are null for most types. The browser's filters and sorts use the columns that already exist.
- **Passage groups live in `question_bank.groups_json`**, not in a table. A bank holds a handful and every read wants all of them. Upgrade path: a `question_group` table if groups ever need their own permissions or cross-bank reuse.
- **`question.points` becomes a real.** `schemas/question-1.json` gives `scoring.points` `"type": "number"`; the Phase 2 `int` column would silently round `0.5` to `0`. The alternative is to drop the denormalised column and sort on `scoring_json`, which no dialect does well.
- **`IMPORT_MAX_QUESTIONS = 500` and a 2 MB request body.** Neither the PRD nor the roadmap states a cap; an uncapped import is a memory and CPU hazard on a Worker. Raise it if a real bank is bigger.
- **Authored media is proxied, not signed.** `S-16`'s ten-minute signed URL is right for a snapshot download and wrong for an `<img src>` written into a question's Markdown: the Markdown outlives the URL, so a signed one is broken content ten minutes after it is authored, and a redirect to a storage origin is a third-party request under `default-src 'self'`. Content-addressed keys make the proxy cacheable forever.
- **`GET /api/v1/media/:key` requires an authenticated actor in the workspace the key names.** Phase 6 extends it to attempt tokens for candidates; Phase 4 has no candidate to serve.
- **`listWorkspaceTags` unions `tags_json` in memory** from one query rather than adding a tag table. Upgrade path noted in the code.
- **A hand-written RFC 4180 reader** rather than `papaparse`, at about forty lines with a six-case test, because the Worker bundle is size-constrained and the CSV shape is one we define.
- **`@cfworker/json-schema` at runtime, Ajv in tests.** Ajv compiles validators with `new Function`, which Workers forbid. The schemas are the same files.

## Known deferrals, recorded so they are not rediscovered as bugs

- **`AC-07`'s drag reordering is deferred. Buttons-first ships.** `AC-07` asks that "ordering supports drag *and* keyboard reordering". This phase ships the keyboard half in full — move-up and move-down buttons, a numeric position field, focus kept on the moved row's button and the new position announced in a live region (`UX-07`, `UX-08`, Task 3) — and ships no pointer drag at all. That ordering is deliberate: drag-only reordering fails WCAG 2.1.1, so the buttons are the control that has to exist, and drag is an enhancement on top of a control that already works. What would be added later: `draggable` on the row with native HTML5 `dragstart` / `dragover` / `drop` handlers calling the `onReorder(from, to)` Task 3 already exposes, plus a drop-position indicator — no dependency, and no change to `ReorderableList`'s props. **Until that lands, `AC-07` is not fully met.** The acceptance checklist should record it as partial rather than read as passing.

## Done when

- `AC-05` passes: a bank with one bad question imports nothing, through all three formats, and reports the source position and reason.
- Every one of the 12 types can be authored, previewed and round-tripped through export and import with no loss — `apps/api/test/export/round-trip.test.ts` proves it against `examples/reasoning-aptitude/questions.json`.
- KaTeX is lazy and stays lazy: `katex` and `@vscode/markdown-it-katex` appear in no chunk any entry reaches by static import, they do appear in a chunk of their own, and rendering every prompt in `examples/reasoning-aptitude/questions.json` loads KaTeX zero times.
- No HTML is stored anywhere: `question` has no `prompt_html`, `explanation_html` or `render_version` column in either dialect, and a prompt containing `<script>` renders as escaped text because `markdown-it` runs with `html: false`.
- A delete is refused for every question a published test version references, and the refusal names the tests (`UX-05`).
- `ROUTE_BUDGETS` covers every route this phase mounts, no entry reaches 50, and a 200-question import stays in single digits.
- Every authoring screen passes `jest-axe`, every reorder is reachable without a pointer and keeps focus, and `apps/web/test/no-hex-colors.test.ts` still finds nothing.
- `pnpm lint typecheck build test` passes with SQLite and Postgres both migrating in CI.
