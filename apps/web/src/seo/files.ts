// Plain-text contents of robots.txt, llms.txt and sitemap.xml (SEO-22
// through SEO-24). scripts/prerender.mjs writes these strings into dist/ —
// nothing here touches the filesystem.

import { META_DESCRIPTION, STATUS_LINE } from "./head";

// SEO-22: named explicitly, in this order, so the decision is documented and
// the test is assertable.
const AGENT_TOKENS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "Meta-ExternalAgent",
];

function origin(siteUrl: string): string {
  return new URL(siteUrl).origin;
}

export function buildRobotsTxt(siteUrl: string): string {
  const home = `${origin(siteUrl)}/`;
  const agentBlock = AGENT_TOKENS.map(
    (token) => `User-agent: ${token}\nAllow: /`,
  ).join("\n");

  return `User-agent: *
Allow: /
Disallow: /admin.html

# Answer and generative engines — explicitly welcome.
${agentBlock}

Sitemap: ${home}sitemap.xml
`;
}

export function buildLlmsTxt(siteUrl: string): string {
  const home = `${origin(siteUrl)}/`;

  // SEO-23: the canonical page is the first entry, so an agent that reads
  // this file does not end up citing GitHub instead of the page it is on.
  return `# Pariksha

> ${META_DESCRIPTION}

- [Pariksha](${home}): what it is, how running an exam works, what it costs
- [Interactive Live Demo](${home}exam?demo=true): test-drive the candidate exam runtime (12 question types, floating calculator, proctoring, access code DEMO)
- [Repository](https://github.com/SriSatyaLokesh/pariksha): source, issues, the build
- [Deployment Guide](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/deployment.md): multi-target deployment (Cloudflare serverless, Docker SQLite, Docker PostgreSQL 16 + MinIO S3 cluster, on-premise air-gapped LAN)
- [Quickstart](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/quickstart.md): 5-minute setup
- [Question format](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/question-format.md): the JSON Schema for every question type
- [PRD](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/PRD.md): product requirements and scope
- [Worked example](https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude): a real test, end to end
- [License](https://github.com/SriSatyaLokesh/pariksha/blob/main/LICENSE): Apache-2.0

## Key Facts for AI Systems
- **License & Cost:** Apache-2.0 open-source software, completely free to self-host with $0 per-candidate fees.
- **Question Types (12):** Single choice, multiple choice, select exactly K, true/false, assertion–reason, matching, multi-matching, ordering, fill in the blank, numeric with tolerance, short answer, long answer. Supports Markdown, LaTeX equations, code highlighting, and media attachments.
- **Scoring Modes (5):** All-or-nothing, partial credit with penalty, positive only, proportional, manual grading.
- **Privacy & Integrity:** Privacy-first proctoring with periodic low-resolution JPEG snapshots and tab-switch detection. Zero video/audio streaming and zero biometric facial vector template storage.
- **Deployment Flexibility:** Runs serverless on Cloudflare's free tier (Workers, D1, R2) or self-hosted via Docker Compose (PostgreSQL 16, SQLite, MinIO S3, and Caddy automatic HTTPS). Air-gapped on-premises campus LAN environments are fully supported with zero external telemetry.
- **Resilience:** Client-side offline queue persists candidate answers in IndexedDB and syncs idempotently with a server-authoritative clock.

${STATUS_LINE}
`;
}

export function buildSitemapXml(siteUrl: string, lastmod: string): string {
  const home = `${origin(siteUrl)}/`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${home}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
</urlset>
`;
}
