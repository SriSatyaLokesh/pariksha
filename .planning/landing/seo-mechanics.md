# SEO, AEO, GEO and AIO mechanics for the Pariksha landing page

Researched 2026-10-17 against the worktree at `D:/professional/code/SriSatyaLokesh/pariksha-landing`
(branch `phase-3/landing-page-v2`).

Installed versions this is written against, from `apps/web/package.json` and the root
`package.json`:

| Package | Version |
| --- | --- |
| `react`, `react-dom` | `^19.3.1` |
| `vite` | `^8.3.4` |
| `@vitejs/plugin-react` | `^6.1.2` |
| `wrangler` | `^4.151.1` |
| `vitest` | `^5.0.5` |
| `typescript` | `^6.0.3` |
| Node | `>=22` |

Every item below is a checklist line with a **Verify** line saying how a test asserts it.
Tests go in `apps/web/test/` and run under the existing Vitest project unless stated.

---

## 0. One blocking decision before any of this ships

**There is no canonical origin yet.** `deploy/cloudflare/README.md:24` says the app goes live at
`https://pariksha-web.<your-subdomain>.workers.dev`, and `apps/web/wrangler.jsonc` declares no
`routes`. Canonical, `og:url`, `sitemap.xml`, `robots.txt`'s `Sitemap:` line and `llms.txt` all
need one absolute origin. Pick it now.

- [ ] **0.1** Add a single build-time origin, `VITE_SITE_URL` (or a `SITE_URL` constant in
  `apps/web/scripts/prerender.mjs`), defaulting to the `workers.dev` URL until a domain exists.
  Everything that emits an absolute URL reads that one value.
  **Verify:** a test greps `apps/web/public/`, `apps/web/index.html` and the emitted `dist/` for
  a hard-coded `https://` origin that is not `SITE_URL` and not `github.com`, and fails on a hit.

- [ ] **0.2** When a custom domain is added, set `"workers_dev": false` and `"preview_urls": false`
  in `apps/web/wrangler.jsonc`. Otherwise the same page is reachable on both the custom domain and
  `*.workers.dev`, and versioned preview URLs index as duplicates.
  **Verify:** `apps/web/test/hosting.test.ts` — if `routes` is present in `wrangler.jsonc`, assert
  `workers_dev === false` and `preview_urls === false`.

---

## 1. Build-time prerendering

### 1.1 The problem

`apps/web/index.html` ships `<div id="root"></div>` and a module script. `apps/web/src/main.tsx`
calls `createRoot(...).render(<Landing />)`. Googlebot renders JS and would eventually see the
page; **OAI-SearchBot, ClaudeBot, Claude-SearchBot and PerplexityBot largely do not execute
JavaScript**, so today every answer engine sees an empty div. Prerendering is the entire fix.

### 1.2 Hydrate or no client JS at all

**Recommendation: no client JavaScript on the landing page.** The current
`apps/web/src/routes/landing.tsx` (352 lines) has zero state, zero event handlers and zero effects.
It is a document. Use `renderToStaticMarkup` and ship no `<script>` on `/`.

What that buys:
- No hydration-mismatch class of bug exists at all.
- `script-src 'self'` in `apps/web/public/_headers` is satisfied trivially; nothing to load.
- The page is ~0 KB of JS; LCP is the font and the HTML.

What that costs, honestly:
- **Any interactive element on the new page needs a plan.** Code-block tab switching, a
  "copy to clipboard" button, an accordion. Native-first answers (ponytail ladder rung 4):
  `<details>/<summary>` for disclosure, `:target` or a hidden radio group for tabs, CSS
  `scroll-snap` for carousels. Only `navigator.clipboard.writeText` genuinely needs JS, and that
  is ~15 lines of vanilla in a separate `apps/web/src/copy.ts` entry, not React.
- If a React widget is later unavoidable, you switch `renderToStaticMarkup` →
  `renderToString`, `createRoot` → `hydrateRoot` (React docs are explicit: "Apps using server
  rendering or static generation must call `hydrateRoot` instead of `createRoot`"), and you take
  the mismatch risk back. `renderToStaticMarkup` output is deliberately not hydratable — it omits
  the hydration markers — so this is a real switch, not a flag.
- You lose React's `StrictMode` double-render check on this page, because nothing renders on the
  client. That check only ever ran in dev anyway.

Do **not** use `react-dom/static`'s `prerender` / `prerenderToNodeStream` here. Those exist to wait
on Suspense data before resolving; this page fetches nothing, and `prerenderToNodeStream` would add
stream plumbing for no gain.

### 1.3 Concrete shape

Three files. No new dependency.

**`apps/web/src/entry-prerender.tsx`** (new) — the only thing that imports the landing tree for Node:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "./routes/landing";

export const html = renderToStaticMarkup(<Landing />);
```

**`apps/web/scripts/prerender.mjs`** (new) — runs after `vite build`:

```js
import { build } from "vite";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "dist/.prerender");

// SSR-bundle only the landing tree, so JSX/TS/CSS imports resolve in Node.
await build({
  root: ROOT,
  configFile: resolve(ROOT, "vite.config.ts"),
  logLevel: "warn",
  build: {
    ssr: resolve(ROOT, "src/entry-prerender.tsx"),
    outDir: "dist/.prerender",
    emptyOutDir: false,
    ssrEmitAssets: false,
  },
});

const { html } = await import(pathToFileURL(resolve(OUT, "entry-prerender.js")));

const indexPath = resolve(ROOT, "dist/index.html");
let page = await readFile(indexPath, "utf8");
page = page.replace('<div id="root"></div>', `<div id="root">${html}</div>`);
if (!page.includes("<h1")) throw new Error("prerender produced no markup");
await writeFile(indexPath, page);

await rm(OUT, { recursive: true, force: true });
```

**`apps/web/package.json`** — `"build": "vite build && node scripts/prerender.mjs"`.

The `replace` is a literal string swap against the exact markup in `apps/web/index.html`; the
`includes("<h1")` guard is what fails the build if that string ever drifts. Keep the guard — a
silent no-op replace that ships an empty page is the failure mode this whole task exists to stop.

- [ ] **1.3a** Add `entry-prerender.tsx`, `scripts/prerender.mjs`, and the `build` script change.
  **Verify:** `apps/web/test/prerender.test.ts` runs `vite build` + the script into a temp outDir,
  reads `dist/index.html`, and asserts it contains the `<h1>` text, the word `Pariksha`, and at
  least one `<section` — i.e. the markup a non-JS crawler sees. This is the single most important
  test in the suite; everything else here is garnish.

- [ ] **1.3b** Drop the client entry from `/` if going zero-JS: remove
  `<script type="module" src="/src/main.tsx">` from `apps/web/index.html`.
  **Verify:** a test asserts `dist/index.html` contains no `<script type="module"` and no
  `<script src="/assets/`.

### 1.4 Gotchas with the existing two-entry build — read before touching anything

These are the traps specific to this repo.

**(a) `apps/web/test/bundle.test.ts` breaks if you remove the index script.** It asserts
`vite build` yields entry chunks named `index` *and* `admin`. With no module script in
`index.html`, Vite emits an HTML asset for index but no JS entry chunk called `index`, and the
first assertion fails. Its second assertion — "the candidate entry's module graph contains no
module under `src/routes/admin*`" — also loses its subject.

The fix, and it is the *better* guard, not a weakening: re-point that test at
`src/entry-prerender.tsx`'s module graph, because that bundle is now what produces the shipped HTML.
If admin code leaks into the prerender graph, admin markup reaches the public page — a worse
outcome than a fat bundle. Keep the admin entry assertion for `admin.html` as-is.
**Verify:** the rewritten `bundle.test.ts` builds with `build: { ssr: "src/entry-prerender.tsx",
write: false }` and asserts no module id matches `/src[\\/]routes[\\/]admin/`; a second block
builds the normal two-HTML config and asserts the `admin` entry chunk still exists.

**(b) CSS disappears if you remove the JS entry naively.** `apps/web/src/main.tsx` is what imports
`./styles/base.css` and `./styles/landing.css`; Vite extracts CSS from the JS module graph. No JS
entry, no emitted stylesheet, and the page ships unstyled. Two options:

1. Link the CSS from the HTML entry: `<link rel="stylesheet" href="/src/styles/landing.css">` in
   `apps/web/index.html`. Vite processes and hashes `<link href>` in HTML entries exactly as it
   does scripts. `landing.css` must then `@import` `base.css`, `fonts.css` and `tokens.css`, or
   list all four links.
2. Keep a near-empty JS entry whose only job is the CSS imports. Rejected — it reintroduces a JS
   request to carry a stylesheet.

Take option 1.
**Verify:** assert `dist/index.html` contains a `<link rel="stylesheet" href="/assets/` and that
the referenced file exists in `dist/` and is non-empty. The existing
`apps/web/test/hosting.test.ts` "carries every font face the stylesheet asks for" block already
proves fonts land; this proves the stylesheet itself does.

**(c) Vite 8 input key.** `apps/web/vite.config.ts` uses `build.rollupOptions.input`. Vite 8's own
v8.0.10 docs show `build.rolldownOptions.input` for multi-page entries. `rollupOptions` is still
honoured as the compatibility alias, and `bundle.test.ts` currently passes with it, so do not churn
it — but if a Vite minor ever drops the alias, the two-entry build silently collapses to one.
**Verify:** `bundle.test.ts`'s existing "produces separate entry chunks for index.html and
admin.html" assertion is exactly this canary. Leave it in place for `admin.html`.

**(d) `vite.config.ts` is imported by `hosting.test.ts`.** Any plugin you add to it must be
importable in a jsdom Vitest environment without side effects. That is another reason the prerender
lives in a standalone script rather than a `closeBundle` plugin hook. Keep it out of the config.

**(e) Do not reach for `server.ssrLoadModule`.** Vite 6+ deprecated it in favour of the Environment
API module runner, and relying on it in Vite 8 is a maintenance bet with no upside here. A plain
`build({ build: { ssr } })` call is stable, boring and three lines.

**(f) `admin.html` must stay out of the index.** It is a real reachable URL (`/admin.html`) that
renders "The organiser application arrives with sign-in."
- [ ] Add `<meta name="robots" content="noindex, nofollow">` to `apps/web/admin.html`.
- [ ] Add to `apps/web/public/_headers`:
  ```
  /admin.html
    X-Robots-Tag: noindex
  ```
  **Verify:** `hosting.test.ts` asserts `_headers` contains an `/admin.html` block with
  `X-Robots-Tag: noindex`, and that `admin.html` contains `name="robots"` with `noindex`.
  Note the existing assertion `expect(headers).not.toMatch(/https?:\/\//)` — never put an absolute
  URL in `_headers` (so: no `Link:` header for JSON-LD, see §2.7).

---

## 2. Structured data

### 2.1 What Google actually consumes, October 2026

Fetched from Google's own
[search gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery)
on 2026-10-17. It lists 25 features. **`FAQPage` and `HowTo` are not among them.**
Present and relevant here: **Software app**, **Organization**, **Breadcrumb**.

| Type | Status | Ship it? |
| --- | --- | --- |
| `SoftwareApplication` | Supported ("Software app") | **Yes** |
| `SoftwareSourceCode` | No Google rich result, ever | **Yes** — for entity/AI understanding, not for Google |
| `Organization` | Supported | **Yes** |
| `WebSite` | Powers Google's *site name* feature | **Yes** — this is how "Pariksha" shows as the site name |
| `FAQPage` | **Rich result dropped 7 May 2026** | Optional, ~10 lines, zero Google value |
| `HowTo` | **Dead.** Desktop retired Sept 2023, gone from every surface | **No** |
| `BreadcrumbList` | Desktop-only since Jan 2025, removed from mobile | **No** — it is a one-page site |
| `SearchAction` / sitelinks searchbox | Deprecated Nov 2024, docs removed | **No** |

Sources: Google's gallery (above);
[Search Engine Land on the FAQ drop](https://searchengineland.com/google-to-no-longer-support-faq-rich-results-476957);
[Search Engine Journal](https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/);
[Schema App on the sitelinks searchbox deprecation](https://www.schemaapp.com/schema-markup/google-deprecates-sitelinks-search-box/).

Important nuance: the *schema.org types* are not deprecated. `FAQPage` markup left on a page throws
no error, earns no manual action and harms no ranking. It simply renders nothing in Google. Bing and
LLM extractors still parse it. That is the whole case for shipping it, and it is a weak one.

### 2.2 `SoftwareApplication` — and the honesty trap

Google's Software app rich result requires `name` plus **either** `aggregateRating` **or** `offers`.
Pariksha is pre-alpha with no users and no ratings. **Do not invent an `aggregateRating`.** Fabricated
review markup is a structured-data policy violation and a manual-action risk, and it would directly
contradict the pre-alpha honesty the page is built on.

Use `offers` with a genuine zero price:

```json
{
  "@type": "SoftwareApplication",
  "name": "Pariksha",
  "applicationCategory": "BusinessApplication",
  "applicationSubCategory": "Online examination and assessment software",
  "operatingSystem": "Web browser; Docker on Linux; Cloudflare Workers",
  "softwareVersion": "pre-alpha",
  "releaseNotes": "Pre-alpha. The product requirements, the open question and test JSON formats, their JSON Schemas and a worked example are published. The application lands with v0.1.",
  "license": "https://www.apache.org/licenses/LICENSE-2.0",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "url": "SITE_URL/",
  "sameAs": "https://github.com/SriSatyaLokesh/pariksha"
}
```

- [ ] **2.2** Ship it with `offers`, never `aggregateRating`.
  **Verify:** a test parses every `application/ld+json` block in `dist/index.html` and asserts no
  node anywhere in the graph has an `aggregateRating`, `ratingValue` or `review` key. This is a
  permanent guard against someone adding fake social proof later.

### 2.3 `SoftwareSourceCode` — the type that is actually true

No Google rich result. Worth it anyway: it is the accurate description of what the repo *is* today,
and answer engines read JSON-LD as a structured fact source.

```json
{
  "@type": "SoftwareSourceCode",
  "name": "Pariksha",
  "codeRepository": "https://github.com/SriSatyaLokesh/pariksha",
  "programmingLanguage": ["TypeScript", "React"],
  "license": "https://www.apache.org/licenses/LICENSE-2.0",
  "runtimePlatform": ["Cloudflare Workers", "Node.js", "Docker"]
}
```

**Verify:** assert `codeRepository` and `license` are present and that `license` is an absolute URL.

### 2.4 `Organization` and `WebSite`

`WebSite` is the one that changes a visible thing: Google's *site name* feature reads
`WebSite.name` / `alternateName` / `url` to decide what to print above the result. Given the
project's name carries Telugu and Devanagari forms, `alternateName` earns its place.

```json
{ "@type": "WebSite", "name": "Pariksha", "alternateName": ["పరీక్ష", "परीक्षा"], "url": "SITE_URL/" }
```

`Organization` needs `name`, `url`, `logo` (an absolute URL to a raster image; the favicon SVG will
not do) and `sameAs` pointing at GitHub. For an unincorporated open-source project, keep it minimal
and true — no `address`, no `contactPoint`, no `foundingDate` you cannot source.

**Verify:** assert `WebSite.name === "Pariksha"` and that `Organization.logo` resolves to a file
that exists in `dist/`.

### 2.5 `FAQPage` — optional, and here is the straight answer

Ship the **visible** FAQ prose. That is what §3 needs regardless. The `FAQPage` JSON-LD on top of it
buys nothing in Google after 7 May 2026 and a small, unmeasured amount in Bing and LLM extraction.

**Ponytail call: skip the JSON-LD, ship the prose.** Add the markup when something measurable asks
for it. If it is added anyway, every `Question` in the markup must appear verbatim on the page —
JSON-LD that does not match visible content is cloaking (§5).

**Verify, if shipped:** a test asserts every `Question.name` string in the JSON-LD also appears in
the rendered `dist/index.html` body text.

### 2.6 Emit shape

One `<script type="application/ld+json">` in `apps/web/index.html` containing a single
`{"@context":"https://schema.org","@graph":[ ... ]}` with the four nodes, cross-linked by `@id`.
One block, not five. `dateModified` is injected by `scripts/prerender.mjs` — the lazy and honest
source is the last commit date touching the page:

```js
const modified = execFileSync("git", ["log", "-1", "--format=%cs", "--", "src", "index.html"],
  { cwd: ROOT, encoding: "utf8" }).trim();
```

**Verify:** a test asserts `dist/index.html` has exactly one `ld+json` block, that it
`JSON.parse`s, that `@context` is `https://schema.org`, and that `dateModified` parses as a date
that is not in the future.

### 2.7 CSP and JSON-LD — check this before shipping

`apps/web/public/_headers` sets `script-src 'self'` with no `'unsafe-inline'`, and
`hosting.test.ts` actively forbids ever adding it. Inline `<script type="application/ld+json">` is a
*data block*, not an executable script — the HTML spec stops processing it before the CSP inline
check, and browsers do not execute it — so in practice it is not blocked. Two things make this safe
to rely on either way:

1. Google, Bing and every LLM extractor read the JSON-LD out of the HTML source or the DOM. They do
   not execute it. Even a CSP violation report would not stop the markup being read.
2. The only possible symptom is console noise.

Do **not** "fix" it by adding `'unsafe-inline'` (the test will fail, correctly) and do not try the
`Link: <...>; rel="alternate"; type="application/ld+json"` HTTP header: Google does not consume it,
and `hosting.test.ts` forbids URLs in `_headers` anyway.

**Verify:** a one-off manual check, not a unit test — serve `dist/` with the production `_headers`
applied and confirm the browser console reports no `securitypolicyviolation` for the ld+json block.
Record the result in this file rather than writing a headless-browser test for it.

---

## 3. Answer engines (AEO) and generative engines (GEO)

### 3.1 The actual gate: can the crawler fetch it, and does it execute JS

Three things decide whether ChatGPT, Claude, Perplexity or Google's AI surfaces can quote this page,
in this order:

1. **The HTML contains the words without JS.** §1. Nothing else matters until this is true.
2. **robots.txt admits the fetching agent.** Each vendor runs separate tokens for *training* and
   for *answering*, and they are independently controlled.
3. **The prose is shaped so a passage can be lifted whole.** §3.4.

### 3.2 The user-agent tokens, from the vendors' own docs

**OpenAI** ([developers.openai.com/api/docs/bots](https://developers.openai.com/api/docs/bots)):

| Token | What it does |
| --- | --- |
| `OAI-SearchBot` | Indexes pages to surface in ChatGPT search. **This is the citation path.** |
| `GPTBot` | Crawls content that may train foundation models |
| `ChatGPT-User` | Fetches a page when a ChatGPT user action asks for it |
| `OAI-AdsBot` | Validates pages submitted as ChatGPT ads |

**Anthropic**
([support.claude.com article 8896518](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)):

| Token | What it does |
| --- | --- |
| `Claude-SearchBot` | Indexes for Claude's search results. **Citation path.** |
| `Claude-User` | Fetches a page a Claude user pointed at |
| `ClaudeBot` | Collects content that may train Claude |

`Claude-Web` and `anthropic-ai` are deprecated tokens; do not reference them.
Anthropic honours the non-standard `Crawl-delay`.

**Perplexity:** `PerplexityBot` (indexing) and `Perplexity-User` (user-initiated fetch).
**Google:** `Googlebot` serves both Search and the AI surfaces; `Google-Extended` is the separate
opt-out token for Gemini training. Blocking `Google-Extended` does **not** remove you from AI
Overviews — those are served from the ordinary Google index. **Common:** `CCBot` (Common Crawl),
`Bingbot` (Bing + Copilot), `Amazonbot`, `meta-externalagent`.

### 3.3 `apps/web/public/robots.txt`

For an Apache-2.0 project that wants to be found and quoted, the answer is: allow everything. There
is nothing to protect and citation is the entire goal. Writing the tokens out explicitly is still
worth the twelve lines — it documents the decision and it makes the test assertable.

```
User-agent: *
Allow: /
Disallow: /admin.html

# Answer and generative engines — explicitly welcome.
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: GPTBot
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /

Sitemap: SITE_URL/sitemap.xml
```

Note: a named `User-agent` group *replaces* the `*` group for that agent, so each named block needs
its own `Disallow: /admin.html` if admin must stay out for them too. Simpler and safer: rely on the
`X-Robots-Tag: noindex` header from §1.4(f), which every compliant agent sees, and keep the named
blocks to a bare `Allow: /`.

- [ ] **3.3** Emit `robots.txt` from `scripts/prerender.mjs` (it needs `SITE_URL`), not as a static
  file in `public/`.
  **Verify:** a test reads `dist/robots.txt` and asserts: each of the eight tokens above appears in
  a `User-agent:` line; no `Disallow: /` on a line of its own anywhere in the file; the `Sitemap:`
  line is an absolute `https://` URL ending `/sitemap.xml`.

### 3.4 `llms.txt` and `llms-full.txt` — what they are and who honours them

`llms.txt` is a proposed convention: a Markdown file at `/llms.txt` giving an LLM a curated index of
a site's most useful pages. `llms-full.txt` is the same idea taken to the extreme — the entire
documentation corpus concatenated into one plain-text file.

**Who honours them, honestly, as of 2026:** no major provider — OpenAI, Google, Anthropic, Meta or
Perplexity — has publicly confirmed that their production answering systems read `llms.txt` from
third-party sites. Measurement is bleak: an Ahrefs study of ~137,000 sites found 97% of `llms.txt`
files received zero traffic in May 2026, and monitoring of 500M+ AI bot visits over 90 days found
only ~408 requests targeting `llms.txt` at all. What *is* real is agent-to-agent use: Google, AWS,
Anthropic, Perplexity, Microsoft and OpenAI all publish their own, OpenAI publishes them for the
Agents SDK, and Anthropic recommends `llms.txt` in its "Writing for Agents" guidance.

Sources: [aisaasradar's 2026 adoption data](https://aisaasradar.com/article/llms-txt-adoption-data-2026),
[limy.ai's 2026 guide](https://limy.ai/blog/llms-txt-in-2026-the-full-guide),
[f9xr on llms.txt and ai.txt in 2026](https://f9xr.org/articles/2026/09/08/llms-txt-ai-txt-do-they-work-2026.html).

**Recommendation:**

- [ ] **3.4a** Ship `llms.txt`. Twelve lines, emitted by the prerender script, costs nothing, and a
  developer-tool audience is exactly the population that points an agent at a repo. It is the one
  case where the convention has demonstrated use.
- [ ] **3.4b** **Skip `llms-full.txt`.** Its content would be `docs/PRD.md`,
  `docs/question-format.md`, `docs/test-format.md` and `examples/`, all of which are already public
  and crawlable on GitHub as raw Markdown — the single most LLM-legible format there is. A
  concatenated copy on the site is duplicate content with a maintenance cost. Add it when the docs
  move off GitHub, or when a docs site exists at `/docs/`.

`llms.txt` content for this project — point at the formats and the worked example, because that is
the material an agent can actually act on:

```markdown
# Pariksha

> Open-source, self-hosted exam platform. Apache-2.0. Pre-alpha as of 2026-10-17: the product
> requirements, the open question and test JSON formats, their JSON Schemas and a complete worked
> example are published and stable enough to write questions against. The application lands with
> v0.1.

## Formats
- [Question format](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/question-format.md): the 12 question types and their JSON
- [Test format](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/test-format.md): timing, sections, pools, scoring, proctoring
- [JSON Schemas](https://github.com/SriSatyaLokesh/pariksha/tree/main/schemas): question-1.json, test-1.json, bank-1.json

## Worked example
- [reasoning-aptitude](https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude): 17 questions covering all 12 types, a test definition, candidate list and results CSV

## Product
- [PRD](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/PRD.md)
- [Roadmap](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/ROADMAP.md)
```

**Verify:** a test asserts `dist/llms.txt` starts with `# Pariksha`, contains the string
`pre-alpha`, contains at least five Markdown links, and that no link is a relative path.

### 3.5 The prose shape that actually gets lifted

Extraction is passage-level, not page-level. AI Overviews retrieve chunks and summarise them, and
cited text is measurably different from ordinary marketing prose: roughly twice as likely to contain
definitive language (36.2% vs 20.3%), and ~44% of citations come from the first 30% of a page.
([Contently, Feb 2026](https://contently.com/2026/02/25/how-to-get-cited-google-ai-overviews/),
[Profound on AI Mode](https://www.tryprofound.com/articles/rank-in-google-ai-mode).)

Concrete rules for the new page:

- [ ] **3.5a Question-shaped `h2`/`h3`.** Not "Formats" but "What does a Pariksha question look
  like in JSON?". Not "Pricing" but "What does it cost to run an exam on Pariksha?". These are the
  literal strings people type.
- [ ] **3.5b Answer-first paragraph.** The 40–60 words immediately under each heading must answer
  the heading completely, before any build-up. That paragraph is the extraction unit.
- [ ] **3.5c Self-contained claims.** Every extractable sentence names its subject: "Pariksha
  supports 12 question types", never "It supports 12 types". A lifted passage carries no context
  with it.
- [ ] **3.5d Tables.** The README's free-tools / paid-vendors / Pariksha comparison table is the
  single most liftable asset the project has. Put it on the page as a real `<table>` with `<th>`
  scope attributes — not a CSS grid of `<div>`s, which extracts as noise.
- [ ] **3.5e Explicit dates and numbers in prose.** "As of October 2026, Pariksha is pre-alpha" beats
  "currently pre-alpha" — the first survives being quoted six months later; the second becomes a lie.
  Same for "12 question types", "three proctoring levels", "under 30 minutes", "Apache-2.0".
- [ ] **3.5f Proper-noun density.** Cited passages run far higher in proper nouns than generic prose.
  Name things: Cloudflare Workers, D1, R2, Docker, SQLite, Postgres, JSON Schema, Apache-2.0.
- [ ] **3.5g Put the definitional paragraph first.** "Pariksha is a free, open-source, self-hosted
  exam platform..." must be in the first screen of HTML — above the hero's decoration in source
  order, not just visually.

**Verify:** a Vitest test over the rendered `Landing` tree that asserts, for every `h2`:
the heading text ends in `?` **or** is in a small allow-list of non-question section labels; and the
first following `<p>` has a word count between 30 and 70. Blunt, but it is the one mechanical proxy
for answer-first writing, and it fails loudly when someone adds a 200-word preamble.
Add a second test asserting the comparison section renders a real `<table>` with `<th scope>`.

---

## 4. The ordinary SEO floor

All of these live in `apps/web/index.html` as static tags (the page is prerendered; there is no
runtime to compute them).

- [ ] **4.1 `<title>`** — unique, ≤ 60 characters, brand first because the brand *is* the query.
  Current: `Pariksha — run real exams on infrastructure you own` (51 chars). Keep it; it is good.
  **Verify:** test asserts `dist/index.html` has exactly one `<title>`, length 15–60, containing
  `Pariksha`.

- [ ] **4.2 `<meta name="description">`** — 110–160 characters. Not a ranking factor; it is the
  click decision and the snippet LLMs often echo. Must carry the pre-alpha fact. Suggested:
  `Open-source, self-hosted exam platform. Question pools, 12 question types, browser proctoring and
  CSV results, at zero hosting cost. Apache-2.0, pre-alpha.` (158 chars.)
  **Verify:** test asserts exactly one description meta, length 110–160.

- [ ] **4.3 `<link rel="canonical" href="SITE_URL/">`** — absolute, trailing slash, matching
  whatever Cloudflare's `html_handling` serves. The default is `auto-trailing-slash`; `/` is the
  root so this is unambiguous, but if any second page is ever added, the canonical and the
  `html_handling` mode must agree or you self-report duplicates.
  **Verify:** test asserts exactly one canonical, that it is absolute `https://`, and that it equals
  `SITE_URL + "/"`.

- [ ] **4.4 Open Graph.** `og:type` (`website`), `og:site_name` (`Pariksha`), `og:title`,
  `og:description`, `og:url` (= canonical), `og:image`, `og:image:width` `1200`,
  `og:image:height` `630`, `og:image:alt`, `og:locale` `en_GB`.
  **Verify:** test asserts all nine are present and that `og:url` equals the canonical href.

- [ ] **4.5 Twitter card.** `twitter:card` = `summary_large_image`, `twitter:title`,
  `twitter:description`, `twitter:image` (absolute), `twitter:image:alt`. No `twitter:site` — the
  project has no account; a dangling handle is worse than none.
  **Verify:** test asserts `twitter:card === "summary_large_image"` and `twitter:image` is absolute.

- [ ] **4.6 The OG image itself.** `apps/web/public/og.png`, **1200 × 630**, PNG, under 5 MB,
  referenced by an **absolute HTTPS URL** (relative `og:image` is the single most common reason
  previews break). Keep the meaningful content — wordmark and one line — inside the centre
  600 × 315, because X, Slack and Discord crop differently. Build it from the DESIGN.md tokens; no
  third-party generator, no runtime image service. A committed PNG is the lazy correct answer here.
  **Verify:** test reads the PNG header bytes from `dist/og.png` and asserts width 1200, height 630
  (the IHDR chunk is at a fixed offset — ~6 lines, no image library).

- [ ] **4.7 `sitemap.xml`.** One URL. Near-pointless for discovery at this size, but it is the
  thing `robots.txt` points at and it is free. Emit from `scripts/prerender.mjs` with a real
  `<lastmod>` from the same git date as §2.6. Omit `<priority>` and `<changefreq>` — Google ignores
  both.
  **Verify:** test asserts `dist/sitemap.xml` parses as XML, has exactly one `<loc>` equal to
  `SITE_URL + "/"`, and a `<lastmod>` matching `^\d{4}-\d{2}-\d{2}$`.

- [ ] **4.8 Favicon and theme colour.** `apps/web/public/favicon.svg` (`<link rel="icon"
  type="image/svg+xml">`), a `favicon.ico` fallback, and `apple-touch-icon.png` at 180 × 180.
  `<meta name="theme-color">` twice with `media="(prefers-color-scheme: light)"` and `dark`, both
  values taken from `apps/web/src/styles/tokens.css` — not hand-typed hex.
  **Verify:** the existing `apps/web/test/no-hex-colors.test.ts` already forbids raw hex outside
  tokens; extend its glob to cover `apps/web/index.html` so a hard-coded `theme-color` fails it.
  A second test asserts each icon href resolves to a file present in `dist/`.

- [ ] **4.9 Heading structure.** Exactly one `h1`, no skipped levels, every `<section>` labelled.
  The current page already does this well (`apps/web/src/components/SectionHeading.tsx` enforces
  `h2` with an `id`, and sections use `aria-labelledby`). Keep that discipline.
  **The h1 must change.** `apps/web/src/components/HeroSection.tsx` currently renders
  `Run real exams on the internet, for free, on infrastructure you own.` with no product name, and
  `apps/web/test/landing.test.tsx` asserts that exact string in the test named
  *"renders exactly one h1 with the hero headline, and the product name on the page"*. The brief
  now requires the name carried prominently in the hero. Make the `h1` contain both — e.g.
  `Pariksha — run real exams on the internet, on infrastructure you own` — and update that test's
  expected string. Flagging it here because it is the one place where this assignment collides with
  a passing test.
  **Verify:** update the existing `landing.test.tsx` assertion, and add a heading-order test:
  collect `h1..h6` in document order from the rendered tree and assert exactly one `h1`, that it
  contains `Pariksha`, and that no level jumps by more than one.

- [ ] **4.10 `<html lang="en-GB">`.** Currently `en`. British spelling is a project rule
  ("organiser", "licence"); the lang attribute should say so.
  **Verify:** test asserts `dist/index.html` matches `<html lang="en-GB"`.

- [ ] **4.11 Search Console without breaking the no-third-party-scripts rule.** Verify ownership by
  DNS TXT record, or by a static HTML file in `apps/web/public/`. Never the `<script>` method. This
  costs nothing, adds no runtime dependency and is the only way to see whether any of this worked.
  **Verify:** manual; note the chosen method in `deploy/cloudflare/README.md`.

- [ ] **4.12 HTML caching.** Hashed assets already get `max-age=31536000, immutable` in
  `apps/web/public/_headers`. Add an explicit short cache for HTML so a redeploy is visible:
  ```
  /index.html
    Cache-Control: public, max-age=0, must-revalidate
  ```
  **Verify:** `hosting.test.ts` asserts an `/index.html` block exists with `max-age=0`.

- [ ] **4.13 `not_found_handling`.** `apps/web/wrangler.jsonc` sets neither `html_handling` nor
  `not_found_handling`, so `not_found_handling` defaults to `"none"` — an unstyled 404. Set
  `"not_found_handling": "404-page"` and emit a `dist/404.html` from the prerender script (the same
  shell, a short message, `<meta name="robots" content="noindex">`). Do **not** use
  `"single-page-application"` — it would serve the landing page with HTTP 200 at every bogus URL,
  which is soft-404 spam at scale.
  **Verify:** `hosting.test.ts` asserts `not_found_handling === "404-page"` and that it is not
  `"single-page-application"`; the prerender test asserts `dist/404.html` exists and contains
  `noindex`.

---

## 5. What NOT to do

Each of these is a real penalty or a confirmed waste in 2026.

- [ ] **5.1 Never fabricate `aggregateRating`, `review` or user counts.** Pre-alpha, zero users.
  Fake review markup is a structured-data policy violation with a manual-action path, and it
  contradicts the page's own honesty claim. Guarded by the test in §2.2.

- [ ] **5.2 Do not ship `HowTo` JSON-LD.** Retired from desktop in September 2023 and absent from
  every Google surface as of 2026. It renders nothing. The *prose* "how running an exam works" is
  the valuable part — ship that, skip the markup.

- [ ] **5.3 Do not ship `FAQPage` expecting a rich result.** Dropped 7 May 2026; the Rich Results
  Test drops it June 2026 and the Search Console API drops it August 2026. See §2.5.

- [ ] **5.4 Do not ship `SearchAction` / sitelinks searchbox markup.** Retired November 2024,
  documentation removed. It earns nothing.

- [ ] **5.5 Do not serve different markup to crawlers than to people.** This is the one that bites
  a prerendering project specifically. The prerender must render the *same* `Landing` component the
  browser would. No "SEO text" block hidden with `display:none`, no keyword paragraph visible only
  in the prerendered HTML. That is cloaking plus hidden text — both explicit spam policies, both
  enforced at domain level, not page level.

- [ ] **5.6 No keyword stuffing.** "Online exam software" repeated through headings and alt text is
  a detectable semantic pattern in 2026, not a ranking input. Write the sentence a person would
  write. ([Google's June 2026 spam update](https://cliquestudios.com/university/resources/google-june-2026-spam-update)
  targets exactly content-level tactics: scaled content abuse, cloaking, keyword stuffing.)

- [ ] **5.7 No scaled comparison pages.** Do not generate `/vs/pariksha-mettl`,
  `/vs/pariksha-hackerearth`, `/vs/pariksha-testlify` from a template. Mass-produced near-duplicate
  pages are scaled content abuse — Google's most aggressively enforced policy since 2024. One
  honest comparison table on one page is worth more than twenty spun pages, and it is what gets
  extracted anyway (§3.5d).

- [ ] **5.8 No `<meta name="keywords">`.** Ignored by every engine for over a decade.

- [ ] **5.9 Do not block AI training crawlers if citation is the goal.** For an Apache-2.0 project
  seeking adoption there is no asset to protect. Blocking `GPTBot` or `ClaudeBot` removes you from
  future model knowledge for no gain. (Note that blocking `Google-Extended` does not remove you
  from AI Overviews either way — those serve from the ordinary index.)

- [ ] **5.10 Do not add a third-party script for any of this.** No analytics snippet, no tag
  manager, no font CDN, no OG-image service, no schema plugin. `apps/web/public/_headers` pins
  `default-src 'self'` and `hosting.test.ts` fails on any `https?://` appearing in that file, by
  design. Search Console verification goes by DNS TXT or a static file (§4.11).

- [ ] **5.11 Do not leave the page client-rendered "because Googlebot runs JS".** It does; the
  engines that would quote this project mostly do not. Shipping a `<div id="root">` to
  `OAI-SearchBot` and `Claude-SearchBot` is a guaranteed zero.

- [ ] **5.12 Do not claim the app ships today in any meta tag, JSON-LD field, OG description or
  `llms.txt` line.** These are the strings that get lifted verbatim into an answer and repeated for
  months. Every one of them carries "pre-alpha" and a date.
  **Verify:** a test asserts the words `pre-alpha` appear in the meta description, in the
  `SoftwareApplication.releaseNotes`, and in `dist/llms.txt`.

---

## Implementation order

1. §1.3 prerendering + §1.4(a) `bundle.test.ts` rewrite + §1.4(b) CSS link. Nothing else matters
   until a non-JS fetch of `/` returns the page text.
2. §0.1 `SITE_URL`, then §4.1–4.5, §4.9–4.10 head tags.
3. §3.3 `robots.txt`, §4.7 `sitemap.xml`, §1.4(f) admin noindex, §4.13 `404.html`.
4. §2 JSON-LD graph.
5. §4.6 OG image, §4.8 icons.
6. §3.4 `llms.txt`, §4.11 Search Console.
7. §3.5 is not a step — it is a constraint on every line of copy written in the rebuild.

## Sources

- [Google structured data search gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery) (fetched 2026-10-17)
- [Search Engine Land — Google to no longer support FAQ rich results](https://searchengineland.com/google-to-no-longer-support-faq-rich-results-476957)
- [Search Engine Journal — Google drops FAQ rich results](https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/)
- [Schema App — sitelinks search box deprecation](https://www.schemaapp.com/schema-markup/google-deprecates-sitelinks-search-box/)
- [OpenAI — bots and crawlers](https://developers.openai.com/api/docs/bots)
- [Anthropic — does Anthropic crawl data from the web](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
- [Cloudflare Workers static assets — html_handling and not_found_handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/) (via ctx7)
- [Cloudflare Workers — migrating `_headers` and `_redirects` from Pages](https://developers.cloudflare.com/workers/static-assets/headers/) (via ctx7)
- [Vite v8.0.10 — multi-page entries and SSR pre-rendering](https://github.com/vitejs/vite/blob/v8.0.10/docs/guide/ssr.md) (via ctx7)
- [React — `hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot), [`prerender`](https://react.dev/reference/react-dom/static/prerender) (via ctx7)
- [Contently — how to get cited in Google AI Overviews, Feb 2026](https://contently.com/2026/02/25/how-to-get-cited-google-ai-overviews/)
- [Profound — Google AI Mode citations](https://www.tryprofound.com/articles/rank-in-google-ai-mode)
- [aisaasradar — llms.txt adoption data 2026](https://aisaasradar.com/article/llms-txt-adoption-data-2026)
- [f9xr — llms.txt and ai.txt in 2026](https://f9xr.org/articles/2026/09/08/llms-txt-ai-txt-do-they-work-2026.html)
- [Clique Studios — Google June 2026 spam update](https://cliquestudios.com/university/resources/google-june-2026-spam-update)
