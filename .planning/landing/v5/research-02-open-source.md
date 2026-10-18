# Research: How open-source / self-hosted software markets itself

Research pass for the Pariksha homepage rewrite. Context: Pariksha is free,
open-source (Apache-2.0), self-hosted only — no hosted SaaS — and pre-alpha
(question/test formats, JSON Schemas, a worked example and the scoring engine
are built and tested; authoring UI, candidate runtime, proctoring and results
are specified but not built). Buyers are non-engineers (college placement
cells, training institutes, small companies) plus the OSS contributors we
need. This document surveys how comparable OSS/self-hosted projects solve the
same problem: sell to non-engineers, stay credible with developers, and (for
a handful) stay honest about being early without looking unfinished.

All data fetched **2026-10-19** via WebFetch/WebSearch against live pages,
cross-checked against the GitHub API and WebSearch for star counts/licenses
where the homepage itself didn't show them. Every claim below is either a
verbatim quote from a fetched page (marked as such), a paraphrase of fetched
content, or explicitly marked **NOT RETRIEVED** / **SECONDARY SOURCE**. Where
a quote could not be independently pixel-verified (JS-rendered page, fetched
through a summarizing tool), that is flagged inline. Nothing below is
invented.

---

## 1. One-page summary

### The modal OSS homepage spine

Across all 31 sites researched, the same nine-band skeleton recurs, in this
order, with individual sites skipping or merging bands but almost none
reordering them:

1. **Nav** — product name, Docs link, Pricing, GitHub icon/link, primary CTA button (top-right)
2. **Hero** — H1 (outcome or category claim, rarely the product name alone) + one-sentence subhead + primary CTA (almost always the *paid/cloud/signup* path) + secondary CTA (often self-host, docs, or demo)
3. **Social proof strip** — customer logos, "Trusted by X companies," or GitHub star count — placed immediately under the hero, functioning as the first piece of evidence before any feature claim
4. **How it works / 3-step flow** — a simplified mental model (connect → configure → use)
5. **Feature grid or deep-dive sections** — each with its own mini-headline, usually 4-10 cards or bands
6. **Deployment/hosting section** — "runs where you decide," self-host vs cloud, often named as its own band mid-page rather than in the hero
7. **Testimonials / case studies** — named people and companies, often with a quantified outcome ("cut load time from 6s to 1-2s")
8. **Comparison or "why us" section** — vs. the proprietary incumbent, inline or linked out
9. **Final CTA band + footer** — repeats the primary CTA, then a dense footer carrying every developer-credibility link (GitHub, license, Discord, changelog, docs) that didn't make the hero

The single most consistent pattern: **developer-credibility devices (GitHub
stars, license text, Discord, terminal commands) are usually NOT in the
hero.** They live in the nav, the social-proof strip right under the hero, or
the footer. The hero itself is almost always outcome-copy aimed at a buyer,
not a developer — even on projects that are nothing but a dev tool (Cal.com,
Typesense, n8n, Infisical all lead with a business/outcome H1, not "open
source X").

### The 6 most-copied moves

1. **Self-host and cloud are framed as two buttons, not a hero sentence.**
   The strongest version of this is a literal two-CTA hero: Hoppscotch
   ("Get Started on Cloud" / "Self-Host from GitHub"), Coolify ("Start with
   Cloud" / "Self-host for free"), Outline ("Cloud hosted, 30-day free
   trial" / "Deploy on-premises"), Formbricks ("Get started free" /
   "Deploy Formbricks"). This is copyable by Pariksha even with *no* cloud
   offering — just replace one button with a different self-host path (Docker
   vs. manual install), or drop the pairing and make self-host the only CTA
   the way BookStack does.

2. **GitHub stars (or an equivalent count) sit directly under the hero, not
   in it.** Outline: "40k GitHub stars" in the hero social-proof strip.
   n8n: a live-templated star counter plus "4.7/5 on G2" plus "200k+
   community members" in a "Credentials" band right after the hero. Novu:
   a "40.2k" badge next to a hero code block. Dify: "158K+ stars" badge in
   hero. This is a **non-starter for Pariksha pre-alpha** (no stars to show)
   — but it confirms the pattern: lead with *some* count. Pariksha's
   equivalent proof points are concrete and testable things: "scoring engine:
   100% test coverage," "JSON Schema validated," a worked example anyone can
   run.

3. **One short, outcome-only subhead sentence, never a feature list.**
   Every H1+subhead pair researched is one sentence each. The subhead names
   who it's for and the single biggest promise (Cal.com: "...for
   individuals, businesses taking calls and developers building scheduling
   platforms"; Directus: "Connect any database. Get instant APIs, a no-code
   interface..."). None lead with a JSON snippet or a technical
   architecture diagram in the hero — the current Pariksha page's biggest
   sin (JSON in the hero) has zero precedent among 31 sites surveyed.

4. **Self-hosting is framed as a *feature with a benefit*, never an
   apology.** The copy pattern is "you own your data / your infrastructure /
   your compliance," not "sorry, no cloud yet." Nextcloud: "Keep your data
   on servers you own, at all times." Zulip: "full data sovereignty."
   Infisical: "The core platform is open source under the MIT license and
   can be self-hosted." None of these frame self-host-only as a limitation —
   they frame it as the reason to choose the product.

5. **A named, mid-page "deployment" or "how it works" band, separate from
   the hero and separate from features.** n8n's "Runs where you decide"
   section and Metabase's dual bottom-CTA ("Try Metabase Cloud free" /
   "Deploy Metabase Open Source") show that the self-host story deserves its
   own single-purpose section, not a footnote buried in a feature list.

6. **Comparison-to-incumbent is a dedicated, confidently-argued page (or
   section), not a chart buried in the footer.** Plausible vs Google
   Analytics, Cal.com vs Calendly, Umami vs Google Analytics all read as
   persuasion essays with a feature table, a migration incentive where
   relevant, and — critically — at least one line conceding where the
   incumbent is still better (Plausible's GA4 page has a "What GA4 does
   better" section). Confidence, not score-settling, is the house style.

---

## 2. Per-site quick-reference table

Quotes below are from the live homepage unless noted. "—" = not a single
distinguishable CTA in that slot (e.g. auth buttons instead of a hero CTA).
NR = NOT RETRIEVED.

| Site | H1 (verbatim) | Subhead (verbatim) | Primary CTA | Secondary CTA | Free-framing (exact phrase) |
|---|---|---|---|---|---|
| **Supabase** | "Supabase" (brand as H1) | "Build in a weekend. Scale to millions." | NR | NR | "Free - from $0/month"; self-host via Docker/CLI, "free" per pricing FAQ |
| **PostHog** | "PostHog - your product's context layer" | NR | "Get started – free" | "Talk to a human" (low confidence) | "97% of users pay us $0" (secondary-confidence); self-host "officially unsupported" |
| **Appwrite** | "The open-source cloud for agents & devs" | "Appwrite is an MCP & agent-first, OSS platform for building and scaling apps at the speed of thought." | "Start project" | "View docs" | No explicit free line on homepage; Cloud-tier pricing page, self-host via Docker (BSD-3-Clause) |
| **Directus** | "The backend for your whole team." | "Connect any database. Get instant APIs, a no-code interface, and a native MCP server for your headless CMS." | "Start Building" | "Get a Demo" | "Self-host free with one install. No credit card required." |
| **Metabase** | "Open source AI analytics you can verify" | "Metabase gives you answers guided by your semantic layer... Inspect the query behind every answer." | "Try Metabase Cloud free" | "Deploy Metabase Open Source" | "Always open source — Run the script to spin up your free, self-hosted instance in minutes." |
| **Grafana** | "AI for observability. Observability for AI. One platform for both." | "Full-stack observability with Grafana Cloud" | "Get started free" | "Compare plans" | "The Free Forever plan"; self-managed OSS "can be used for free" |
| **Cal.com** | "The better way to schedule your meetings" | "A fully customizable scheduling software for individuals, businesses taking calls and developers building scheduling platforms where users meet users." | "Sign up with Google" | "Sign up with email" | "Cal.com's free plan includes unlimited event types, calendar syncing, workflow automation, Stripe payments, and Cal Video..." |
| **n8n** | "AI agents and workflows you can see and control" | "Build visually, go deep with code, connect to anything... Deploy on your infrastructure or ours." | "Get started for free" | "Talk to sales" | Primary CTA itself is the pricing pitch; "fair-code" Sustainable Use License named explicitly |
| **Formbricks** | "The Open Source Experience Management Platform" (gradient-highlighted "Open Source") | "A privacy-first Experience Management suite built on the largest open source survey platform worldwide." | "Get started free" | "Deploy Formbricks" (→ self-hosting docs) | "Get started free" + "No credit card required"; paid tier named only as "Enterprise License" |
| **Typesense** | "Lightning Fast, Open Source Search" | "Cutting-edge, in-memory search engine for mere mortals. Knowledge of rocket science optional." | "Quick Start" (→ self-host) | "Typesense Cloud" | No pricing section on homepage; schema.org metadata marks self-hosted product `price: 0` |
| **Plausible** | "Easy to use and privacy-friendly Google Analytics alternative" | "Plausible is powerful, lightweight analytics. No cookies, just insights. Made and hosted in the EU..." | "Start free trial" | "View live demo" | "30-day free trial · No credit card required" (cloud); self-host = AGPLv3, free, on a separate page |
| **Umami** | "Open-source web and product analytics" | "The complete picture of your website" | "Get started for free" | "Log in" / "Sign up" (header) | "Umami is open source under the MIT license, so self-hosting is completely free." |
| **Ghost** | "Turn your audience into a business." | "Ghost is a powerful app for professional publishers to create, share, and grow a business around their content." | "Try Ghost completely free for 14 days →" | "Get Started — free" | 14-day trial framing (cloud); self-host = "open source, independent" (footer) |
| **Hoppscotch** | "Make Better APIs" (hoppscotch.com; hoppscotch.io body NOT RETRIEVED — JS SPA) | "Trusted by millions of developers to build, test and share APIs." | "Get Started on Cloud" | "Self-Host from GitHub" | NR on-page; self-host positioned as the named alternative to Cloud |
| **NocoDB** | "Build Databases As Spreadsheets : No-Coding Required" | "NocoDB allows building no-code database solutions with ease of spreadsheets." | "Get Started" | "Contact Sales" | "Start for Free"; no self-host/cloud split stated explicitly |
| **Budibase** | "Save weeks building agents, apps, and automations" | "Automate workflows, handle requests, build internal tools, and connect your business systems - with your own data, LLMs, and APIs." | "Try it free" | "Contact sales" | "Budibase is open-source. Self-host or let us manage everything via Budibase Cloud." |
| **Rowy** | "Low-code backend" | "Manage your database on a spreadsheet-UI and build powerful backend cloud functions... Start like no-code, extend with code." | "Build your app" | "Live playground" | NR; no self-host/cloud toggle (runs on user's own cloud project) |
| **Infisical** | "Infisical" (brand as H1) | "Infisical is security infrastructure for developers and AI agents." | "Talk to an expert" | "Talk to a human" | "The open-source core is free forever under MIT if you self-host." |
| **Novu** | "Connect your AI agents and products to customers" | "Open-source infrastructure to notify your users and let your agents talk with them, on the channels they already use." | "Get Started" | "Visit Docs" | "Start for free"; self-host framed as "Deploy in your own infrastructure" |
| **Twenty CRM** | "Build your Enterprise CRM at AI Speed" | "Twenty gives technical teams the building blocks for a custom CRM that meets complex business needs and quickly adapts as the business evolves." | "Get started" | "Talk to us" | "You can self-host to fully own your infrastructure, or run it on our managed cloud for a zero-ops setup." |
| **Medusa** | "Open-Source Agentic Commerce" | "Build and operate your commerce stack with agents" | "Start for free" | "Contact sales" | "Starts from $29. Cancel anytime." (Cloud); self-host implied by "Open-Source" H1, not detailed on page |
| **Documenso** | "Enterprise-Grade E-Signatures. For Everyone." | "Fully compliant signatures out of the box. Ready to use or ready to be built upon." | "Get Started" | "Check out the Platform Plan" | No explicit "free" line on homepage; "Hosted by You or Hosted by Us" choice stated below the fold |
| **Zulip** | "Organized chat for distributed teams" | "Designed for async conversations." | "See how we use Zulip" | "Create an organization" | "Free or highly-discounted plans are available for most non-business uses." |
| **Dify** | "The Platform for Production-Ready Agentic Workflows." | "Build Agentic workflows, RAG pipelines... Deploy on cloud, VPC, or self-hosted, so teams move from prototype to production without rebuilding the stack." | "Get Started" | "Contact Sales" | No explicit "free" word on page; three tiers: Dify Cloud / Dify Enterprise / Community Edition (self-host Docker) |
| **Langfuse** | "Langfuse" (brand as H1) | "Langfuse is an open-source AI engineering platform for agent evaluation and observability..." | "Start free" | "Documentation" / "Watch demo" | "self-hosting is completely free. The entire codebase is open source under the MIT license." |
| **Coolify** | "Self-hosting with superpowers." | "An open-source and self-hostable alternative to Vercel, Heroku, Netlify and Railway..." | "Start with Cloud" | "Self-host for free" | "Open source and free forever." |
| **Outline** | "Your team's knowledge base" | "Lost in a mess of Docs?...It's time to get your team's knowledge organized." | "Get started for free →" | "Deploy on-premises" | "Get started for free" + "Cloud hosted, 30-day free trial" vs. self-hosted (implicitly free) |
| **Mattermost** | "Sovereign Operations & AI for Critical Infrastructure and National Security." | "Zero-trust collaboration, automation and AI in private cloud, self-hosted, and air-gapped environments..." | "Talk to an expert" | "Explore the platform" | No pricing on homepage; links to separate pricing page |
| **Rocket.Chat** | "Secure CommsOS® – Interoperable by design. Governed by you." | "Agencies, allies, and partners rarely run the same system. Collaborate anyway..." | "Talk to sales" | "Watch video" | "Deploy a free self-managed workspace" CTA further down page |
| **Jitsi** | "More secure, more flexible, and completely free video conferencing." | No distinct subhead sentence | "See it in Action! Start a Meeting" | "Learn more" | "completely free" is baked directly into the H1 |
| **BookStack** | "Simple & Free Wiki Software" | "BookStack is a simple, self-hosted, easy-to-use platform for organising and storing information." | "Source" / "Demo" / "Install" (three parallel buttons) | "Open demo site" | "BookStack is fully free and open, MIT licensed." No cost to self-host. |
| **Nextcloud** | "Regain control over your data" | "The better Microsoft 365 for private clouds." | "Discover Nextcloud" | "Nextcloud Hub 26 Summer. Watch what's new" | No price shown; "Get a quote" (sales-led, enterprise model, not self-serve) |

---

## 3. Per-site detail (items 3–8)

> Format per site: self-host/cloud framing and placement · developer-credibility
> devices (and whether above the fold) · non-engineer persuasion devices ·
> early-stage framing (where applicable) · comparison pages (where found).
> Grouped by cluster for readability. Fetch date 2026-10-19 for all.

### Core infra (Supabase, PostHog, Appwrite, Directus, Metabase, Grafana)

**Supabase** (supabase.com; supabase.com/docs/guides/self-hosting; supabase.com/pricing)
- Self-host/cloud: hero leads 100% with cloud ("Build in a weekend. Scale to
  millions."); self-host is one supporting bullet mid-page under "Key
  Differentiators" ("Open source: all core tools are open source and
  self-hostable"). Full self-host treatment lives on a **separate docs page**,
  which explicitly warns the local CLI stack "is not hardened for production
  and must not be exposed to external traffic."
- Dev-credibility: terminal commands shown (`npx skills add supabase/agent-skills`,
  `npm install supabase --save-dev`, `npx supabase login`); GitHub repo link;
  docs link in nav. No star badge found on homepage. License (Apache 2.0) —
  SECONDARY SOURCE, not shown as on-page text.
- Non-engineer persuasion: none beyond the tagline — no customer logos or
  use-case sections surfaced on the homepage itself.
- Early-stage framing: none (mature product).
- Comparison pages: not found on homepage.

**PostHog** (posthog.com; posthog.com/docs/self-host; posthog.com/pricing)
- Self-host/cloud: **self-hosting is actively discouraged**, the most
  explicit anti-self-host stance of all 31 sites. Verbatim from the docs
  page: "PostHog Cloud is far and away the best experience for the vast
  majority of our users." Self-hosted deployments are "officially
  unsupported" and "We don't offer customer support for product,
  infrastructure, or other questions for self-hosted instances." All
  paid-plan features are Cloud-only. This framing is confined to a separate
  docs page — the marketing homepage doesn't mention self-hosting at all.
- Dev-credibility: Docs and "Community" nav links; no star badge, no
  terminal command surfaced on the homepage. License (MIT) stated only on the
  self-host docs page, not the homepage.
- Non-engineer persuasion: screenshots (named internally "Hogzilla,"
  "Monopoly," "Office," "Hedge"); no customer logos surfaced in this fetch.
- Early-stage framing: none — note PostHog previously sunset Helm/K8s
  self-host support (2023, SECONDARY SOURCE), a maturity/support-scope
  signal rather than an early-stage one.
- Comparison pages: not found in this pass.

**Appwrite** (appwrite.io)
- Self-host/cloud: open-source is baked into the H1 itself ("The open-source
  cloud for agents & devs"), but the primary CTA ("Start project") routes to
  Cloud signup. Self-hosting is mentioned once, mid-page, under a
  data-migration feature ("Move data from third parties or between Cloud
  and self-hosted environments").
- Dev-credibility — **above the fold**: GitHub star count in top nav
  ("57.7K"); docs link in nav. Below fold: "57K+ GitHub stars," "24K+
  Discord members," "300K+ Cloud projects," "500K+ Developers," "Source
  code" link, "Community" footer link. No terminal one-liner found. License
  (BSD-3-Clause) — SECONDARY SOURCE, not shown as text on-page.
- Non-engineer persuasion: customer quote (Ryan O'Connor, Founder);
  console UI screenshots; "AI Arena" benchmark table; named use case
  ("Query Postgres, chart traffic, and ship a campaign").
- Early-stage framing: "New" badge on the Firewall product; banner
  "Breaking: We're thrilled to announce Appwrite 2.0" — a version
  announcement, not an early/pre-1.0 framing.
- Comparison pages: "Appwrite vs. Firebase," "Appwrite vs. Supabase" linked.

**Directus** (directus.com)
- Self-host/cloud: stated fairly prominently in the value-proposition
  section (mid-page, not hero): "Self-host on your own infrastructure or
  deploy to Directus Cloud. Have a full backend up and running in minutes."
  Reinforced near the bottom CTA band: "Self-host free with one install. No
  credit card required."
- Dev-credibility — **above the fold**: terminal command
  `npx directus-template-cli@latest init` (appears twice); docs link in nav.
  Below fold: GitHub star count displayed (exact figure not captured),
  GitHub + "Contributing" links in footer, community.directus.io link. No
  Discord link captured. License — Business Source License (BSL) 1.1 with a
  permissive "free if <$5M revenue/funding" use grant — SECONDARY SOURCE,
  sources disagree on the exact post-conversion license.
- Non-engineer persuasion: customer logos (Club Med, Tripadvisor, Weber
  Grills, Prusa, Copa Airlines); named use-case sections ("Build websites
  and apps," "Edit content without filing a ticket," "Govern data access,"
  "Connect AI directly"); outcome quotes ("decreased our technical support
  needs 3x," "load times...6 seconds to just 1-2 seconds").
- Early-stage framing: none.
- Comparison pages: footer links vs. Airtable, WordPress, Strapi,
  Contentful, Sanity.

**Metabase** (metabase.com; metabase.com/start/oss/)
- Self-host/cloud: unusually, **open source is the H1 itself** ("Open
  source AI analytics you can verify"), with Cloud positioned as the upsell.
  Hero body: "Always open source — Run the script to spin up your free,
  self-hosted instance in minutes. Ships with AI features. Used by millions
  worldwide." Bottom CTA band offers both paths as equal-weight buttons:
  "Try Metabase Cloud free" vs. "Deploy Metabase Open Source." A dedicated
  `/start/oss/` page exists purely for the self-host path, headlined "Run
  your own free self-hosted Metabase."
- Dev-credibility — **above the fold**: GitHub stars in nav ("49.8k");
  exact Docker command shown: `docker run -d -p 3000:3000 metabase/metabase`;
  docs link in nav; "Discussion" community link (discourse.metabase.com);
  footer `/license` link. License: AGPL for core + separate Commercial
  License for `enterprise/` — SECONDARY SOURCE for the exact text, but a
  license link is visible on-page.
- Non-engineer persuasion: customer logos (Hugging Face, McDonald's,
  Capital One, Mistral AI, Linear, Deutsche Telekom); named use-case
  sections ("Business Intelligence," "Embedded Analytics," "Data Studio");
  named testimonials (Peer Richelsen of Cal.com, Derrick Mar of Pathrise).
- Early-stage framing: none — but note it carries an explicit "new
  version" badge even as a mature product: "New Metabase 64: Security
  hardening, required 2FA, better MCP server..." plus a `/roadmap` nav
  link and a "What's new" changelog link.
- Comparison pages: vs. Tableau, Looker, Looker Studio, Power BI, Superset,
  Omni.

**Grafana** (grafana.com; grafana.com/oss/; grafana.com/grafana/download)
- Self-host/cloud: self-hosting ("self-managed") is a **secondary, mid-page/
  footer path** on the homepage, not the hero message, which leads entirely
  with Cloud. Mid-page band: "Built on open source. Driven by community."
  Self-hosting is housed on fully **separate pages**: `/oss/` (ethos/
  community framing, no install instructions) and `/grafana/download` (the
  actual install page), which frames the choice as "1. Choose an edition /
  2. Choose a version / 3. Choose your platform & installation method,"
  contrasting Enterprise self-managed ("free") vs. "The open-source edition
  of Grafana, driven by the community" (OSS).
- Dev-credibility: no star count or install command visible on the
  homepage itself. On the separate `/oss/` page: per-project GitHub stars
  shown — Grafana 67,563, Loki 25,217, k6 27,339, Prometheus 58,207,
  Pyroscope 10,473. On `/grafana/download`: exact apt/yum/binary install
  commands shown. License: core is widely known as AGPLv3 (SECONDARY
  SOURCE) — the download page links a generic "Grafana Labs License"
  rather than quoting AGPLv3 text inline.
- Non-engineer persuasion: customer logos (Microsoft, NVIDIA, Salesforce,
  BlackRock, Canva, DHL, Anthropic, Bloomberg); named use-case sections;
  named testimonial (BlackRock, Head of Observability).
- Early-stage framing: none.
- Comparison pages: footer links vs. Datadog, Dynatrace, Elasticsearch,
  New Relic, PagerDuty, Splunk.

### Scheduling / automation / forms (Cal.com, n8n, Formbricks, Typesense)

**Cal.com** (cal.com; cal.com/calcom-vs-calendly)
- Self-host/cloud: **not a hero message at all** — self-hosting is buried
  in the footer only ("Self-hosted" → GitHub repo, "Docker" → self-hosting
  quick-start docs). No self-host mention above the fold.
- Dev-credibility: **none above the fold.** No GitHub star badge on-page
  (real count: 49,136 stars, confirmed via GitHub API). No "star us" CTA,
  no code block/terminal command anywhere on the page, no Discord link
  found at all. Docs link in footer. License is a bare "License" link to
  the GitHub LICENSE file, not quoted text.
- Non-engineer persuasion: named testimonials from recognizable developer
  figures (Guillermo Rauch/Vercel, Kent C. Dodds, Ant Wilson/Supabase);
  "Wall of love" section.
- Early-stage framing: none — header links "Cal.com launches v6.9.5."
- **Comparison page detail (cal.com/calcom-vs-calendly):** H1 "Cal.com
  does what others can't"; subhead "Cal.com gives growing teams the
  flexibility Calendly lacks, without forcing you straight into an
  enterprise contract." Notably, **open-source/self-hosting is NOT the
  comparison's pitch** — it argues feature flexibility plus a migration
  incentive ("We'll credit 100% of your current Calendly plan when you
  switch"). Feature table marks Calendly as "Limited" or "*Only on
  enterprise" on custom routing, white-labeling, two-way CRM sync,
  role-based permissions, custom APIs/webhooks, and SSO/SCIM. Tone is
  aggressive/competitive ("Ditch the tool, get the stack").

**n8n** (n8n.io)
- Self-host/cloud: more prominent than Cal.com/Typesense — gets its own
  named mid-page section, "Runs where you decide": "Protect your data by
  deploying on-prem, air-gapped if you need it. Managed cloud when you
  don't." Bullets: "Deploy with Docker," "Access the entire source code on
  Github," "Hosted version also available." Not above the fold, but a
  dedicated band rather than a footer afterthought.
- Dev-credibility — **effectively at/near the fold**: a "Credentials" band
  right under the hero/logo bar shows a live-templated GitHub star count
  (confirmed via raw JSON payload: `[[GITHUB_STARS]]`, read as 207,681 at
  fetch vs. 207,907 live via GitHub API — i.e., genuinely live-pulled, not
  stale), "4.7/5 stars on G2," and "200k+ community members." Discord
  confirmed (discord.gg/n8n); docs and changelog links in nav. License
  named explicitly via a nav dropdown item "Our license" → "fair-code"/
  Sustainable Use License (n8n is the only site researched that names its
  license philosophy by name in primary nav, rather than just linking a
  LICENSE file).
- Non-engineer persuasion: unusually large/prestigious enterprise-logo
  wall (Microsoft, Meta, Mercedes-Benz, Deutsche Telekom); department-
  persona use cases ("IT Ops can...", "Sec Ops can...", "Sales can...");
  named case studies (Huel, Vodafone).
- Early-stage framing: none — presents as mature/enterprise-grade.
- Comparison pages: `/vs/` hub ("n8n alternatives").

**Formbricks** (formbricks.com)
- Self-host/cloud: **surfaced directly in the hero** — the secondary CTA
  button itself, "Deploy Formbricks," links to the self-hosting docs. This
  is as prominent as n8n's dedicated section, arguably more so since it's
  a hero-level button. Reinforced mid-page: "Use our GDPR-compliant Cloud
  or self-host the entire solution," and via a customer quote: "Self-
  hosting makes us faster. Because we work on a project basis with various
  ministries, it is our responsibility to respect their rigorous standards
  for data privacy" (DigitalService case study).
- Dev-credibility: **none of the classic badges appear above the fold** —
  no GitHub star count on-page (real: 13,121 via API), no terminal command,
  no Discord/Slack link found anywhere on the page. The hero's self-host
  CTA itself functions as the credibility signal instead of a star badge.
  Only an "Enterprise License" nav link names licensing (around the paid
  tier, not the OSS core).
- Non-engineer persuasion: 30+ customer logos (Siemens, GitHub, IKEA,
  FlixBus); named case studies with quoted outcomes (DigitalService,
  Borderless Access, Opinodo).
- Early-stage framing: none — "Formbricks 6.0 is here. See what's new"
  (changelog).
- Comparison pages: "vs. Google Forms" (`/google-forms-alternative-open-source`).

**Typesense** (typesense.org)
- Self-host/cloud: self-hosting is the **default/first option** — the
  inverse of Cal.com/n8n's cloud-first framing. The primary hero CTA
  ("Quick Start") routes to self-host install docs; "Typesense Cloud" is
  the secondary CTA. Page `<title>` itself: "Typesense | Open Source
  Alternative to Algolia + Pinecone."
- Dev-credibility — **at/near the fold**: a stats band directly under the
  hero shows "25M Docker Pulls," "10B Typesense Cloud searches/month,"
  "25K GitHub stars" (JS-rendered; real count via API was 27,000 at fetch
  — i.e., this figure is a rounded/stale marketing number, not live-pulled,
  unlike n8n's). Slack community link confirmed (`typesense.link/slack-community`).
  No license statement found anywhere on-page; schema.org metadata marks
  the product `price: "0"`.
- Non-engineer persuasion: skews toward developer-audience proof via scale
  numbers in live demos ("32M songs," "28M books," "1M Linux commits")
  rather than typical outcome copy; customer logos (Codecademy, Logitech,
  BBC Maestro, ElevenLabs).
- Early-stage framing: none — public GitHub Projects roadmap link instead
  of an in-house changelog, reading as "working in the open."
- Comparison pages: inline comparison table vs. Algolia, Elasticsearch,
  Meilisearch, plus linked dedicated pages for each.

### Privacy analytics (Plausible, Umami) + comparison pages

**Plausible** (plausible.io; plausible.io/open-source-website-analytics;
plausible.io/docs/self-hosting; plausible.io/vs-google-analytics)
- Self-host/cloud: **not stated on the homepage at all** (confirmed
  absent across two separate fetches) beyond "Our code is open source
  too, so you're never locked in." The actual split lives on a separate
  marketing page: "Open source does not mean you have to self-host" and
  "Why does Plausible Cloud cost money if the code is open source?" The
  self-hosting docs page distinguishes "Plausible Community Edition (free,
  self-hosted, AGPLv3)" vs. "Plausible Cloud (managed service)," adding:
  "When you self-host, the work we do for cloud customers becomes your
  work." License stated explicitly on that page: "Plausible Community
  Edition is open source under the GNU Affero General Public License
  Version 3 (AGPLv3) or any later version."
- Dev-credibility: **none above the fold, and none anywhere on the
  homepage** — no star badge (GitHub shows 29.5k stars, not surfaced on
  plausible.io), no "star us" CTA, no code block, no explicit "Docs" nav
  item (nested under "Resources"), no Discord link found (community
  appears to route through GitHub Discussions and a forum instead).
- Non-engineer persuasion: "Compare" section on the homepage itself
  linking to 4 competitor comparisons; "Who it's for" (7 use-case cards);
  testimonial section naming Hugging Face, 37signals/Basecamp, Ghost, Moz;
  scale stats ("21k" subscribers, "313B" tracked pageviews, "99.99%"
  uptime).
- Early-stage framing: none found.
- **Comparison page detail (plausible.io/vs-google-analytics):** H1
  "Plausible vs Google Analytics 4 (GA4): What changed and why people are
  switching." Structure: feature table + prose sections per topic ("GA4
  replaced real data with estimated data," "GA4 made accuracy worse, not
  better," "GA4 created legal exposure," "GA4 is built for Google's
  business, not yours," then, notably, "**What GA4 does better**" before
  "Is Plausible right for you?"). Tone: confident, investigative-critique,
  not snarky — and explicitly concedes ground to the competitor before
  closing. Sharpest verbatim lines: "You are no longer looking at what
  happened on your site. You are looking at a blend of what happened and
  what Google's model thinks happened." / "Plausible is open source. Our
  source code is publicly available on GitHub and anyone can audit exactly
  how data is handled." A dedicated "Plausible vs Simple Analytics" page
  was searched for and **not found** (third-party pages exist; no official
  Plausible URL located).

**Umami** (umami.is; umami.is/pricing; umami.is/compare/google-analytics;
umami.is/compare/plausible)
- Self-host/cloud: stated plainly, both on the homepage ("Self-host the
  open-source platform on your own infrastructure, or use Umami Cloud.
  Either way, your data is never sold or shared.") and on pricing ("Umami
  is open-source and can be self-hosted for free. Umami Cloud is our
  managed hosting service that handles infrastructure, updates, and
  maintenance for you.") — tied to a specific feature delta (email reports/
  streaming API are cloud-only; session replay/heatmaps are free when
  self-hosting, per the Plausible-comparison page). Much more direct than
  Plausible's off-homepage approach.
- Dev-credibility — **above the fold**: a "39K" GitHub star badge visible
  directly on the homepage (vs. Plausible's complete absence of one), plus
  a Docs nav link. License (MIT) stated on comparison/docs pages, not the
  homepage itself: "Umami is open source under the MIT license, so
  self-hosting is completely free" / "The MIT license lets you use,
  modify, and embed Umami in commercial products without restriction." A
  dedicated `/community` page lists GitHub, Discord, Twitter, LinkedIn.
- Non-engineer persuasion: "Trusted by thousands of companies" logo
  carousel; use-case-driven mid-page CTAs tied to specific workflows
  (acquisition/behavior/conversion/retention) — reads as more "product-
  analytics for growth teams" than Plausible's simpler "stats page" pitch;
  a comparison hub (`/compare`) listing 13 competitors (GA, Plausible,
  Matomo, Mixpanel, PostHog, Amplitude, etc.).
- Early-stage framing: none found.
- **Comparison page detail (umami.is/compare/google-analytics):** H1
  "Everything you use GA for — without the complexity or surveillance."
  Tone: sales-focused but grounded in concrete numbers ("The Umami
  tracking script is under 2KB — over 20x smaller than Google Analytics")
  rather than Plausible's legal/ethical argument. **Umami vs Plausible
  page** is notably even-handed: "While Plausible excels at simple,
  lightweight analytics..." before listing where Umami wins ("Umami Cloud
  has a free tier; Plausible's cloud starts at $9/month with no free
  plan"). This even-handedness contrasts with Plausible's more one-sided
  framing of Google as an adversary.

### CMS / docs / wiki / collaboration (Ghost, Outline, BookStack, Nextcloud, Documenso, Zulip)

**Ghost** (ghost.org)
- Self-host/cloud: **hosted (Ghost Pro) is the hero message**; self-
  hosting is secondary/developer-facing, confined to the footer "For
  Developers" column and a "Built to last" mid-page mention: "Ghost is
  open source, independent." No self-host vs. cloud comparison above the
  fold.
- Dev-credibility: GitHub "Source code" link — **footer only, not above
  fold**. No star badge, no "star us" CTA, no code block, no terminal
  one-liner, no Discord link surfaced, no on-page license string. Hero is
  100% outcome/business framed.
- Non-engineer persuasion: "$100,000,000+ Revenue earned each year by
  publications running on Ghost, with 0% payment fees"; named case
  studies with numbers (404 Media: 123K members; Tangle: $281K MRR;
  Platformer: 197K members); YCombinator, Kickstarter, Buffer, Unsplash
  logos; comparison pages vs. Substack, BeeHiiv, WordPress, Medium,
  Patreon.
- Early-stage framing: none — "Just launched: Ghost 6.0 →" banner; mature
  framing throughout.

**Outline** (getoutline.com)
- Self-host/cloud: presented as an **explicit, equal, above-the-fold
  binary choice** directly under the hero: "Cloud hosted, 30-day free
  trial" paired with "Deploy on-premises" / "Self-hosted on your own
  server." Repeats again just before the footer. Unusually prominent for
  this category — self-hosting is NOT secondary here.
- Dev-credibility — **above the fold**: "40k GitHub stars" and "10 years
  open source" sit directly in the hero social-proof strip (actual count
  via secondary cross-check: ~40.9k). GitHub link in nav. Below fold:
  "Built in public" / public changelog mention, "Built-in MCP" with docs
  link, "open API" reference. Footer: GitHub, "Discuss" (community),
  Changelog. No code block, no terminal one-liner, no Discord link
  captured.
- Non-engineer persuasion: "2,000+ customers" above the fold; UI
  screenshots (block-menu, comments, Slack composer); comparison-page
  links vs. Confluence, Google Docs, Notion.
- Early-stage framing: none — "Outline is updated with new features and
  fixes regularly, checkout our public changelog to see how things are
  progressing!"

**BookStack** (bookstackapp.com)
- Self-host/cloud: **self-hosting IS the hero message** — no cloud
  alternative exists or is mentioned anywhere on the page. Subhead itself:
  "BookStack is a simple, self-hosted, easy-to-use platform for organising
  and storing information." Reinforced: "There is no cost to downloading
  and installing your own instance."
- Dev-credibility — **above the fold**: "Source" (→ Codeberg, not
  GitHub — the project moved off GitHub) and "Install" both sit as primary
  hero buttons. License stated explicitly: "BookStack is fully free and
  open, MIT licensed." Tech-stack transparency: "PHP, on top of the
  Laravel framework...MySQL." Community links: Codeberg, Discussions,
  Mastodon, YouTube, Reddit. No numeric star badge (no GitHub presence to
  show it from), no terminal/docker one-liner on the homepage itself, no
  Discord.
- Non-engineer persuasion: a notably candid low-cost claim — "can run
  happily on a £2.50 IONOS VPS"; 8 labeled screenshots; sponsor logos (2
  Gold, 9 Bronze); comparison framing vs. Confluence, Microsoft Teams Wiki.
- Early-stage framing: none — "BookStack Release v26.09" plus trailing
  point releases, framed as routine maintenance, not beta language.

**Nextcloud** (nextcloud.com)
- Self-host/cloud: self-hosting is the **structural premise of the whole
  brand**, stated mid-page rather than as a literal hero slogan: "self-
  hosted file storage and sync platform," "Keep your data on servers you
  own, at all times." Download section: "Nextcloud server — For
  self-hosting on your server." There is **no consumer hosted-by-us tier**
  pitched on the homepage (the business model is enterprise support/
  licensing) — "Get a quote" CTAs appear twice instead of a self-serve
  cloud signup.
- Dev-credibility: not emphasized above the fold at all — hero is pure
  outcome/control messaging. "Code on GitHub" link lives in the Community
  nav; no star badge, no code block, no terminal one-liner, no Discord
  visible on the homepage. License (AGPL-3.0-only) — SECONDARY SOURCE, not
  stated verbatim on this homepage.
- Non-engineer persuasion: the most enterprise-logo-heavy homepage
  researched (Deutsche Telekom, Amnesty International, TU Berlin, Serbian
  Parliament, 20+ orgs); named use-case sections (Public Sector,
  Enterprises, Service Providers, Education); dedicated `/compare/`
  competitor page.
- Early-stage framing: none — "Nextcloud Hub 26 Summer. Watch what's new"
  presented as a confident, mature flagship release.

**Documenso** (documenso.com)
- Self-host/cloud: presented as an explicit choice **late in the page**
  (below fold, in the "Why use Documenso?" section), not hero-level:
  "Hosted by You or Hosted by Us — Choose your setup. Clone from our
  repository or use our hosted solution." Also a "Self-Hosted" nav item
  and a dedicated `/self-hosted` page.
- Dev-credibility: an actual JSON API code block mid-page (the only site
  of the six in this cluster with a visible code snippet). Footer links:
  GitHub, "Developer Quickstart," "Documentation," a Docker Hub link, a
  "Design" (design system) link. **Absent**: GitHub star badge, a quoted
  terminal one-liner, a Discord link, an on-page license string. License
  (AGPL-3.0, dual-licensed with a commercial Enterprise Edition) —
  SECONDARY SOURCE. None of the developer signals sit above the fold.
- Non-engineer persuasion: testimonial quotes from named executives
  (Nitin Gupta, COO, Prisma Inc.; Simon Burns, Co-Founder & CEO, Vial
  Inc.); mockup screenshots; **key positioning found in page metadata/
  title: "The Open Source DocuSign Alternative."**
- **Maturity-compensation pattern (most relevant to Pariksha):**
  Documenso is a newer/earlier-stage project and compensates for lacking
  the years/stars its peers have by leading with **compliance badges**
  instead: "21 CFR Part 11 – Status: Compliant," plus linked pages for
  ESIGN Act, UETA, SOC2, and HIPAA (`documen.so/trust`). It is unusually
  candid about being in-progress — two features are labeled "Coming Soon"
  (Template Store, "Get paid") directly on the homepage. An "Open Startup"
  footer link (`./open`) signals radical-transparency positioning (public
  metrics) as an additional trust device in place of brand age.
- Comparison pages: no dedicated "Documenso vs DocuSign" page found in
  this pass, despite the "Open Source DocuSign Alternative" tagline — the
  positioning lives in metadata/title, not a built-out comparison page.

**Zulip** (zulip.com)
- Self-host/cloud: presented as an explicit, equal, **mid-page** choice
  inside "You own your data": "You can self-host Zulip's 100% open-source
  software for full data sovereignty, or start with a convenient cloud
  solution and move any time." Both "Zulip Cloud" and "Self-hosting" exist
  as separate top-nav items too — reinforced in both nav and body copy,
  though not the hero itself.
- Dev-credibility: "100% open-source" claim with a GitHub footer link;
  docs links (install/upgrade) under Resources; a "Community chat" link
  (their own product used as the community channel, not Discord). None of
  these sit above the fold — hero is pure outcome messaging. License
  (Apache 2.0) — SECONDARY SOURCE.
- Non-engineer persuasion: outcome quotes ("absolutely critical to how
  we work"); a sharp competitive dig — issues "resolved within 24 hours"
  (implying Slack/GitHub-Issues alternatives); use-case sections
  (Business, Research, Education, Open-source, Communities, Events); named
  customers (iDrift AS, Rust Language team, Semsee).
- Early-stage framing: none.
- Comparison pages: none found in this pass (competitive framing exists
  in body copy, no dedicated page located).

### Low-code / dev-tool startups (NocoDB, Budibase, Rowy, Infisical, Novu, Hoppscotch, Twenty CRM, Medusa)

**NocoDB** (nocodb.com)
- Self-host/cloud: no explicit side-by-side comparison; only "Bring your
  own database or choose ours!" (appears twice near the top).
- Dev-credibility — **above the fold**: GitHub stars "62,000+"; Docker
  downloads "20+ Million"; community "6,000+"; "Fair Source Ranking: In
  Top 3"; nav Docs link; Discord link. No terminal command/code block in
  hero. No explicit license text retrieved.
- Non-engineer persuasion: customer logos (Accenture, Western Digital,
  Hyundai, Walmart, PwC, Bosch, American Express); "20k+ Airtable bases
  imported" as an implicit Airtable comparison (no dedicated comparison
  page found).
- Early-stage framing: none — leans on scale/maturity metrics ("35,000+
  Organisations," "Top 3" fair-source rank) instead.

**Budibase** (budibase.com)
- Self-host/cloud: "Budibase is open-source. Self-host or let us manage
  everything via Budibase Cloud." — under "Scale with Confidence" /
  "Open-source and self-hosting," mid-page, not above the fold.
- Dev-credibility — **above the fold**: GitHub badge "27.5K" in top nav;
  Docs nav link; Discord community link in nav. No code block/terminal
  command in hero. Footer carries a compliance statement ("ISO 27001
  Certified GDPR Compliant"), not an OSS license string.
- Non-engineer persuasion: customer logos (ARM, Saab, American Express,
  Octopus Energy); quoted outcomes ("Delivery time cut from days to under
  an hour" — Schnellecke; "Mission-critical refugee response delivered at
  national scale" — Bulgarian Government).
- Early-stage framing: an "Agents Beta" label in the product nav menu —
  the AI-agent feature specifically is flagged beta while the **core
  product is marketed as fully mature** ("300K teams"). No version
  numbers, waitlist, or roadmap language beyond that one feature-level
  beta tag.

**Rowy** (rowy.io)
- Self-host/cloud: no explicit toggle — copy emphasizes data staying on
  the user's own cloud project (Firebase/GCP) rather than a Rowy-hosted
  vs. self-hosted choice.
- Dev-credibility — **above the fold**: "⭐️ Star us on GitHub"; "5,000+
  stars | 300+ forks | 4,000+ commits | 500+ pull requests"; nav Docs and
  Discord links. No terminal/code block found. No license statement found.
- Non-engineer persuasion: quotes ("Rowy gives a great experience to
  manage your database and build backend functions fast"); customer logos
  (Rakuten Rewards, Harvard University, Forbes, Uber); named integrations
  (Google Vision, GPT-3, Figma, Webflow).
- **Early-stage framing (notable example):** "Sign up for Rowy 2.0! We're
  gearing up for a brand new way to build backend workflows visually...
  Join our early users cohort" — an explicit waitlist for the next major
  version, while the **current** product's credibility rests entirely on
  raw community-activity counts (stars/forks/commits/PRs) and "Trusted by
  30,000+ developers worldwide," rather than a version number. No
  semantic version (e.g. v0.x) is displayed for the current product.

**Infisical** (infisical.com)
- Self-host/cloud: stated plainly, above the fold, in the opening
  paragraph: "The core platform is open source under the MIT license and
  can be self-hosted. Infisical Cloud is the managed option, with US and
  EU regions."
- Dev-credibility: license stated explicitly and early ("open source under
  the MIT license"); GitHub repo link; docs link; exact terminal commands
  shown (`infisical run -- <command>`, `npx -y @infisical/mcp`). **No
  GitHub star badge or Discord link found anywhere on the homepage** —
  notable, since real star count (SECONDARY SOURCE, ~29.8–30k) is
  comparable to sites that do lead with a badge.
- Non-engineer persuasion: customer logos (Databricks, LG Electronics,
  UPS, Hinge Health, Hugging Face); social-proof metric "More than 10
  billion secrets secured every day"; a "Vault TCO calculator" functioning
  as an implicit comparison tool.
- Early-stage framing: none — credibility leans on named enterprise
  logos and the usage-volume metric rather than star-count or "early
  access" framing.

**Novu** (novu.co)
- Self-host/cloud: stated mid/lower page (not above the fold), under
  "Built for enterprise environments": "Self-hosted: Deploy in your own
  infrastructure or private cloud while keeping full control over your
  data." / "Open source: Build on a transparent, extensible foundation
  backed by an active open-source community."
- Dev-credibility — **above the fold**: a "40.2k" GitHub star badge next
  to a hero code block (React `<Inbox />` component snippet); a section
  titled "Open source, ready in one command" (exact command text NOT
  RETRIEVED). Docs CTA ("Visit Docs") above the fold; Discord link in
  footer (below fold). No explicit license statement text retrieved.
- Non-engineer persuasion: above-fold metric "1.5b messages delivered
  last month"; customer logos (MongoDB, Check Point, Cloud Software
  Group); comparison pages referenced: Novu vs Courier, Knock, MagicBell,
  SuprSend, In-house.
- Early-stage framing: a "New" badge on the "Novu MCP" feature and a
  Roadmap nav link, but **no "public beta," version number, or waitlist
  copy**. The pattern: the star-count badge sits directly above the fold
  next to the hero code block, establishing maturity before any
  roadmap/changelog signal appears further down.

**Hoppscotch** (hoppscotch.io body NOT RETRIEVED — JS SPA shell only
returned the page `<title>`; hoppscotch.com used as the best-available
adjacent/secondary source, flagged as such)
- Self-host/cloud (from hoppscotch.com): the **cleanest, most explicit
  dual-CTA hero of all 31 sites** — "Get Started on Cloud" vs. "Self-Host
  from GitHub," placed directly side by side as the two hero buttons.
- Dev-credibility: "GitHub" nav link above the fold; the "Self-Host from
  GitHub" CTA itself functions as a star-adjacent dev signal, but no
  numeric star badge was captured on-page (SECONDARY SOURCE external
  count: ~79–80k stars). No terminal/code block found on either domain.
  No license string retrieved; footer shows only a copyright notice.
- Non-engineer persuasion: "✦ New: Enterprise Cloud + AI Assistant" badge
  in nav; stat "Hoppscotch processes over 5M+ requests every month";
  generic testimonial quote. No customer logos or comparison pages found
  on this page (external GitHub description positions it as "Open-Source
  Alternative to Postman, Insomnia," but that framing didn't appear on the
  fetched marketing page itself).
- Early-stage framing: none found — the "New" badge is feature-level, not
  a maturity disclosure.

**Twenty CRM** (twenty.com)
- Self-host/cloud: stated only in the FAQ section, below the fold: "You
  can self-host to fully own your infrastructure, or run it on our managed
  cloud for a zero-ops setup."
- Dev-credibility: **"Twenty is the #1 Open Source CRM on GitHub"** used
  as the credibility device **in place of a numeric star badge** — no
  live counter shown on-page, likely deliberate since well-funded
  competitors' exact figures (SECONDARY SOURCE estimates range 45.5k–58.3k
  depending on snapshot) might look small next to the qualitative "#1"
  claim. A TypeScript schema-configuration snippet appears in the hero
  (partially retrieved). Terminal command in the FAQ, below the fold:
  `npx create-twenty-app`. No docs link, Discord link, or license
  statement confirmed above the fold.
- Non-engineer persuasion: a logo strip that **mixes customers with
  investors/VCs** as a single credibility signal — Anthropic, Slack,
  Notion, Stripe, Figma sit alongside Sequoia, Accel, Founders Fund; named
  case studies (W3villa, AC&T, NetZero). No "Twenty vs Salesforce"
  comparison page found, despite the "#1 Open Source CRM" claim and
  Salesforce-replacement positioning being a natural setup for one.
- Early-stage framing: none — for a recently-funded company, the page
  leans entirely on the "#1 Open Source CRM" claim plus VC name-dropping
  and customer logos as its credibility substitute, with zero beta/
  early-access disclaimers anywhere on the page.

**Medusa** (medusajs.com)
- Self-host/cloud: no explicit comparison table; the page foregrounds
  "Medusa Cloud" as the hosted option ("AI tools on Cloud," "Best
  performance," "No hidden fees"); self-hosting is implied by "Open-
  Source" in the H1 but not spelled out as a distinct path on this page.
- Dev-credibility: GitHub and Discord links present in nav/footer but no
  star count displayed on-page; Documentation link in main nav. No
  terminal command or hero code block found. No license statement
  retrieved.
- Non-engineer persuasion: quote from Bob Kinney (EightSleep): "Medusa
  struck the right balance between open source flexibility and solid
  opinionated architecture"; customer logos (EightSleep, Heineken,
  Mitsubishi Motors); named use-case sections (B2C, B2B, B2B AI,
  Configurable products).
- Early-stage framing: none found.

### AI / dev-tool fast-growth (Dify, Langfuse, Coolify) + communication platforms that pivoted away from OSS marketing (Mattermost, Rocket.Chat, Jitsi)

**Dify** (dify.ai)
- Self-host/cloud: stated directly in the hero subhead ("Deploy on cloud,
  VPC, or self-hosted") — **above the fold**. Mid-page expands into three
  named tiers: "Dify Cloud" ("Hosted by Dify"), "Dify Enterprise" ("Self-
  host or run in your VPC"), "Community Edition" ("Self-host with
  Docker").
- Dev-credibility — **above the fold**: "158K+ stars on GitHub" badge in
  the hero (independently cross-checked SECONDARY SOURCE figure:
  ~157,800+, matching closely). Docs and GitHub links in nav/hero.
  License: "Apache-2.0-derivative license." Roadmap link
  (`roadmap.dify.ai/roadmap`) present but not prominent. No terminal
  one-liner or code block confirmed in the hero itself.
- Non-engineer persuasion: customer logos (Maersk, Adobe, Google,
  Panasonic, PayPal, Eli Lilly, Volvo); quote "What makes Dify stand out
  is its ability to democratize AI agent development"; SOC 2 Type II + ISO
  27001 cited as enterprise trust markers.
- Early-stage framing: none — the "158K+ stars" figure itself functions as
  the primary maturity proxy.

**Langfuse** (langfuse.com)
- Self-host/cloud: "Sign up for Langfuse Cloud or self-host," "Self-host
  at scale — Docker Compose, Kubernetes (Helm), and Terraform for AWS,
  GCP, and Azure." Explicit: "self-hosting is completely free. The entire
  codebase is open source under the MIT license." Appears in a dedicated
  mid-page "Open platform, open source" section, not purely above the
  fold.
- Dev-credibility: "35,000+ GitHub stars" cited on-page (SECONDARY SOURCE
  cross-check puts the range at 33,600–36,000, consistent). "5,000+
  Discord members." License: "MIT license — all product features are MIT
  licensed... fork, modify, and contribute." **Notably, Langfuse folds its
  star count into a denser wall of usage stats** rather than a standalone
  badge — "21 of the Fortune 50," "100,000+ engineers build on Langfuse,"
  "90B+ observations per month," "50,000+ companies," "65M+ SDK installs
  per month."
- Non-engineer persuasion: the scale-stat stacking above functions as the
  primary persuasion device, in place of logos/screenshots in this fetch.
- Early-stage framing: none — "99.9% uptime" and "weekly releases and
  community hours" cited as reliability/momentum markers instead.

**Coolify** (coolify.io)
- Self-host/cloud: **both options are the two hero CTA buttons
  themselves**, above the fold ("Start with Cloud" / "Self-host for
  free") — the most prominent surfacing of the choice among all 31 sites.
  Reinforced: "Open source and free forever," "3,641+ customers on Cloud
  … self-hosted instances."
- Dev-credibility — **notable finding**: **no GitHub star badge or count
  appears anywhere on the homepage**, and **no curl/terminal install
  one-liner was captured in the hero**, despite Coolify being known in the
  ecosystem for its curl-based installer (SECONDARY SOURCE cross-check
  puts the actual count at ~62,000–63,000 — comparable to or greater than
  Dify's, yet not displayed). Docs link present; Discord "Community
  20k+." License framed only as philosophy, not an SPDX string: "Open-
  source and free forever. Read our philosophy."
- Non-engineer persuasion: sponsor logos (not customer logos); no
  explicit use-case or comparison sections beyond the subhead's "an open-
  source and self-hostable alternative to Vercel, Heroku, Netlify and
  Railway" framing.
- Early-stage framing: none — changelog link present (`/changelog`); "20k+"
  community count and "280+ one-click services" used as breadth/maturity
  proxies instead of stars.

**Mattermost** (mattermost.com) and **Rocket.Chat** (rocket.chat) —
**both have pivoted entirely away from OSS-credibility marketing**,
independently confirmed via press releases and (for Rocket.Chat) the
GitHub repo description itself, not a fetch artifact:
- Mattermost H1: "Sovereign Operations & AI for Critical Infrastructure
  and National Security." Subhead: "Zero-trust collaboration, automation
  and AI in private cloud, self-hosted, and air-gapped environments...
  you own the data, the model, and the keys." Self-host/cloud is framed
  purely as a **security/sovereignty argument** ("Runs self-hosted,
  private cloud, or fully air-gapped"; deployment options named: Sovereign
  cloud, On-prem/private cloud, Air-gapped, Hybrid/multi-region, Edge).
  **No GitHub star badge, no star count, no terminal/code block, no
  license statement found anywhere on this homepage** — a striking
  contrast with the dev-tool cluster above. Non-engineer persuasion is the
  heaviest of all 31 sites: logos include U.S. Air Force, NASA, Fujitsu,
  Qualcomm; quantified outcomes like "4× more time for aircrews to
  prepare," "90% faster incident response," "$100K revenue at stake every
  minute of downtime." A March-2026 press release confirms this is a
  deliberate, current repositioning ("Mattermost Launches Free Entry
  Tier: Sovereign Self-Hosted Collaboration to Fortify Data Against
  AI-Era Threats" — SECONDARY SOURCE).
- Rocket.Chat H1: "Secure CommsOS® – Interoperable by design. Governed by
  you." Subhead: "Agencies, allies, and partners rarely run the same
  system. Collaborate anyway, in one secure platform..." Self-host/cloud:
  "Deploy in the cloud, on-premises, or air-gapped environments"
  (above fold); "Deploy a free self-managed workspace" appears as a
  Get-Started CTA further down. **No GitHub star badge, no terminal
  install line, no Discord link, no on-page license statement** — the
  Rocket.Chat GitHub repo description itself now reads "The Secure
  CommsOS™ for mission-critical operations" (SECONDARY SOURCE,
  independently confirmed, not a fetch error). Non-engineer persuasion:
  logos (BAE Systems, U.S. Air Force, General Dynamics); quote: "Rocket.
  Chat gives us fine-grained access control we need—keeping teams
  segmented by classified program." A version-number badge appears as a
  freshness signal ("v8.5 ... search improvements and accessibility
  conformance") rather than a beta marker.

**Jitsi** (jitsi.org)
- Self-host/cloud: above the fold, "JaaS: the Team that Builds Jitsi Can
  Now Also Run it for You!" (the managed/hosted offering, pitched against
  self-hosting the open-source project). Mid-page social proof reinforces
  the self-host framing: "100% privacy friendly, 100% open source and
  runs on our own servers."
- Dev-credibility: no GitHub star count/badge, no "star us" CTA, no
  terminal one-liner or code block anywhere on the page, no Discord link.
  Docs link in top nav only. No explicit license statement captured.
- Non-engineer persuasion: logos (8x8, Comcast, Matrix, Rocket.Chat,
  Symphony, WeSchool); quote "It's encrypted, open source, and you don't
  need an account." **The only site of the 31 researched that leads with
  "free" directly in the H1 itself**: "More secure, more flexible, and
  completely free video conferencing."
- Early-stage framing: none — leans on blog freshness instead (a dated
  post from October 9, 2026 announcing a new operational limit: "meetings
  on meet.jit.si are limited to 95 minutes").

---

## 4. How early-stage / pre-1.0 projects stay honest AND confident

This is the single most load-bearing section for Pariksha. Below is every
verbatim example found of a project signaling "we are still building this"
without undermining momentum, ranked roughly by how directly applicable the
technique is to a *pre-alpha, self-host-only* product with no users yet.

1. **Gate the beta label to the specific unfinished feature, not the whole
   product.** Budibase: an **"Agents Beta"** label sits only on the AI-
   agent feature in the product nav menu, while the rest of the homepage
   markets the core product as fully mature ("300K teams," no hedging
   anywhere else). **This is the single most directly applicable pattern
   for Pariksha** — its own README-level honesty is "scoring engine: built
   and tested; authoring UI: specified, not built" — Budibase shows that
   this kind of per-feature labeling doesn't have to leak into the hero or
   undermine the rest of the page.

2. **Replace "we're new" with a waitlist for the *next* version, while the
   *current* version leans on concrete, countable facts.** Rowy: "Sign up
   for Rowy 2.0! We're gearing up for a brand new way to build backend
   workflows visually... Join our early users cohort." The *current*
   product's credibility is carried entirely by raw, specific counts —
   "5,000+ stars | 300+ forks | 4,000+ commits | 500+ pull requests" and
   "Trusted by 30,000+ developers worldwide" — rather than a version
   number. No v0.x is shown anywhere for the shipping product; the
   "early" framing is reserved for the *future* roadmap item only.

3. **Substitute compliance/trust badges for the years-in-market you don't
   have.** Documenso (a newer e-signature entrant competing against
   decades-old DocuSign) leads with "21 CFR Part 11 – Status: Compliant"
   plus linked pages for ESIGN Act, UETA, SOC2, and HIPAA — concrete,
   checkable claims that substitute for brand age. It is directly candid
   about being unfinished in two places on the homepage itself: two
   features are labeled **"Coming Soon"** (Template Store, "Get paid")
   right next to fully-built features, with no apology or disclaimer
   copy — just a plain label. Pariksha's equivalent "coming soon" labels
   (authoring UI, candidate runtime, proctoring, results) can sit the same
   way, inline with built features, labeled plainly rather than hedged.

4. **Publish an "Open Startup" / radical-transparency page as a trust
   device that substitutes for a track record.** Documenso's footer
   `./open` link implies public metrics are available for inspection — the
   mechanism (not necessarily the specific metrics) is "we have nothing to
   hide, here's everything," which does more credibility work for an
   early project than vague reassurance copy would.

5. **Lead with a live roadmap/GitHub-Projects link instead of an in-house
   "beta" badge.** Typesense links `github.com/orgs/typesense/projects/1`
   directly as its roadmap, reading as "working in the open" rather than
   "apologizing for incompleteness." Novu and Metabase both also surface
   roadmap links (`roadmap.dify.ai/roadmap` for Dify similarly) — a
   roadmap link signals active direction without requiring a maturity
   claim either way.

6. **Version-number-as-freshness-signal, not maturity-claim.** Several
   mature projects (Ghost: "Just launched: Ghost 6.0"; Metabase: "New
   Metabase 64"; Formbricks: "Formbricks 6.0 is here"; Rocket.Chat: "v8.5")
   use a version badge purely to show the project is actively shipping —
   this same mechanic works in reverse for a pre-1.0 project: a visible
   "v0.x" or a dated "last shipped: [date]" line reads as *alive*, not
   *incomplete*, provided it's paired with a changelog link rather than a
   disclaimer sentence.

7. **State exactly what's free to self-host in plain declarative sentences,
   with zero hedging words.** The strongest-worded examples, useful as a
   tone model regardless of maturity stage: Coolify, "Open source and free
   forever"; Infisical, "The open-source core is free forever under MIT if
   you self-host"; BookStack, "There is no cost to downloading and
   installing your own instance." None of these use "currently," "for
   now," or "while we..." — declarative, present-tense, no caveats.

### Patterns explicitly NOT found (worth noting by absence)

- **No project researched used the words "pre-alpha," "pre-1.0," or
  "experimental" anywhere on its public marketing homepage.** The closest
  equivalents are feature-level beta tags (Budibase) or next-version
  waitlists (Rowy) — never a whole-product disclaimer. This is a strong
  signal that Pariksha's current page's repeated "pre-alpha, not built
  yet" framing has no precedent among comparable OSS homepages and should
  likely be replaced with the Budibase/Rowy pattern: label the specific
  unbuilt pieces, keep the rest of the page's voice fully confident.
- **No project used a literal progress bar, percentage-complete indicator,
  or "X of Y features done" counter** on its homepage in this research
  pass. Maturity is communicated through counts (stars, customers, uptime,
  commits) or compliance badges, never through a visible completion
  fraction.
- **No early-stage project apologized for lacking a feature.** Every
  "Coming Soon" or "Beta" label found was a plain noun-phrase tag, never a
  sentence explaining why something isn't ready yet.

---

## 5. What applies to a project with no hosted cloud offering at all

Pariksha has no cloud SKU to pair against self-hosting — most of the dual-CTA
pattern in section 1/move-1 ("Start with Cloud" / "Self-host for free")
assumes a second, revenue-generating button to put self-host *next to*.
Three of the 31 sites researched are structurally closest to Pariksha's
actual situation and show what to do instead:

- **BookStack** has no cloud tier of any kind and doesn't miss it: the
  hero leads with the outcome ("Simple wiki software") and self-hosting is
  simply assumed, not framed as a choice at all. The CTA row is three
  parallel buttons — **Source / Demo / Install** — none of which is a
  signup form. For Pariksha, the equivalent triad is **Source (GitHub) /
  Try the worked example / Install docs** — replacing "Demo" (a hosted
  sandbox Pariksha also doesn't have) with "Try the worked example," since
  the scoring engine and JSON Schemas are the one part of the product that
  actually works end-to-end today.
- **Nextcloud** has no self-serve cloud tier either (its business model is
  enterprise support, not hosted SaaS) and solves the "no second button"
  problem by making the *entire brand* about data ownership rather than
  presenting self-hosting as an alternative to something else. The CTA is
  "Discover Nextcloud" (outcome-led, not transactional) plus "Get a
  quote" (sales-led) — there is no attempt to manufacture a second,
  cloud-shaped CTA just to mirror the competitor pattern.
- **Jitsi** is the other no-cloud-of-its-own-only example (JaaS is a
  separate managed product, not "Jitsi Cloud") and solves it by putting
  "free" directly in the H1 ("completely free video conferencing") so
  the self-host-only nature reads as generosity rather than a limitation
  — the absence of a paid tier becomes the headline, not a caveat below
  it.

**Synthesis for Pariksha:** don't manufacture a fake second CTA button to
mimic the Coolify/Hoppscotch two-button hero — that pattern specifically
exists to route cloud-intent traffic to a paid product Pariksha doesn't
have. Instead:
- Follow BookStack's three-parallel-button pattern (Source / Try it / Install)
  since Pariksha, like BookStack, has a working artifact (the worked
  example + scoring engine) that can stand in for a "Demo" without needing
  a hosted sandbox.
- Follow Nextcloud's framing: make self-hosting *the whole premise*, not a
  secondary path justified against a cloud option that doesn't exist. The
  H1 shouldn't need to mention "self-hosted" explicitly (Nextcloud's
  doesn't) — the ownership/control benefit can be the entire value
  proposition, stated once, confidently, without a side-by-side comparison
  to a cloud tier that isn't being offered.
- Borrow Jitsi's move of putting "free" in the H1 or immediate subhead,
  since for Pariksha (college placement cells and training institutes —
  genuinely budget-constrained buyers) "free, no cloud bill, ever" is a
  real and uncommon-enough claim to lead with rather than bury.
- For developer-credibility, none of Pariksha's star-count/Discord-size
  moves are available pre-launch — the Budibase/Rowy pattern (lean on
  concrete, verifiable facts about the *current* build: test coverage,
  schema validation, a runnable worked example) is the correct substitute,
  not a fabricated community-size claim.

---

## 6. Sources and fetch dates

All primary fetches below were performed 2026-10-19 via WebFetch against the
live URL, with GitHub star counts and license identifiers cross-checked via
the GitHub API and/or WebSearch where noted inline above as SECONDARY SOURCE.

**Homepages (primary fetch):**
- https://supabase.com · https://supabase.com/pricing · https://supabase.com/docs/guides/self-hosting
- https://posthog.com · https://posthog.com/pricing · https://posthog.com/docs/self-host
- https://appwrite.io · https://appwrite.io/pricing (partial — connection reset, worked around)
- https://directus.com (directus.io redirects here)
- https://www.metabase.com · https://www.metabase.com/start/oss/
- https://grafana.com · https://grafana.com/oss/ · https://grafana.com/grafana/download
- https://cal.com/ · https://cal.com/calcom-vs-calendly
- https://n8n.io/
- https://formbricks.com/
- https://typesense.org/
- https://plausible.io · https://plausible.io/open-source-website-analytics · https://plausible.io/docs/self-hosting · https://plausible.io/vs-google-analytics
- https://umami.is · https://umami.is/pricing · https://umami.is/community · https://umami.is/compare/google-analytics · https://umami.is/compare/plausible
- https://ghost.org
- https://www.getoutline.com
- https://www.bookstackapp.com
- https://nextcloud.com
- https://documenso.com
- https://zulip.com
- https://nocodb.com
- https://www.budibase.com
- https://www.rowy.io
- https://infisical.com
- https://novu.co
- https://hoppscotch.io (body NOT RETRIEVED, JS SPA) / https://hoppscotch.com (secondary/adjacent domain, used instead)
- https://twenty.com
- https://medusajs.com
- https://dify.ai
- https://langfuse.com
- https://coolify.io
- https://mattermost.com
- https://rocket.chat
- https://jitsi.org

**Comparison / competitor pages:**
- https://cal.com/calcom-vs-calendly
- https://plausible.io/vs-google-analytics
- https://umami.is/compare/google-analytics
- https://umami.is/compare/plausible
- (Searched, not found as an official page: "Plausible vs Simple Analytics")

**GitHub repos / license cross-checks (SECONDARY SOURCE, via GitHub API/pages, fetched 2026-10-19):**
- github.com/supabase/supabase (Apache 2.0) · github.com/appwrite/appwrite (BSD-3-Clause) ·
  github.com/directus/directus (BSL 1.1) · github.com/metabase/metabase (AGPL + commercial) ·
  github.com/calcom/cal.com (49,136 stars) · github.com/n8n-io/n8n (207,907 stars; fair-code/Sustainable Use License) ·
  github.com/formbricks/formbricks (13,121 stars) · github.com/typesense/typesense (27,000 stars) ·
  github.com/plausible/analytics (29.5k stars; AGPLv3) · github.com/umami-software/umami (39.5k stars; MIT) ·
  github.com/outline/outline (~40.9k stars) · github.com/Infisical/infisical (~29.8–30k stars; MIT) ·
  github.com/hoppscotch/hoppscotch (~79–80.6k stars) · zulip/zulip (Apache 2.0) · nextcloud/server (AGPL-3.0-only) ·
  documenso/documenso (AGPL-3.0 + commercial Enterprise Edition)
- Secondary write-ups used only to corroborate a single figure or repositioning claim: a March-2026 Mattermost press
  release on its "Sovereign Self-Hosted Collaboration" free-tier launch; the current Rocket.Chat GitHub repo
  description ("The Secure CommsOS™ for mission-critical operations"); infisical.com/blog/25-000-github-stars-and-just-getting-started

**OSS marketing / go-to-market essays and data (fetched/searched 2026-10-19):**
- Andy Vandervell, "How (and why) our marketing team uses PostHog," PostHog Blog, ~Sept 28 2022 — https://posthog.com/blog/posthog-marketing
- Charles Cook & Andy Vandervell, "Startup marketing for noobs, by noobs," Product for Engineers newsletter, Dec 5 2023 — https://newsletter.posthog.com/p/startup-marketing-for-noobs-by-noobs
- PostHog Founders blog, "How we're spending our marketing budget in 2026" — https://posthog.com/founders/actual-marketing-budget-2026 (NOT FULLY RETRIEVED, JS-rendered/truncated; $ figures reported only via secondary sources)
- Joe Black, "5 analytics ideas for marketing teams using PostHog," Oct 10 2022 — https://posthog.com/blog/analytics-tips-for-marketing-teams (tangential)
- "How PostHog Grows: The Power of Being Open-Core," How They Grow — https://www.howtheygrow.co/p/how-posthog-grows-the-power-of-being (NOT RETRIEVED in full, SECONDARY)
- "The Genius of PostHog Marketing," Battery Ventures — https://www.battery.com/blog/the-genius-of-posthog-marketing/ (NOT RETRIEVED in full, SECONDARY)
- Ant Wilson, "How we launch at Supabase," Nov 26 2021 — https://supabase.com/blog/supabase-how-we-launch
- "Supabase's GTM Playbook: How It Reached 13 Million Developers," Origin Notes (Substack) — NOT RETRIEVED in full, SECONDARY
- Marko Saric, "How we built a $1M ARR open source SaaS," Plausible Blog, June 22 2022 — https://plausible.io/blog/open-source-saas
- "How we grew our startup from $400 to $2,750 MRR in 135 days without ads," Plausible Blog — https://plausible.io/blog/startup-marketing (NOT RETRIEVED in full, found via search listing only)
- "What we learned on our journey to $10,000 MRR," Plausible Blog — https://plausible.io/blog/growing-saas-mrr (NOT RETRIEVED in full, found via search listing only)
- Peter Levine & Jennifer Li, "Open Source: From Community to Commercialization," a16z, Oct 4 2019 — https://a16z.com/open-source-from-community-to-commercialization/
- OSS Capital (COSS framing) — https://oss.capital/ (NOT RETRIEVED for specific essay content, general positioning only via secondary sources)
- Heavybit, "What Makes Modern Open-Source Software Startups Successful?" — https://www.heavybit.com/library/article/success-for-open-source-startups (NOT RETRIEVED in full text)
- Heavybit, "Open-Source @Heavybit" — https://www.heavybit.com/library/article/open-source-heavybit (NOT RETRIEVED in full text)
- GitHub-star-conversion claims — no single authoritative study found; directional consensus only, via: skyvern.com blog ("13k GitHub Stars and Why Star Count Isn't Our Primary Metric," NOT independently verified); a cited but NOT directly read 2018 paper, "What's in a GitHub Star? Understanding Repository Starring Practices in a Social Coding Platform"; an unverified Organization Science paper claim (GitHub activity ~15pp more likely to predict funding, not revenue)
- README-vs-landing-page framing — no single authoritative essay found; composite of search-snippet-level sources only (draft.dev, Apache Foundation blog, winglang.io) — marked NOT RETRIEVED at primary-source depth

**Methodology caveats carried through this report:**
- All homepage content was fetched via WebFetch, which converts rendered HTML to markdown through a summarizing
  model rather than returning raw DOM — quoted strings are reported as returned by that pipeline and should be
  treated as high-confidence extracts, not a guaranteed byte-for-byte scrape, except where a researching agent
  additionally cross-checked against raw HTML/JSON via curl (Cal.com, n8n, Formbricks, Typesense — noted inline
  as "verbatim-confirmed" in the source agent's notes).
- Several items across sites are explicitly marked NOT RETRIEVED in the detail sections above rather than guessed —
  this includes some exact GitHub star-badge figures, some terminal one-liners, and a handful of CTA labels on
  heavily JS-rendered pages (Supabase, PostHog). No copy was invented to fill these gaps.
