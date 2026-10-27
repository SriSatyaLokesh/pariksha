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
- [Question format](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/question-format.md): the JSON Schema for every question type
- [PRD](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/PRD.md): product requirements and scope
- [Worked example](https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude): a real test, end to end
- [License](https://github.com/SriSatyaLokesh/pariksha/blob/main/LICENSE): Apache-2.0

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
