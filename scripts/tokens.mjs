// Generates apps/web/src/styles/tokens.css and tokens.ts from DESIGN.md's
// YAML front matter. Run with `pnpm tokens` (or `node scripts/tokens.mjs`).
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname, sep } from "node:path";
import process from "node:process";
import { parse as parseYaml } from "yaml";
import * as prettier from "prettier";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "..");
export const DESIGN_MD_PATH = join(REPO_ROOT, "DESIGN.md");
export const CSS_OUTPUT_PATH = join(
  REPO_ROOT,
  "apps/web/src/styles/tokens.css",
);
export const TS_OUTPUT_PATH = join(REPO_ROOT, "apps/web/src/styles/tokens.ts");

const GENERATED_NOTICE =
  "GENERATED FILE. Do not edit by hand — generated from DESIGN.md by scripts/tokens.mjs.";

const HEADER_CSS = `/* ${GENERATED_NOTICE} */`;
const HEADER_TS = `// ${GENERATED_NOTICE}`;

// Matches a front-matter reference like "{colors.voltage}" or
// "{typography.display-xl}".
const REF_RE = /^\{(colors|typography|rounded|spacing)\.([a-zA-Z0-9-]+)\}$/;

function resolveValue(value, tokens) {
  if (typeof value !== "string") return value;
  const match = REF_RE.exec(value);
  if (!match) return value;
  const [, group, key] = match;
  const groupTokens = tokens[group];
  if (!groupTokens || !(key in groupTokens)) {
    throw new Error(`DESIGN.md references unknown token {${group}.${key}}`);
  }
  return groupTokens[key];
}

function resolveComponents(rawComponents, tokens) {
  const resolved = {};
  for (const [name, fields] of Object.entries(rawComponents)) {
    const resolvedFields = {};
    for (const [field, value] of Object.entries(fields)) {
      resolvedFields[field] = resolveValue(value, tokens);
    }
    resolved[name] = resolvedFields;
  }
  return resolved;
}

/**
 * Parses DESIGN.md's YAML front matter into colors, typography, rounded,
 * spacing and components. Component fields that reference another token
 * (e.g. `{colors.voltage}`) are resolved to their concrete value.
 */
export function parseDesignTokens(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) {
    throw new Error("DESIGN.md is missing its YAML front matter");
  }
  const front = parseYaml(match[1]);
  const { colors, typography, rounded, spacing, components } = front;
  const tokens = { colors, typography, rounded, spacing };
  return { ...tokens, components: resolveComponents(components, tokens) };
}

// The colour tables (and, for Data, prose) in DESIGN.md's "## Colors"
// section that state a measured contrast ratio against cream.
const CONTRAST_SECTIONS = [
  { heading: "Brand", kind: "table" },
  { heading: "Text", kind: "table" },
  { heading: "Hairline", kind: "table" },
  { heading: "Attempt state", kind: "table" },
  { heading: "Integrity state", kind: "table" },
  { heading: "Data", kind: "prose" },
];

function extractSection(markdown, heading) {
  const startRe = new RegExp(`^### ${heading}\\n`, "m");
  const startMatch = startRe.exec(markdown);
  if (!startMatch) {
    throw new Error(`DESIGN.md is missing the "### ${heading}" section`);
  }
  const contentStart = startMatch.index + startMatch[0].length;
  const nextHeadingRe = /\n#{2,3} /g;
  nextHeadingRe.lastIndex = contentStart;
  const next = nextHeadingRe.exec(markdown);
  const contentEnd = next ? next.index : markdown.length;
  return markdown.slice(contentStart, contentEnd);
}

function parseRatio(cell) {
  const match = /^\*{0,2}([\d.]+):1\*{0,2}$/.exec(cell.trim());
  return match ? Number(match[1]) : null;
}

function parseTableRows(section) {
  const rowRe =
    /^\|\s*`\{colors\.([a-zA-Z0-9-]+)\}`\s*\|\s*#[0-9a-fA-F]{3,8}\s*\|\s*([^|]+?)\s*\|/gm;
  const rows = [];
  let match;
  while ((match = rowRe.exec(section))) {
    const [, token, ratioCell] = match;
    const stated = parseRatio(ratioCell);
    if (stated === null) continue; // "—" or otherwise unstated: skip
    rows.push({ token, stated });
  }
  return rows;
}

function parseProseRow(section) {
  const match =
    /`\{colors\.([a-zA-Z0-9-]+)\}`\s*\(#[0-9a-fA-F]{3,8},\s*\*{0,2}([\d.]+):1\*{0,2}\)/.exec(
      section,
    );
  return match ? [{ token: match[1], stated: Number(match[2]) }] : [];
}

/**
 * Parses DESIGN.md's colour tables into { token, fg, bg, stated } entries —
 * every stated contrast ratio, measured against cream unless the table says
 * otherwise (none of these sections state otherwise).
 */
export function parseContrastPairs(markdown, colors) {
  const bg = colors.cream;
  const pairs = [];
  for (const { heading, kind } of CONTRAST_SECTIONS) {
    const section = extractSection(markdown, heading);
    const rows =
      kind === "table" ? parseTableRows(section) : parseProseRow(section);
    for (const { token, stated } of rows) {
      const fg = colors[token];
      if (!fg) {
        throw new Error(
          `DESIGN.md's "${heading}" section references unknown color token "${token}"`,
        );
      }
      pairs.push({ token, fg, bg, stated });
    }
  }
  return pairs;
}

async function formatWith(parser, source) {
  const config = (await prettier.resolveConfig(REPO_ROOT)) ?? {};
  return prettier.format(source, { ...config, parser });
}

/** Renders a `:root { … }` block with one custom property per flat token. */
export async function toCss(tokens) {
  const lines = [];
  for (const [name, value] of Object.entries(tokens.colors)) {
    lines.push(`--color-${name}: ${value};`);
  }
  for (const [name, type] of Object.entries(tokens.typography)) {
    lines.push(`--type-${name}-size: ${type.fontSize};`);
    lines.push(`--type-${name}-weight: ${type.fontWeight};`);
    lines.push(`--type-${name}-line-height: ${type.lineHeight};`);
    lines.push(`--type-${name}-letter-spacing: ${type.letterSpacing};`);
    lines.push(`--type-${name}-family: ${type.fontFamily};`);
    if (type.fontVariantNumeric !== undefined) {
      lines.push(
        `--type-${name}-font-variant-numeric: ${type.fontVariantNumeric};`,
      );
    }
  }
  for (const [name, value] of Object.entries(tokens.rounded)) {
    lines.push(`--rounded-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(tokens.spacing)) {
    lines.push(`--space-${name}: ${value};`);
  }
  const source = `${HEADER_CSS}\n\n:root {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n`;
  return formatWith("css", source);
}

/**
 * Renders the TS module: `tokens` (colors, typography, rounded, spacing and
 * components — components fully resolved, no `{…}` references left) and
 * `contrastPairs`, plus the keyof types the app needs to index them.
 */
export async function toTs(tokens, contrastPairs) {
  const source = `${HEADER_TS}

export const tokens = ${JSON.stringify(tokens, null, 2)} as const;

export const contrastPairs = ${JSON.stringify(contrastPairs, null, 2)} as const;

export type ColorName = keyof typeof tokens.colors;
export type TypographyName = keyof typeof tokens.typography;
export type RoundedName = keyof typeof tokens.rounded;
export type SpacingName = keyof typeof tokens.spacing;
export type ComponentName = keyof typeof tokens.components;
export type ContrastPair = (typeof contrastPairs)[number];
`;
  return formatWith("typescript", source);
}

// Issue-137 widening (T28, constraints.md §2.1): a colour literal is no
// longer just a hex code. `rgb()`/`rgba()`/`hsl()`/`hsla()`/`oklch()`/`lab()`
// and the standard CSS named-colour keywords are all illegal too, with one
// carve-out: `rgb(from var(--color-NAME) r g b / <alpha>)` — the relative-
// colour syntax `base.css` and `components.css` already use twice. Exported
// so no-hex-colors.test.ts can widen its own guard from the exact same
// definition rather than a hand-kept copy that could drift out of sync.
const HEX_LITERAL_RE = /#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

const COLOR_FUNCTION_RE =
  /\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(((?:[^()]|\([^()]*\))*)\)/gi;

function isLegalColorFunctionArgs(args) {
  return /^\s*from\s+var\(--color-[a-zA-Z0-9-]+\)/.test(args);
}

// The standard CSS named-colour keywords (CSS Color Module, level 4) —
// excluding "transparent" and "currentcolor", which are layout keywords
// this codebase uses legitimately (e.g. `background: transparent`,
// `color: inherit`), not colours needing a token.
export const CSS_NAMED_COLORS = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige",
  "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown",
  "burlywood", "cadetblue", "chartreuse", "chocolate", "coral",
  "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki",
  "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred",
  "darksalmon", "darkseagreen", "darkslateblue", "darkslategray",
  "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
  "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite",
  "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod",
  "gray", "grey", "green", "greenyellow", "honeydew", "hotpink",
  "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush",
  "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue",
  "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow",
  "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen",
  "mediumslateblue", "mediumspringgreen", "mediumturquoise",
  "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin",
  "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise",
  "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum",
  "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue",
  "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna",
  "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow",
  "springgreen", "steelblue", "tan", "teal", "thistle", "tomato",
  "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow",
  "yellowgreen",
];

// Hyphen-aware boundaries, not `\b`: `white-space` must never flag as the
// named colour "white" (`\b` fires on the letter/hyphen transition; a plain
// `\bwhite\b` would match the first half of that property name).
const NAMED_COLOR_RE = new RegExp(
  `(?<![a-zA-Z0-9_-])(?:${CSS_NAMED_COLORS.join("|")})(?![a-zA-Z0-9_-])`,
  "i",
);

// Block comments (CSS, and JS/TS, which share the /* */ form) and HTML
// comments only — never `//`, which would also eat `https://` inside a
// quoted URL. Comment prose legitimately says things like "checked on both
// white and cream" without authoring a colour.
function stripCommentsForScan(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * True if `content` contains any illegal colour literal: a hex code, a
 * named-colour keyword, or a colour function whose first argument is not
 * the one legal relative-colour form `from var(--color-NAME)`. BLOCK and
 * HTML comments are ignored — this checks authored code, not prose about
 * colour — but a `//` line comment is NOT, deliberately, for the reason
 * `stripCommentsForScan` above gives: stripping it would also eat
 * `https://` inside a quoted URL. So a colour keyword in prose in a line
 * comment reads as a colour literal here. That is a known cost, not a bug;
 * the fix is to reword the prose, which 6.5e Task 8 did after meeting it.
 */
export function hasIllegalColorLiteral(content) {
  const scanned = stripCommentsForScan(content);
  if (HEX_LITERAL_RE.test(scanned)) return true;
  if (NAMED_COLOR_RE.test(scanned)) return true;
  for (const match of scanned.matchAll(COLOR_FUNCTION_RE)) {
    if (!isLegalColorFunctionArgs(match[1])) return true;
  }
  return false;
}

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html"]);

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Lists .ts/.tsx/.css/.html files under `dir` that contain a hex colour
 * literal, excluding the paths in `except` (relative to `dir`). A missing
 * or empty `dir` yields no offending files.
 */
export function filesWithHexLiterals(dir, { except = [] } = {}) {
  if (!existsSync(dir)) return [];
  const exceptSet = new Set(except.map((p) => p.split("/").join(sep)));
  return walk(dir)
    .filter((file) => !exceptSet.has(relative(dir, file)))
    .filter((file) => hasIllegalColorLiteral(readFileSync(file, "utf8")));
}

async function main() {
  const markdown = readFileSync(DESIGN_MD_PATH, "utf8");
  const tokens = parseDesignTokens(markdown);
  const contrastPairs = parseContrastPairs(markdown, tokens.colors);
  writeFileSync(CSS_OUTPUT_PATH, await toCss(tokens));
  writeFileSync(TS_OUTPUT_PATH, await toTs(tokens, contrastPairs));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
