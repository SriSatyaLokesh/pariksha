import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "./routes/landing";

// The only module that imports the landing tree for Node. scripts/prerender.mjs
// SSR-bundles this file with Vite and imports the built output, so JSX/TS
// resolve correctly outside the browser. Design contract SEO-1 (no new
// dependency: react-dom/server ships with react-dom).
export const html = renderToStaticMarkup(<Landing />);

// Re-exported so the one SSR bundle also carries the head/file/JSON-LD
// builders Assignment D owns (apps/web/src/seo/) — prerender.mjs needs only
// this one module to produce the whole page.
export { buildHead } from "./seo/head";
export { buildRobotsTxt, buildLlmsTxt, buildSitemapXml } from "./seo/files";
export { buildJsonLd } from "./seo/jsonld";
