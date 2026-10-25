import { describe, it, expect } from "vitest";
import {
  buildHead,
  TITLE,
  META_DESCRIPTION,
  STATUS_LINE,
} from "../src/seo/head";
import { buildJsonLd } from "../src/seo/jsonld";
import { buildRobotsTxt, buildLlmsTxt, buildSitemapXml } from "../src/seo/files";

// Assignment D's acceptance (design contract §8). T6, T7, T8, T9, T10 (icon
// href resolution), T12 and T17 moved to apps/web/test/prerender.test.ts:
// scripts/prerender.mjs's injectHead() does string surgery on the built
// HTML, so a test that only calls the builder functions below proves the
// *data* is right without ever proving that surgery reached dist/index.html.
// robots.txt, llms.txt and sitemap.xml have no such step — runPrerender
// writeFile()s each builder's return value verbatim — so T14-T16 stay here
// as direct tests of that data.
//
// Tests may use https://pariksha.example as SITE_URL because every
// assertion below compares against that same variable, never a literal
// (OQ-1 / SEO-6).
const SITE_URL = "https://pariksha.example";
const DATE_MODIFIED = "2026-10-17"; // passed in as a constant, never Date.now()

describe("T13 — no fake social proof in the structured-data graph", () => {
  it("no node anywhere carries aggregateRating, ratingValue, review, offers or price", () => {
    const jsonld = buildJsonLd({ siteUrl: SITE_URL, dateModified: DATE_MODIFIED });
    const banned = ["aggregateRating", "ratingValue", "review", "offers", "price"];
    const serialized = JSON.stringify(jsonld);
    for (const key of banned) {
      expect(serialized).not.toContain(key);
    }
  });

  it("dateModified parses and is not in the future", () => {
    const jsonld = buildJsonLd({ siteUrl: SITE_URL, dateModified: DATE_MODIFIED });
    const webpage = jsonld["@graph"].find((n) => n["@type"] === "WebPage") as {
      dateModified: string;
    };
    const parsed = new Date(webpage.dateModified);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("runtimePlatform names only what has shipped (Docker self-host is Phase 11, not built)", () => {
    const jsonld = buildJsonLd({ siteUrl: SITE_URL, dateModified: DATE_MODIFIED });
    const sourceCode = jsonld["@graph"].find(
      (n) => n["@type"] === "SoftwareSourceCode",
    ) as { runtimePlatform: string[] };
    expect(sourceCode.runtimePlatform).not.toContain("Docker");
  });
});

describe("T14 — robots.txt", () => {
  const robots = buildRobotsTxt(SITE_URL);
  const agentTokens = [
    "OAI-SearchBot",
    "ChatGPT-User",
    "GPTBot",
    "Claude-SearchBot",
    "Claude-User",
    "ClaudeBot",
    "PerplexityBot",
    "Google-Extended",
  ];

  it("names all eight agent tokens in User-agent lines", () => {
    for (const token of agentTokens) {
      expect(robots).toMatch(new RegExp(`User-agent: ${token}\\b`));
    }
  });

  it("has no bare 'Disallow: /' line", () => {
    const bareDisallow = robots
      .split("\n")
      .some((line) => line.trim() === "Disallow: /");
    expect(bareDisallow).toBe(false);
  });

  it("Sitemap: line is absolute and ends /sitemap.xml", () => {
    const line = robots.split("\n").find((l) => l.startsWith("Sitemap:"));
    expect(line).toMatch(/^Sitemap: https:\/\/.+\/sitemap\.xml$/);
  });
});

describe("T15 — llms.txt", () => {
  const llms = buildLlmsTxt(SITE_URL);

  it("starts '# Pariksha', carries STATUS_LINE whole, and has >= 5 absolute Markdown links", () => {
    expect(llms.startsWith("# Pariksha")).toBe(true);
    // The whole line, not a word from it: "alpha" is a substring of
    // "pre-alpha", so a substring check would pass on either and notice
    // neither a silent revert nor a drift in the date.
    expect(llms).toContain(STATUS_LINE);
    const links = [...llms.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      expect(link).toMatch(/^https:\/\//);
    }
  });
});

describe("T16 — sitemap.xml", () => {
  it("parses, has one <loc> equal to SITE_URL + '/' and a YYYY-MM-DD lastmod", () => {
    const xml = buildSitemapXml(SITE_URL, DATE_MODIFIED);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
    expect(locs).toHaveLength(1);
    expect(locs[0]?.[1]).toBe(`${SITE_URL}/`);
    const lastmod = xml.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
    expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("constants reused across T6/T9b/T17 do not drift", () => {
  it("META_DESCRIPTION === DESCRIPTION + ' ' + STATUS_LINE, and TITLE matches SEO-8", () => {
    expect(META_DESCRIPTION.endsWith(STATUS_LINE)).toBe(true);
    expect(TITLE).toBe("Pariksha — run real exams you host yourself");
    expect(TITLE.length).toBeLessThanOrEqual(60);
  });

  it("STATUS_LINE is the exact alpha line, character for character (T17's real requirement)", () => {
    // Asserted whole, which is what T17 was always reaching for. A
    // substring check cannot do the job here at all: "alpha" occurs
    // inside "pre-alpha", so the one assertion that would survive the
    // #253 status change unchanged is the one that proves nothing.
    expect(STATUS_LINE).toBe("Status: alpha, October 2026.");
  });

  it("buildHead's icon hrefs are root-relative (no origin needed, so they can be static)", () => {
    const head = buildHead(SITE_URL);
    expect(head.icons.length).toBeGreaterThan(0);
    for (const icon of head.icons) {
      expect(icon.href.startsWith("/")).toBe(true);
    }
  });
});
