// Pure data for everything in <head>, given the build-time origin.
// scripts/prerender.mjs imports buildHead() and injects the result into
// dist/index.html — nothing here touches the DOM or the filesystem
// (design contract §5, SEO-6 through SEO-18).

import { tokens } from "../styles/tokens";

// SEO-9b: these two strings are the single source for the meta description,
// og:description, SoftwareApplication.releaseNotes and llms.txt's opening
// line, so the four can never say different things.
export const DESCRIPTION =
  "Pariksha is an open-source, self-hosted exam platform: question pools, 12 question types, browser proctoring, CSV results.";
export const STATUS_LINE = "Pre-alpha as of October 2026.";
export const META_DESCRIPTION = `${DESCRIPTION} ${STATUS_LINE}`;

// SEO-8. Matches the h1 (T19) except for the h1's trailing full stop.
export const TITLE = "Pariksha — run real exams you host yourself";

export interface HeadIcon {
  rel: string;
  href: string;
  sizes?: string;
  type?: string;
}

export interface HeadData {
  lang: "en-GB";
  title: string;
  description: string;
  /** Absolute, trailing slash: SITE_URL + "/". */
  canonical: string;
  themeColor: { light: string; dark: string };
  /** og:* property -> content, in SEO-11's order. */
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  icons: HeadIcon[];
}

/**
 * @param siteUrl The build-time origin (OQ-1 / SEO-6). Caller
 * (scripts/prerender.mjs) is responsible for throwing when it is unset or
 * not an absolute https origin — this function just uses it.
 */
export function buildHead(siteUrl: string): HeadData {
  const canonical = `${new URL(siteUrl).origin}/`;
  const image = `${canonical}og.png`;
  const imageAlt = TITLE;

  return {
    lang: "en-GB",
    title: TITLE,
    description: META_DESCRIPTION,
    canonical,
    // No dark palette exists yet (DESIGN.md has one palette); voltage reads
    // as the brand colour in a light chrome, ink as a dark-chrome neutral.
    themeColor: { light: tokens.colors.voltage, dark: tokens.colors.ink },
    openGraph: {
      "og:type": "website",
      "og:site_name": "Pariksha",
      "og:title": TITLE,
      "og:description": META_DESCRIPTION,
      "og:url": canonical,
      "og:image": image,
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:image:alt": imageAlt,
      "og:locale": "en_GB",
    },
    twitter: {
      "twitter:card": "summary_large_image",
      "twitter:title": TITLE,
      "twitter:description": META_DESCRIPTION,
      "twitter:image": image,
      "twitter:image:alt": imageAlt,
    },
    // SEO-14. favicon.svg/.ico, apple-touch-icon.png and icon-512.png
    // (jsonld.ts's Organization.logo) are drawn elsewhere — this module only
    // names where they must resolve from.
    icons: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "alternate icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
    ],
  };
}
