// The single @graph structured-data block (SEO-19). Returns a plain object;
// scripts/prerender.mjs JSON.stringifies it into one
// <script type="application/ld+json"> in dist/index.html. No fake social
// proof: T13 permanently guards against aggregateRating, ratingValue,
// review, offers and price appearing anywhere in this graph.

import { META_DESCRIPTION, STATUS_LINE, TITLE } from "./head";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
// Telugu and Hindi renderings of "exam" — entity-reconciliation aliases.
const ALTERNATE_NAMES = ["పరీక్ష", "परीक्षा"];
// The page's original publish date. A fixed fact, not today's date.
const DATE_PUBLISHED = "2026-10-17";

export interface JsonLdOptions {
  siteUrl: string;
  /**
   * YYYY-MM-DD. Supplied by the caller (git log, or the build-date fallback
   * per SEO-19) — this module never reads the clock.
   */
  dateModified: string;
}

export function buildJsonLd({ siteUrl, dateModified }: JsonLdOptions) {
  const home = `${new URL(siteUrl).origin}/`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        name: "Pariksha",
        alternateName: ALTERNATE_NAMES,
        url: home,
        inLanguage: "en-GB",
        publisher: { "@id": `${home}#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${home}#organization`,
        name: "Pariksha",
        alternateName: ALTERNATE_NAMES,
        url: home,
        // Square mark for Organization.logo (Google's guidance); og.png is
        // the 1200x630 social banner and stays og:image's job only.
        logo: `${home}icon-512.png`,
        sameAs: [REPO],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${home}#software`,
        name: "Pariksha",
        alternateName: ALTERNATE_NAMES,
        description: META_DESCRIPTION,
        applicationCategory: "EducationalApplication",
        applicationSubCategory: "Online examination and assessment software",
        operatingSystem: "Linux, macOS, Windows, Docker, Cloudflare Workers",
        softwareVersion: "alpha",
        releaseNotes: STATUS_LINE,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        url: home,
        sameAs: REPO,
        publisher: { "@id": `${home}#organization` },
        isBasedOn: { "@id": `${home}#sourcecode` },
        potentialAction: {
          "@type": "PlayAction",
          name: "Try Interactive Demo",
          target: `${home}exam?demo=true`,
        },
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${home}#sourcecode`,
        name: "Pariksha",
        codeRepository: REPO,
        programmingLanguage: ["TypeScript", "React"],
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        runtimePlatform: ["Cloudflare Workers", "Node.js", "Docker"],
      },
      {
        "@type": "WebPage",
        "@id": `${home}#webpage`,
        url: home,
        // Matches the <title> (SEO-8): the page's two most-lifted strings
        // must not say two different things, and that now includes this one.
        name: TITLE,
        description: META_DESCRIPTION,
        isPartOf: { "@id": `${home}#website` },
        about: { "@id": `${home}#software` },
        inLanguage: "en-GB",
        datePublished: DATE_PUBLISHED,
        dateModified,
      },
    ],
  };
}
