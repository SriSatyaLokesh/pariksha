// `Q4c`, mechanical: every `storage.put()` call site reachable from
// `apps/api/src` must declare an `image/` content type — never `audio/`,
// never `video/`, never anything else. `AG2` ("no video or audio is ever
// recorded or stored") is a promise about every write, not only the one
// Task 1 adds, so this scans the whole tree rather than one file.
//
// `enumeratePutCallSites` is a TEXT scan, not a type-checker, and it is
// scoped on purpose: only `storage.put(` / `store.put(` call sites whose
// third argument is an object LITERAL naming `contentType` are call
// sites at all. `instrument.ts`'s `store.put(key, body, opts)` forwards an
// opaque `opts` it never literally declares — it is a passthrough, not a
// writer, so it is correctly invisible here. `routes.put(...)` (Hono's PUT
// method, `run/attempt.ts`) never matches `storage.put(`/`store.put(` at
// all.
//
// A literal `contentType: "image/jpeg"` resolves directly. A shorthand
// `{ contentType }` (`routes/media.ts`) cannot be resolved to one literal
// by text alone — the real value comes off a request header at runtime —
// so the fallback asks the weaker, still-real question a text scan CAN
// answer: does this file use `contentType` only after narrowing it through
// an allowlist whose own literal keys are entirely `image/*`? Every
// MIME-shaped string literal in the file is collected; if the set is
// non-empty and every member is `image/*`, the call site is accepted. This
// is what the probe (step 5) breaks: swap one of those literals for a
// non-image type and the scan goes red.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../..");

/** Strips `//` and `/* *‍/` comments so a `put(` or a `"image/..."` written
 *  only in prose cannot satisfy — or fail — the scan. The same reason
 *  `apps/web/test/css-chain.ts`'s `stripCssComments` and
 *  `no-hex-colors.test.ts`'s scan both strip comments before matching. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walkTsFiles(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** The index just past the `(` matching the one at `openIdx`. Parens only —
 *  no quote-awareness — which is exactly enough for this repo's call
 *  sites (ponytail: a string literal with an unmatched paren would
 *  mis-scan; none of the real call sites have one). */
function matchParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced parens from index ${String(openIdx)}`);
}

/** Splits a call's argument text on top-level commas, ignoring commas
 *  inside nested brackets or a backtick template literal. */
function splitTopLevelArgs(argsText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inBacktick = false;
  let current = "";
  for (const ch of argsText) {
    if (ch === "`") inBacktick = !inBacktick;
    if (!inBacktick) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      else if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current);
  return parts.map((p) => p.trim());
}

const MIME_LITERAL_RE = /["']([a-z]+\/[\w.+-]+)["']/g;

/** Every MIME-shaped string literal in `fileText`, deduped. */
function mimeLiteralsIn(fileText: string): string[] {
  return [...new Set([...fileText.matchAll(MIME_LITERAL_RE)].map((m) => m[1] as string))];
}

/** Resolves a shorthand `{ contentType }`'s declared type the only way a
 *  text scan can: every MIME literal the file carries must be `image/*`,
 *  and there must be at least one. Returns a synthetic `"image/*"` on
 *  success (it only needs to match `/^image\//`) or the empty string
 *  (always a scan failure) otherwise. */
function resolveShorthandContentType(fileText: string): string {
  const mimes = mimeLiteralsIn(fileText);
  if (mimes.length > 0 && mimes.every((m) => m.startsWith("image/"))) return "image/*";
  return "";
}

export interface PutCallSite {
  file: string;
  line: number;
  contentType: string;
}

const PUT_CALL_RE = /\b(?:storage|store)\.put\(/g;

/** Every `storage.put()` / `store.put()` call site under `dir` (relative
 *  to the repo root) whose options argument is an object literal naming
 *  `contentType` — with that type resolved per the header above. */
export function enumeratePutCallSites(dir: string): PutCallSite[] {
  const sites: PutCallSite[] = [];
  for (const file of walkTsFiles(resolve(REPO_ROOT, dir))) {
    const raw = readFileSync(file, "utf8");
    const text = stripTsComments(raw);
    for (const match of text.matchAll(PUT_CALL_RE)) {
      const openIdx = match.index + match[0]!.length - 1;
      const closeIdx = matchParen(text, openIdx);
      const args = splitTopLevelArgs(text.slice(openIdx + 1, closeIdx));
      const opts = args[2];
      if (opts === undefined || !opts.startsWith("{")) continue; // a passthrough, not a declaration

      const literal = /contentType\s*:\s*["']([^"']+)["']/.exec(opts);
      let contentType: string;
      if (literal) {
        contentType = literal[1] as string;
      } else if (/(?:^|[{,])\s*contentType\s*(?:,|$|})/.test(opts)) {
        contentType = resolveShorthandContentType(text);
      } else {
        continue; // no `contentType` named at this call site at all
      }

      const line = text.slice(0, match.index).split("\n").length;
      sites.push({ file: relative(REPO_ROOT, file).replaceAll("\\", "/"), line, contentType });
    }
  }
  return sites;
}

it("every storage write reachable from the runtime declares an image content type", () => {
  const sites = enumeratePutCallSites("apps/api/src");
  // A guard that silently found nothing would pass whatever the tree did.
  expect(sites.length).toBeGreaterThan(0);
  for (const site of sites) {
    expect(site.contentType, `${site.file}:${String(site.line)}`).toMatch(/^image\//);
  }
});
