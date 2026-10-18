// The mapping between a `Question` document (packages/core/src/types.ts) and
// the `question` table's row shape.
//
// Kept out of banks.ts and out of `repo/index.ts`'s barrel for the reason
// identity.ts already states for itself: this is not a workspace-scoped
// repository function, it is a pure data mapping, and folding it into the
// barrel would force `scoping.test.ts` to carve an exception for it. Task 7
// (import/export) uses these two functions directly, with no database in
// the loop at all.
//
// ADR 0004: the Markdown document is the one stored representation. There is
// no rendered HTML and no second copy to keep in step. `points`,
// `difficulty` and `tags_json` are pulled onto their own columns only so
// `listQuestions` can filter and sort in SQL instead of parsing every row's
// JSON — they are never read back as authoritative, `extra_json` and the
// rest of the document always win on the way out.

import type { Question } from "@pariksha/core";

/** The document-shaped half of the `question` table's columns. */
export interface QuestionRecord {
  ref_id: string;
  group_ref: string | null;
  type: string;
  prompt_md: string;
  media_json: unknown;
  options_json: unknown;
  key_json: unknown;
  scoring_json: unknown;
  points: number;
  difficulty: string | null;
  tags_json: unknown;
  explanation_md: string | null;
  extra_json: unknown;
}

// Fields a dedicated column already carries. Everything else a question
// document holds (k, assertion/reason, left/right, items, blanks, unit,
// max_length, model_answer, rubric, shuffle_options, $schema — one set per
// type, per packages/core/src/types.ts) has no column of its own and
// round-trips through `extra_json` wholesale.
const KNOWN_FIELDS = new Set([
  "$schema",
  "id",
  "type",
  "prompt",
  "media",
  "group",
  "difficulty",
  "tags",
  "scoring",
  "explanation",
  "options",
  "key",
]);

/**
 * Review Focus item 2: `extra_json` is rebuilt from `doc` on every call,
 * never read from an existing row and merged — so a field an edit removes
 * from the document is gone from the row too, not left behind as a ghost.
 */
export function toQuestionRow(doc: Question): QuestionRecord {
  const raw = doc as unknown as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (!KNOWN_FIELDS.has(field)) extra[field] = value;
  }
  return {
    ref_id: doc.id,
    group_ref: doc.group ?? null,
    type: doc.type,
    prompt_md: doc.prompt,
    media_json: doc.media ?? null,
    options_json: raw.options ?? null,
    key_json: raw.key ?? null,
    scoring_json: doc.scoring ?? null,
    points: doc.scoring?.points ?? 1,
    difficulty: doc.difficulty ?? null,
    tags_json: doc.tags ?? [],
    explanation_md: doc.explanation ?? null,
    extra_json: Object.keys(extra).length > 0 ? extra : null,
  };
}

export function toQuestionDocument(row: QuestionRecord): Question {
  const extra = (row.extra_json ?? {}) as Record<string, unknown>;
  return {
    ...extra,
    id: row.ref_id,
    type: row.type,
    prompt: row.prompt_md,
    group: row.group_ref ?? undefined,
    media: row.media_json ?? undefined,
    options: row.options_json ?? undefined,
    key: row.key_json ?? undefined,
    scoring: row.scoring_json ?? undefined,
    difficulty: row.difficulty ?? undefined,
    tags: row.tags_json ?? undefined,
    explanation: row.explanation_md ?? undefined,
  } as Question;
}
