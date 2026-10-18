# 0004. Question content renders client-side, with KaTeX lazy-loaded

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

A question's `prompt` and `explanation` are Markdown with LaTeX (`$…$`, `$$…$$`) and fenced code blocks ([question-format.md](../question-format.md)). A passage group's `passage` is the same. Something has to turn that into HTML, and [design.md](../design.md) `UX-09` fixes a constraint on *which* something: the author's preview "is the same renderer the candidate runtime uses". One renderer, one output, or the preview is a lie.

There are three places that renderer could run, and one of them is closed outright:

- **In the Worker, per request.** The free plan gives 10 ms of CPU per invocation ([ADR 0002](0002-cloudflare-reference-stack-with-adapters.md)). Parsing Markdown and typesetting LaTeX for a page of questions does not fit, and it would be paid again on every candidate, on every page turn. Closed.
- **In the authoring browser, once, at save time**, storing sanitised HTML beside the Markdown.
- **In every browser that displays a question**, author's and candidate's alike, from one shared module.

The first draft of this record chose save-time pre-rendering. It rested on two claims about what that bought. Both were examined and neither survived.

**"Pre-rendering saves deployment cost." It does not.** The candidate bundle is a static asset, and Cloudflare's pricing page is explicit: *"Requests to static assets are free and unlimited"*, and *"There is no additional cost for storing Assets"* (<https://developers.cloudflare.com/workers/platform/pricing>). Neither design does any server-side rendering, so Worker invocations and Worker CPU are identical under both. **The deployment-cost difference between the two designs is zero.**

**"Pre-rendering buys determinism." It does not.** The pre-rendering design rendered LaTeX to **MathML**, and client-side rendering produces the same MathML from the same pinned KaTeX version. Whatever a browser does with that MathML, it does identically in both designs. Cross-browser MathML variance is the same either way. This was a mistaken argument, written down here so it is not made a second time.

What pre-rendering actually bought was candidate bytes. What it cost was a **stored-HTML XSS surface that otherwise does not exist at all**. With `markdown-it` configured `html: false`, raw HTML in a prompt is escaped to text and never becomes an element — there is no HTML injection path, and therefore nothing for a sanitiser to defend. Pre-rendering would create a database full of HTML a browser executes, an allowlist that is a security boundary, a server-side sanitiser on every write path, and an Author role — a workspace role, not an instance operator, and not fully trusted against a Candidate — standing on the other end of it inside the origin where the attempt token lives. Creating a surface and then defending it is worse than not creating it.

So the only real question left is what the bytes cost.

### Measured, not estimated

Bundled with esbuild (`--bundle --minify --format=esm`) against `markdown-it` and `katex` at current versions, then gzipped and brotli'd:

| Bundle | raw | gzip | brotli |
| --- | --- | --- | --- |
| `markdown-it` alone (`html: false`) | 97 KB | **41 KB** | 36 KB |
| `katex` alone (`output: "mathml"`, `trust: false`) | 262 KB | **76 KB** | 63 KB |
| both together | 359 KB | **116 KB** | 98 KB |

The PRD's hard limit is **candidate app ≤ 300 KB gzipped** ([PRD](../PRD.md), non-functional table). Loading both eagerly spends 39% of that on every test — including the ones with no mathematics anywhere in them, which is most of them: aptitude, SQL, general knowledge, and the `examples/reasoning-aptitude/` bank already in this repository contain no LaTeX at all. Lazily, Markdown costs **41 KB in the common case** and KaTeX's additional 76 KB is paid only by a question that actually contains `$…$`.

## Decision

**Markdown, LaTeX and code are rendered in the browser that displays them, by one shared renderer module the admin preview pane and the candidate runtime both import. KaTeX sits behind a dynamic `import()` triggered by detecting LaTeX in the content. Nothing is pre-rendered, and no HTML is stored.**

### What renders what, and when it loads

| Concern | Library | Loading | Cost |
| --- | --- | --- | --- |
| Markdown | `markdown-it` 14, `html: false`, `linkify: false`, `typographer: false` | initial chunk | 41 KB gzipped, always |
| LaTeX | `katex` 0.16, `output: "mathml"`, `trust: false`, `throwOnError: false` | dynamic `import()`, on content containing LaTeX | 76 KB gzipped, only then |
| Code | **nothing** — `markdown-it`'s own fenced-code renderer emits `<pre><code class="language-sql">` | — | 0 |
| Sanitising | **nothing** — `html: false` means there is no HTML to sanitise | — | 0 |

`DESIGN.md` §3.2 and the existing `apps/web/src/components/CodeBlock.tsx` already settled that there is no syntax-highlighting dependency; `class="language-x"` is the hook the existing code-block CSS styles. KaTeX emits **MathML only**, so there is no `katex.css` and none of KaTeX's eight woff2 faces — which matters twice over under `S-11` and `default-src 'self'`, where every asset would have to be self-hosted.

### Where it lives

`apps/web/src/render/markdown.ts`. The admin entry (`admin.html`), the public page (`index.html`) and the exam-demo island (`src/island/exam-demo.ts`) are already Rollup inputs of the same Vite application (`apps/web/vite.config.ts`), and Phase 6's exam runtime joins them there. "Shared" therefore needs no package — it is an import. `packages/core` is not the home: it is a pure leaf with no runtime dependencies, and `markdown-it` would end that. If the candidate runtime ever moves into an app of its own, the module moves to a `packages/render` with it.

Because KaTeX arrives asynchronously, the module's entry point is async:

```ts
export function hasLatex(source: string): boolean;
export function renderMarkdown(source: string): Promise<string>;
```

`hasLatex` is the trigger, and it is deliberately conservative: a false negative renders `$x^2$` as literal text, which an author sees in the preview immediately; a false positive costs 76 KB on one question, which nobody sees. When it is false, nothing but `markdown-it` is ever fetched.

### The source of truth

Markdown is the only stored representation. `prompt` and `explanation` are what the database holds and what `pariksha/question@1` carries, so export is the stored value and nothing else. A bank exported from one installation and imported into another round-trips byte-for-byte because there is no second representation to disagree with the first.

## Consequences

- **No `prompt_html`, `explanation_html` or `render_version` columns**, and no cache to keep in step with the source. Export round-trips trivially: there is one representation, and it is the one the format defines.
- **No server-side sanitiser.** No `xss` dependency, no `HTML_ALLOWLIST`, no allowlist conformance test, no "exactly one function writes HTML" structural rule to enforce across the repository. `UX-19`'s "no HTML sanitisation surface" is now literally true of the whole system and not only of the editor.
- **No render endpoint, no pending-render state, no bulk render action, no `RENDER_VERSION` bump path, and no publish-time check for stale HTML.** A re-render cannot mutate a question a candidate is halfway through reading, because there is nothing stored for it to mutate. The whole class of staleness bug is gone rather than guarded.
- **No two-step import.** An import stores Markdown and is finished.
- **`UX-09` is satisfied literally**, not approximately: the preview and the candidate runtime call the same function in the same module. A renderer change cannot reach one and miss the other.
- **The cost is candidate bytes:** 41 KB gzipped on every exam, 116 KB on an exam whose questions contain mathematics, against a 300 KB budget.
- **The cost is also a dependency on MathML in the candidate's browser.** `P-02` supports the latest two versions of Chrome, Edge and Firefox on desktop, plus "Safari on macOS where fullscreen and camera checks pass" — it pins no Safari version, so this decision must not assume one. MathML Core ships in current Chromium, Gecko and WebKit, and WebKit's MathML support long predates MathML Core, so the dependency holds across the supported set. The exposure is a candidate on an older Safari that clears `P-02`'s fullscreen and camera gate but renders MathML poorly; nothing in the device check currently tests for it. If that shows up in practice, the fallback is `output: "htmlAndMathml"` with a subsetted, self-hosted `katex.css` loaded inside the same lazy chunk — a change inside this module, not to this decision. Phase 6's "Check my device" button (`C-01`) is the natural place to detect it.
- **The one genuine risk this introduces is budget pressure.** 41 KB of the 300 KB candidate budget is spent before Phase 6 writes a line of exam runtime, and Phase 7's proctoring draws on the same budget (the face model is separately excluded at ≤ 3 MB, loaded only for Strict). If Phase 6 measures the candidate bundle approaching the ceiling, re-examine in this order: (1) trim `markdown-it` to the constructs the format actually uses, or replace it with a smaller parser — the question format fixes a small, closed set; (2) lazy-load the Markdown parser as well, so the shell paints before the first question's HTML; (3) only then revisit pre-rendering — and price the stored-HTML XSS surface honestly, because the cost and determinism arguments for it are false and may not be used again.
- Two JSON Schema validators exist in the repository, and this decision does not change that: Ajv in `packages/core`'s tests and in CI, and `@cfworker/json-schema` at runtime in `apps/api`. Ajv compiles validators with `new Function`, which the Workers runtime forbids; `@cfworker/json-schema` does not. Both read the same files in `schemas/`.
