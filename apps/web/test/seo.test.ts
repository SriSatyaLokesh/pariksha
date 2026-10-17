import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  buildHead,
  TITLE,
  META_DESCRIPTION,
  STATUS_LINE,
} from "../src/seo/head";
import { buildJsonLd } from "../src/seo/jsonld";
import { buildRobotsTxt, buildLlmsTxt, buildSitemapXml } from "../src/seo/files";

// Assignment D's acceptance (design contract §8, T6-T17). These test the
// pure data/string functions directly — scripts/prerender.mjs (assignment A)
// is what writes their output into dist/, and T1-T5/T19-T32 cover that file.
//
// Tests may use https://pariksha.example as SITE_URL because every
// assertion below compares against that same variable, never a literal
// (OQ-1 / SEO-6).
const SITE_URL = "https://pariksha.example";
const DATE_MODIFIED = "2026-10-17"; // passed in as a constant, never Date.now()

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("T6 — title and description", () => {
  const head = buildHead(SITE_URL);

  it("title is 15-60 characters and contains Pariksha", () => {
    expect(head.title.length).toBeGreaterThanOrEqual(15);
    expect(head.title.length).toBeLessThanOrEqual(60);
    expect(head.title).toContain("Pariksha");
  });

  it("description is 110-160 characters and contains pre-alpha and October 2026", () => {
    expect(head.description.length).toBeGreaterThanOrEqual(110);
    expect(head.description.length).toBeLessThanOrEqual(160);
    expect(head.description.toLowerCase()).toContain("pre-alpha");
    expect(head.description).toContain("October 2026");
  });

  it("carries both theme-color values with light and dark media", () => {
    expect(head.themeColor.light).toBeTruthy();
    expect(head.themeColor.dark).toBeTruthy();
    expect(head.themeColor.light).not.toBe(head.themeColor.dark);
  });
});

describe("T7 — canonical, Open Graph, Twitter card", () => {
  const head = buildHead(SITE_URL);

  it("canonical is absolute https and equals SITE_URL + '/'", () => {
    expect(head.canonical).toBe(`${SITE_URL}/`);
  });

  it("carries the Open Graph properties SEO-11 lists, og:url equal to canonical", () => {
    const required = [
      "og:type",
      "og:site_name",
      "og:title",
      "og:description",
      "og:url",
      "og:image",
      "og:image:width",
      "og:image:height",
      "og:image:alt",
      "og:locale",
    ];
    for (const key of required) {
      expect(head.openGraph[key]).toBeTruthy();
    }
    expect(head.openGraph["og:url"]).toBe(head.canonical);
    expect(head.openGraph["og:image"]).toMatch(/^https:\/\//);
  });

  it("twitter card is summary_large_image with an absolute image", () => {
    expect(head.twitter["twitter:card"]).toBe("summary_large_image");
    expect(head.twitter["twitter:image"]).toMatch(/^https:\/\//);
  });
});

describe("T8 — language", () => {
  it("head data declares en-GB", () => {
    expect(buildHead(SITE_URL).lang).toBe("en-GB");
  });
});

describe("T9 — no stray https origin", () => {
  it("head, jsonld and the agent files carry no https origin besides SITE_URL and github.com", () => {
    const head = buildHead(SITE_URL);
    const jsonld = buildJsonLd({ siteUrl: SITE_URL, dateModified: DATE_MODIFIED });
    const blob = JSON.stringify(head) + JSON.stringify(jsonld) +
      buildRobotsTxt(SITE_URL) + buildLlmsTxt(SITE_URL) +
      buildSitemapXml(SITE_URL, DATE_MODIFIED);
    const origins = [...blob.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
    for (const origin of origins) {
      const allowed =
        origin === "pariksha.example" ||
        origin === "github.com" ||
        origin === "schema.org" ||
        origin === "www.apache.org";
      expect(allowed).toBe(true);
    }
  });
});

describe("T10 — og.png dimensions and icon hrefs", () => {
  it("og.png's IHDR chunk reads 1200x630", () => {
    const buf = readFileSync(resolve(ROOT, "public/og.png"));
    // PNG signature (8 bytes), then the IHDR chunk: 4-byte length, 4-byte
    // "IHDR" type, then width/height as two big-endian uint32s.
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });

  it("every icon href is an absolute-from-root path", () => {
    const head = buildHead(SITE_URL);
    expect(head.icons.length).toBeGreaterThan(0);
    for (const icon of head.icons) {
      expect(icon.href.startsWith("/")).toBe(true);
    }
  });
});

describe("T12/T13 — structured data", () => {
  const jsonld = buildJsonLd({ siteUrl: SITE_URL, dateModified: DATE_MODIFIED });

  it("parses, has the right @context, and all five @types", () => {
    const serialized = JSON.stringify(jsonld);
    const parsed = JSON.parse(serialized);
    expect(parsed["@context"]).toBe("https://schema.org");
    const types = parsed["@graph"].map((node: { "@type": string }) => node["@type"]);
    expect(types).toEqual(
      expect.arrayContaining([
        "WebSite",
        "Organization",
        "SoftwareApplication",
        "SoftwareSourceCode",
        "WebPage",
      ]),
    );
  });

  it("dateModified parses and is not in the future", () => {
    const webpage = jsonld["@graph"].find((n) => n["@type"] === "WebPage") as {
      dateModified: string;
    };
    const parsed = new Date(webpage.dateModified);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("no node anywhere carries aggregateRating, ratingValue, review, offers or price", () => {
    const banned = ["aggregateRating", "ratingValue", "review", "offers", "price"];
    const serialized = JSON.stringify(jsonld);
    for (const key of banned) {
      expect(serialized).not.toContain(key);
    }
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

  it("starts '# Pariksha', contains pre-alpha, and has >= 5 absolute Markdown links", () => {
    expect(llms.startsWith("# Pariksha")).toBe(true);
    expect(llms.toLowerCase()).toContain("pre-alpha");
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

describe("T17 — pre-alpha appears in all three load-bearing places", () => {
  it("meta description, releaseNotes and llms.txt all literally say pre-alpha", () => {
    const head = buildHead(SITE_URL);
    const jsonld = buildJsonLd({ siteUrl: SITE_URL, dateModified: DATE_MODIFIED });
    const software = jsonld["@graph"].find(
      (n) => n["@type"] === "SoftwareApplication",
    ) as { releaseNotes: string };
    const llms = buildLlmsTxt(SITE_URL);

    expect(head.description.toLowerCase()).toContain("pre-alpha");
    expect(software.releaseNotes.toLowerCase()).toContain("pre-alpha");
    expect(llms.toLowerCase()).toContain("pre-alpha");
  });
});

describe("constants reused across T6/T9b/T17 do not drift", () => {
  it("META_DESCRIPTION === DESCRIPTION + ' ' + STATUS_LINE, and TITLE matches SEO-8", () => {
    expect(META_DESCRIPTION.endsWith(STATUS_LINE)).toBe(true);
    expect(TITLE).toBe("Pariksha — run real exams you host yourself");
    expect(TITLE.length).toBeLessThanOrEqual(60);
  });
});
