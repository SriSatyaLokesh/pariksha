// Minimal type shim for tokens.mjs, so apps/web/test/no-hex-colors.test.ts
// (which lives inside a strict TS project) can import it without tripping
// TS7016. A sibling .d.mts with a JS/.mjs file's basename is picked up by
// TypeScript automatically as that module's types — same pattern as
// prerender.d.mts beside prerender.mjs.

export function hasIllegalColorLiteral(content: string): boolean;

export const CSS_NAMED_COLORS: readonly string[];
