// Prerenders the landing page to static HTML at build time (design contract
// §5, SEO-1 through SEO-6). Runs after `vite build` — see
// apps/web/package.json's "build" script.
//
// Four jobs, in order:
//   1. SSR-bundle apps/web/src/entry-prerender.tsx with Vite, so its JSX/TS
//      and its "./routes/landing" + "./seo/*" imports resolve in Node, then
//      import the built module for its exports.
//   2. Replace dist/index.html's `<div id="root"></div>` with the rendered
//      markup, strip every `<script type="module">`/modulepreload tag the
//      build left behind (I-1: the page ships no client JS of its own
//      making), and inject the <head> payload + JSON-LD that
//      apps/web/src/seo/ builds.
//   3. Inject the one sanctioned script: the exam-demo island, found in
//      dist/.vite/manifest.json and added as a single
//      `<script type="module" src="/assets/…">` immediately before
//      `</body>` (v3 design contract §2.7, I-1). Strip-then-inject keeps one
//      rule in one place — the prerender alone decides which scripts reach
//      the public page.
//   4. Write dist/robots.txt, dist/llms.txt and dist/sitemap.xml.
//
// No new dependency: react-dom/server ships with react-dom, and the Vite
// build this reuses is already a devDependency.
import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
export const REPO_ROOT = resolve(dirname(__filename), "..");
export const WEB_ROOT = resolve(REPO_ROOT, "apps/web");

// "vite" is a devDependency of apps/web, not of the repo root — pnpm's
// workspace layout does not hoist it there, so a static `import "vite"` from
// this repo-root file fails to resolve (and, loaded under Vitest, would also
// be rewritten by Vite's own import-analysis transform before Node ever sees
// it). Resolve and import it the way Node would if this file lived inside
// apps/web; the computed (non-literal) specifier below is why that transform
// leaves this import alone.
const viteEntry = createRequire(resolve(WEB_ROOT, "package.json")).resolve(
  "vite",
);
const { build } = await import(pathToFileURL(viteEntry).href);

/**
 * SEO-6 / OQ-1: there is no placeholder origin. Throws when `raw` is unset
 * or is not a bare absolute `https` origin (no path, query or hash beyond
 * `/`). Returns the origin with no trailing slash (e.g. "https://pariksha.example").
 */
export function resolveSiteUrl(raw) {
  if (!raw) {
    throw new Error(
      'SITE_URL is not set. Pass the real absolute https origin the build ' +
        '(design contract §10, OQ-1) — e.g. SITE_URL="https://<name>.workers.dev" ' +
        'pnpm build. There is no fallback: a canonical pointing at a host that ' +
        'does not serve the page is worse than no canonical.',
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SITE_URL "${raw}" is not a valid URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`SITE_URL "${raw}" must be an https:// origin.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `SITE_URL "${raw}" must be a bare origin with no path, query or hash (e.g. "https://pariksha.example").`,
    );
  }
  return url.origin;
}

// SEO-19's DATE_MODIFIED: the last commit date touching the page's source,
// falling back to the build date where .git is absent (a source tarball,
// some build containers) — a hint, not a fact worth failing a deploy over.
function getDateModified(webRoot) {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cs", "--", "src", "index.html"],
      { cwd: webRoot, encoding: "utf8" },
    ).trim();
    if (out) return out;
  } catch {
    // no .git, or git not on PATH
  }
  return new Date().toISOString().slice(0, 10);
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Vite's built `<script type="module" ...></script>` and any
// `<link rel="modulepreload" ...>` it emits for the (now-unused) client
// entry. Stripped from the already-built HTML rather than from
// apps/web/index.html's source, so this script is the one place that owns
// "ships 0 bytes of JS" regardless of whether the client entry is still
// wired in index.html.
function stripClientAssets(page) {
  return page
    .replace(/\s*<script[^>]*\btype="module"[^>]*>\s*<\/script>/g, "")
    .replace(/\s*<link[^>]*\brel="modulepreload"[^>]*>/g, "");
}

// Title, description, og:type/site_name/title/description/locale,
// twitter:card/title/description and the three icon <link>s need no
// build-time origin, so they are now static in apps/web/index.html (design
// contract §5) — a path that never runs this script (vite dev, a bare
// `vite build`, a source tarball) still serves a correct head. The
// lang/title replace below is kept anyway as a belt-and-suspenders guard:
// it forces head.ts's TITLE into dist regardless of whether index.html's
// static copy has drifted. Only what genuinely cannot be static — values
// built from the build-time origin (OQ-1/SEO-6: canonical, og:url, the
// og/twitter image URLs) and the one raw hex literal index.html must stay
// free of for the colour guard (SEO-15: theme-color) — is injected here,
// plus the JSON-LD block (needs git-derived dateModified).
function injectHead(page, head, jsonLd) {
  if (head.lang) {
    page = page.replace(/<html lang="[^"]*"/, `<html lang="${head.lang}"`);
  }
  if (head.title) {
    page = page.replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeAttr(head.title)}</title>`,
    );
  }

  const og = head.openGraph ?? {};
  const tw = head.twitter ?? {};
  const tags = [
    `<link rel="canonical" href="${escapeAttr(head.canonical)}">`,
    `<meta property="og:url" content="${escapeAttr(og["og:url"])}">`,
    `<meta property="og:image" content="${escapeAttr(og["og:image"])}">`,
    `<meta property="og:image:width" content="${escapeAttr(og["og:image:width"])}">`,
    `<meta property="og:image:height" content="${escapeAttr(og["og:image:height"])}">`,
    `<meta property="og:image:alt" content="${escapeAttr(og["og:image:alt"])}">`,
    `<meta name="twitter:image" content="${escapeAttr(tw["twitter:image"])}">`,
    `<meta name="twitter:image:alt" content="${escapeAttr(tw["twitter:image:alt"])}">`,
    `<meta name="theme-color" content="${escapeAttr(head.themeColor.light)}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${escapeAttr(head.themeColor.dark)}" media="(prefers-color-scheme: dark)">`,
    // SEO-19: the HTML spec stops processing a ld+json block before it is
    // ever executed, so only `</script>` inside the JSON needs escaping.
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
  ];

  return page.replace("</head>", `  ${tags.join("\n  ")}\n</head>`);
}

// v3 design contract §2.7 / I-1. The exam-demo island is a third Rollup
// entry (`island: .../src/island/exam-demo.ts`) built alongside index.html
// and admin.html; Vite's manifest (`build.manifest: true`) is the one place
// that names its hashed output file, so this reads the manifest rather than
// guessing a filename. Returns the tag text; throws if the manifest doesn't
// name exactly one "island" entry, because I-1 requires exactly one module
// script and a design that silently shipped zero or two would be the wrong
// design (D2: "if the island cannot do this, it does not ship").
export async function buildIslandScriptTag(outDir) {
  const manifestPath = resolve(outDir, ".vite/manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (cause) {
    throw new Error(
      `Could not read the Vite manifest at ${manifestPath} to find the ` +
        "exam-demo island's built file (design contract §2.7). Build with " +
        '"manifest: true" and a Rollup input named "island" first.',
      { cause },
    );
  }

  const islandEntries = Object.values(manifest).filter(
    (entry) => entry?.isEntry && entry?.name === "island",
  );
  if (islandEntries.length !== 1) {
    throw new Error(
      'Expected exactly one Vite entry named "island" (the exam-demo ' +
        `module, design contract §2.7) in ${manifestPath}; found ` +
        `${islandEntries.length}.`,
    );
  }

  return `<script type="module" src="/${islandEntries[0].file}"></script>`;
}

function injectIslandScript(page, scriptTag) {
  return page.replace("</body>", `    ${scriptTag}\n  </body>`);
}

// SEO-4: dist/404.html is emitted here, carrying the same shell as the real
// page — same stylesheet link, so it is never an unstyled orphan — rather
// than being a static apps/web/public/404.html copy, which had no
// stylesheet link at all and which the project's colour guard never walked
// because public/ sits outside its scan root.
function build404Html(page) {
  const styleTag =
    /<link rel="stylesheet"[^>]*href="[^"]+">/.exec(page)?.[0] ?? "";
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>Page not found — Pariksha</title>
    ${styleTag}
  </head>
  <body>
    <main class="section">
      <div class="wrap">
        <p>This page does not exist. <a href="/">Return to the Pariksha homepage.</a></p>
      </div>
    </main>
  </body>
</html>
`;
}

/**
 * Runs the whole prerender against an already-built `outDir` (a prior
 * `vite build` with the normal two-entry config must have produced
 * `${outDir}/index.html`). `outDir` is caller-supplied so tests can point it
 * at a throwaway temp directory instead of the shared `apps/web/dist` other
 * agents may be building into concurrently.
 */
export async function runPrerender({ webRoot, outDir, siteUrl }) {
  const origin = resolveSiteUrl(siteUrl);

  // A scratch dir for the SSR sub-build, nested *inside* webRoot — never
  // under the caller's `outDir` — for two reasons: (1) the built
  // entry-prerender.mjs imports bare specifiers ("react-dom/server", "react")
  // that only resolve by walking up through apps/web/node_modules, which a
  // `outDir` outside apps/web (a test's temp directory, say) has no path to;
  // (2) a random suffix under webRoot means two concurrent runs (another
  // agent, a test, a real build) never share — or empty — the same directory.
  const ssrOutDir = await mkdtemp(join(webRoot, ".prerender-"));

  try {
    // SSR-bundle only the landing tree (+ the seo/ builders it re-exports),
    // so JSX/TS/imports resolve in Node. `build.ssr` as a string wins over
    // vite.config.ts's two-entry `rollupOptions.input` (Vite resolves the
    // SSR input from `build.ssr` first), so the shared config is reused
    // as-is.
    await build({
      root: webRoot,
      configFile: resolve(webRoot, "vite.config.ts"),
      logLevel: "warn",
      build: {
        ssr: resolve(webRoot, "src/entry-prerender.tsx"),
        outDir: ssrOutDir,
        emptyOutDir: true,
        ssrEmitAssets: false,
        rollupOptions: {
          // Force a predictable, always-ESM filename: apps/web/package.json
          // has no "type": "module", so a bare ".js" output could otherwise
          // resolve as CommonJS depending on Vite's module-type detection.
          output: { entryFileNames: "entry-prerender.mjs" },
        },
      },
    });

    const entryUrl = pathToFileURL(
      resolve(ssrOutDir, "entry-prerender.mjs"),
    ).href;
    const {
      html,
      buildHead,
      buildRobotsTxt,
      buildLlmsTxt,
      buildSitemapXml,
      buildJsonLd,
    } = await import(entryUrl);

    const indexPath = resolve(outDir, "index.html");
    let page = await readFile(indexPath, "utf8");

    page = page.replace(
      '<div id="root"></div>',
      `<div id="root">${html}</div>`,
    );
    // SEO-1's guard: fails the build if the string replace above ever
    // silently no-ops, rather than shipping an empty page.
    if (!page.includes("<h1")) {
      throw new Error(
        'prerender produced no markup: <div id="root"></div> was not found ' +
          "(or replaced with empty content) in dist/index.html",
      );
    }

    page = stripClientAssets(page);

    const dateModified = getDateModified(webRoot);
    const head = buildHead(origin);
    const jsonLd = buildJsonLd({ siteUrl: origin, dateModified });
    page = injectHead(page, head, jsonLd);

    const islandScriptTag = await buildIslandScriptTag(outDir);
    page = injectIslandScript(page, islandScriptTag);

    await writeFile(indexPath, page);
    await writeFile(resolve(outDir, "404.html"), build404Html(page));
    await writeFile(resolve(outDir, "robots.txt"), buildRobotsTxt(origin));
    await writeFile(resolve(outDir, "llms.txt"), buildLlmsTxt(origin));
    await writeFile(
      resolve(outDir, "sitemap.xml"),
      buildSitemapXml(origin, dateModified),
    );
  } finally {
    await rm(ssrOutDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === __filename) {
  await runPrerender({
    webRoot: WEB_ROOT,
    outDir: resolve(WEB_ROOT, "dist"),
    siteUrl: process.env.SITE_URL,
  });
}
