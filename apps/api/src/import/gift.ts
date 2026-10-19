// Moodle GIFT import (#52, P4.8). Same contract as csv.ts: a converter
// never validates, it only reports what it could not parse at all — and
// GIFT covers exactly the same five types the CSV importer does (`single`,
// `multiple`, `true_false`, `numeric`, `fill_blank`), matching the PRD's
// CSV scope (D-01). Every other GIFT construct this format can write — a
// matching question (`->`), an essay (`{}`), a `$CATEGORY` line, a numeric
// range (`..`) — is a positioned error, never a silent skip: an author who
// sees "0 issues" must be able to trust that every question in the file
// made it in.
//
// `convertGift` splits the text on blank lines outside `{}` (a `{...}`
// block is never split even if it happens to span one), strips `//`
// comment lines, and recognises exactly the five forms below. `\x` unescapes
// to `x` everywhere — the general rule beneath GIFT's own escape set
// (`~ = # { } :`) and simpler to implement than naming each one.

import type { Bank, ImportIssue, Question } from "@pariksha/core";

export interface Converted {
  bank: Bank;
  /** `lines[i]` is the source line that produced `bank.questions[i]`. */
  lines: number[];
  issues: (ImportIssue & { line: number })[];
}

interface SourceLine {
  text: string;
  line: number;
}

interface Block {
  text: string;
  line: number;
}

/** Drops full-line `//` comments, keeping each surviving line's original
 * (1-based) line number so an issue can still point at the real file. */
function stripComments(text: string): SourceLine[] {
  return text
    .split("\n")
    .map((text, i) => ({ text, line: i + 1 }))
    .filter((l) => !/^\s*\/\//.test(l.text));
}

/** Blank lines separate blocks, except inside an unclosed `{...}` — tracked
 * here as brace depth across the whole block, not per line. */
function splitBlocks(lines: readonly SourceLine[]): Block[] {
  const blocks: Block[] = [];
  let current: SourceLine[] = [];
  let depth = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    blocks.push({ text: current.map((l) => l.text).join("\n"), line: current[0]!.line });
    current = [];
  };

  for (const l of lines) {
    if (l.text.trim() === "" && depth === 0) {
      flush();
      continue;
    }
    current.push(l);
    for (const ch of l.text) {
      if (ch === "{") depth += 1;
      else if (ch === "}" && depth > 0) depth -= 1;
    }
  }
  flush();
  return blocks;
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/** The first unescaped `{...}` in `text`, or null if there is none. */
function findBraces(text: string): { open: number; close: number } | null {
  let open = -1;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === "{" && open === -1) open = i;
    else if (text[i] === "}" && open !== -1) return { open, close: i };
    i += 1;
  }
  return null;
}

interface Entry {
  sigil: "~" | "=";
  weight: number;
  text: string;
}

const ENTRY_RE = /([~=])(?:%(-?\d+)%)?([^~=]*)/g;

function parseEntries(inner: string): Entry[] {
  const entries: Entry[] = [];
  for (const m of inner.matchAll(ENTRY_RE)) {
    const sigil = m[1] as "~" | "=";
    const weight = m[2] !== undefined ? Number(m[2]) : sigil === "=" ? 100 : 0;
    entries.push({ sigil, weight, text: unescape(m[3]!.trim()) });
  }
  return entries;
}

function parseBlock(
  block: Block,
  index: number,
  issue: (field: string, message: string) => void,
): Question | null {
  if (/^\s*\$CATEGORY\b/.test(block.text)) {
    issue("format", "$CATEGORY lines are not supported by GIFT import");
    return null;
  }

  let rest = block.text;
  let title: string | undefined;
  const titleMatch = /^::(.*?)::/.exec(rest);
  if (titleMatch) {
    title = titleMatch[1]!.trim() || undefined;
    rest = rest.slice(titleMatch[0].length);
  }
  const id = title ?? `q${index + 1}`;

  const braces = findBraces(rest);
  if (braces === null) {
    issue("format", "no GIFT answer block ({...}) found");
    return null;
  }
  const before = rest.slice(0, braces.open);
  const inner = rest.slice(braces.open + 1, braces.close);
  const after = rest.slice(braces.close + 1);
  const prompt = (): string => unescape((before + after).trim());
  const innerTrimmed = inner.trim();

  if (/^(TRUE|FALSE|T|F)$/i.test(innerTrimmed)) {
    return { id, type: "true_false", prompt: prompt(), key: /^T/i.test(innerTrimmed) };
  }

  if (innerTrimmed === "") {
    issue("format", "GIFT essay questions ({}) are not supported");
    return null;
  }

  if (innerTrimmed.startsWith("#")) {
    const spec = innerTrimmed.slice(1).trim();
    if (spec.includes("..")) {
      issue("key", "GIFT numeric ranges (min..max) are not supported");
      return null;
    }
    const [value, tolerance] = spec.split(":");
    return {
      id,
      type: "numeric",
      prompt: prompt(),
      key: {
        value: Number(value),
        ...(tolerance !== undefined && tolerance !== "" ? { tolerance: Number(tolerance) } : {}),
      },
    };
  }

  if (innerTrimmed.includes("->")) {
    issue("format", "GIFT matching questions (->) are not supported");
    return null;
  }

  const entries = parseEntries(innerTrimmed);
  if (entries.length === 0) {
    issue("format", "unrecognised GIFT answer block");
    return null;
  }

  if (!entries.some((e) => e.sigil === "~")) {
    // Every entry is `=`: a fill-in-the-blank with one or more accepted
    // answers, not a multiple-choice list — GIFT tells the two apart by
    // whether any `~` (wrong answer) entry is present at all.
    const blankId = "a";
    return {
      id,
      type: "fill_blank",
      prompt: `${unescape(before)}{{${blankId}}}${unescape(after)}`.trim(),
      blanks: [{ id: blankId, accepted: entries.map((e) => e.text) }],
    };
  }

  const options = entries.map((e) => ({ id: e.text, text: e.text }));
  const positive = entries.filter((e) => e.weight > 0);
  if (positive.length > 1) {
    return { id, type: "multiple", prompt: prompt(), options, key: positive.map((e) => e.text) };
  }
  const correct = positive[0] ?? entries.find((e) => e.sigil === "=") ?? entries[0]!;
  return { id, type: "single", prompt: prompt(), options, key: correct.text };
}

export function convertGift(text: string): Converted {
  const blocks = splitBlocks(stripComments(text));
  const bank: Bank = { format: "pariksha/bank@1", name: "Imported bank", questions: [] };
  const lines: number[] = [];
  const issues: (ImportIssue & { line: number })[] = [];

  for (const block of blocks) {
    const question = parseBlock(block, bank.questions.length, (field, message) => {
      issues.push({ questionId: null, index: -1, field, message, line: block.line });
    });
    if (question !== null) {
      bank.questions.push(question);
      lines.push(block.line);
    }
  }

  return { bank, lines, issues };
}
