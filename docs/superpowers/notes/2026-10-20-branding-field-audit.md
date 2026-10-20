# Branding: which fields reach a candidate

**2026-10-20 · Phase 6.5a Task 3 · spec §8 `D9` · #186**

`#186` — an organiser's `finish_message` that nothing rendered — was one
instance of a class. This walks every field of `TestBranding`
(`packages/core/src/types.ts:414-432`) and asks the same question of each:
the organiser can set it, but does a candidate ever see it?

"Reads it" means a render on a candidate-facing surface — `apps/web/src/routes/exam.tsx`
or `apps/web/src/components/exam/*`. The builder's own previews
(`BrandingPanel.tsx:276-299`) do **not** count: the organiser is not a candidate.

| Field | Organiser writes it | Candidate-facing reader | Verdict |
| --- | --- | --- | --- |
| `logo` | `BrandingPanel.tsx:131` (file) → `:169` stores the media key; accepted at `apps/api/src/routes/workspaces.ts:53`; carried at `apps/api/src/routes/run.ts:174` → `apps/web/src/lib/run.ts:42` | **none** — `exam.tsx:160-167` records why | **deliberately deferred** |
| `logo_alt` | `BrandingPanel.tsx:153`; carried at `run.ts:175` → `lib/run.ts:43` | **none** — nothing to label while the logo is deferred | **deliberately deferred** (with `logo`) |
| `primary_colour` | `BrandingPanel.tsx:188`; refused below 4.5:1 on cream at `apps/api/src/routes/workspaces.ts:83`; carried at `run.ts:176` → `lib/run.ts:44` | **none** — the only `--brand-primary` painter is `BrandingPanel.tsx:47-53`, consumed only by `styles/testbuilder.css:481,487` | **writer with no reader** |
| `footer_text` | `BrandingPanel.tsx:220`; carried at `run.ts:177` → `lib/run.ts:45` | `exam.tsx:287-288` — **landing page only** | reaches a candidate (partly: see below) |
| `start_message` | `BrandingPanel.tsx:255`; carried at `run.ts:178` → `lib/run.ts:46` | `exam.tsx:183-184` | reaches a candidate |
| `finish_message` | `BrandingPanel.tsx:268`; read at `apps/api/src/run/submit.ts:238`, onto `Receipt.finishMessage` (`submit.ts:267,397` → `lib/run.ts:124`) | `components/exam/Receipt.tsx:101-105` | reaches a candidate — **as of this branch** (`1c77ab7`, `d5494fb`, `a3bcc7a`); it was the `#186` defect before |

## `primary_colour` — the finding

An organiser can type a brand colour, the server validates it against cream
and refuses an unreadable one, the published payload carries it to the
browser, and nothing on a candidate page ever reads it. It is `#186`'s shape
exactly, one field over.

It is **reported, not wired** — a reader is new capability, outside `#186`'s
scope line. Whoever picks it up inherits a standing tension rather than a
blank page: `DESIGN.md` front matter is the only place a colour may be
declared, and `apps/web/test/no-hex-colors.test.ts` enforces that across all
of `apps/web/src` — it bans colour literals *and* `style={` inline styles
outright. A per-workspace colour is by definition a colour that is not in
`DESIGN.md`, so wiring it means the organiser-side dodge
(`BrandingPanel.tsx:47-53` sets `--brand-primary` from a ref effect, never a
`style` attribute) crossing onto the candidate page. That is a design
decision, not an implementation detail. Name it before writing it.

## `footer_text` — partial, worth knowing

It renders on the landing page and nowhere else. The builder previews it on
three surfaces — start page, finish page, released result
(`BrandingPanel.tsx:276-299`) — so an organiser is shown a footer on the
finish page that the finish page does not render. Not a writer with no
reader, but the preview overpromises. Reported, not wired.

## `logo` / `logo_alt` — the deferral and its two constraints

Already known-unread and deliberately so. The two constraints stand:

1. It needs its own **branding-scoped route**. The key is a media key, not a
   URL, and the only route that can serve one today keeps `banks.edit`
   (standing decision 4) — a candidate has no such grant.
2. It must **never ride `layout.media`**. That channel is the attempt's
   question media; a workspace logo is not part of the paper.

`logo_alt` ships with the logo, not before it: alt text for an image nobody
renders labels nothing.
