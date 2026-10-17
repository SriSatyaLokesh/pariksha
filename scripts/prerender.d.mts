// Minimal type shim for prerender.mjs, so apps/web/test/prerender.test.ts
// (which lives inside a strict TS project) can import it without tripping
// TS7016. A sibling .d.ts with a JS/.mjs file's basename is picked up by
// TypeScript automatically as that module's types.

export function resolveSiteUrl(raw: string | undefined): string;

export function runPrerender(options: {
  webRoot: string;
  outDir: string;
  siteUrl: string | undefined;
}): Promise<void>;

// v3 design contract §2.7: looks up the exam-demo island's hashed file in
// outDir's Vite manifest and returns its <script type="module"> tag.
export function buildIslandScriptTag(outDir: string): Promise<string>;
