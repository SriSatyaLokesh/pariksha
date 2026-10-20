import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// One `@import` resolver for the whole test suite.
//
// `contrast-usage.test.ts` has had this since P3.9; Phase 6 Task 7's
// no-animation gate grew a second, narrower copy of it (fix round 1) that
// resolved every import against the ENTRY file's directory instead of
// against the importing file's, so a nested import from a subdirectory
// would have been read from the wrong place or silently not at all — a
// resolver that quietly returns less than the stylesheet is a gate that
// quietly checks less than it claims. Both now call this.
//
// `./name.css` is the only import form this repo's stylesheets use, and
// that is deliberate: a bare-specifier or URL import would reach outside
// the bundle Vite assembles.
const IMPORT_RE = /@import\s+["']\.\/([a-zA-Z0-9_-]+\.css)["'];?/g;

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * `path`'s CSS with every `@import` inlined — the stylesheet a browser
 * really assembles from that entry. Comments are stripped, so a rule
 * named only in prose cannot satisfy a scan.
 *
 * `seen` guards against an import cycle and lets a caller read several
 * entries that share an import without double-counting it; pass one
 * shared set for that, or omit it to resolve an entry on its own.
 */
export function readResolvedCss(path: string, seen: Set<string> = new Set()): string {
  if (seen.has(path)) return "";
  seen.add(path);
  const raw = stripCssComments(readFileSync(path, "utf8"));
  // Relative to the IMPORTING file, not to the entry — which is what the
  // narrower copy got wrong.
  return raw.replace(IMPORT_RE, (_whole, file: string) =>
    readResolvedCss(resolve(dirname(path), file), seen),
  );
}
