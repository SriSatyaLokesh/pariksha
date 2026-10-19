// What a candidate is allowed to see of a question (`S-10`).
//
// **An allowlist, not a denylist.** `forCandidate` builds the candidate's
// shape field by field out of a `switch` over the twelve question types,
// rather than copying the stored document and deleting `key`,
// `explanation` and the rest. The difference is what happens to the field
// somebody adds next phase: a denylist ships it to every candidate in the
// country and a reviewer has to notice, an allowlist drops it and the
// author has to come here and say it is safe. Review Focus 5.
//
// The same rule is why `tags`, `difficulty` and `scoring.mode` are absent:
// `tags` names the pool filter a question was drawn by, `difficulty` is
// the organiser's own labelling, and neither is anything a candidate under
// a clock can act on.
//
// Task 12 proves this complete by scanning every candidate-reachable
// route's body; this is the first version of it, and the one `/start`
// pins into `layout_json`.

import type { Media, PassageGroup, Question, QuestionOption, QuestionType } from "@pariksha/core";

/** One question as the candidate sees it. Every field here is either
 *  something they must read to answer, or something they must send back. */
export interface CandidateQuestion {
  /** The `qst_` row id, which is also what `response.question_id` stores.
   *  Opaque and random — it names no bank, no test and no other
   *  candidate — and it is the only id that is unique across the banks one
   *  paper can draw from (`LOG-001` is not). */
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  media?: { kind: "image"; src: string; alt: string }[];
  /** Already in this candidate's pinned order (`T-10`, `AC-11`). */
  options?: { id: string; text: string }[];
  left?: string[];
  right?: string[];
  items?: string[];
  /** The blanks to fill, by id and nothing else — `accepted` is the key. */
  blanks?: { id: string }[];
  unit?: string;
  assertion?: string;
  reason?: string;
  maxLength?: number;
  k?: number;
  /** The shared passage, resolved from the bank the question belongs to —
   *  a comprehension question without it is unanswerable. */
  group?: { id: string; passage: string };
}

export interface ForCandidateOptions {
  /** The pinned option order for this question, from `layout.optionOrder`.
   *  Absent for a question with no options. */
  optionOrder?: readonly string[];
  /**
   * Prefixed to every `media.src`. Task 5 passes `""`, so the paper
   * carries the storage key `layout.media` was pinned from and the key
   * `PUT`/`GET` compare against; Task 7's candidate media route is what
   * turns it into a URL, in one place rather than at every call site.
   */
  mediaBase: string;
  group?: PassageGroup;
}

/** The stored order, re-sorted into the pinned one. Ids the layout does
 *  not name keep their stored position at the end, which cannot happen
 *  through `/start` (the layout is built from these very options) but
 *  would otherwise silently drop a candidate's answer choice if a later
 *  writer ever disagreed. */
function ordered(
  options: readonly QuestionOption[],
  order: readonly string[] | undefined,
): QuestionOption[] {
  if (order === undefined) return [...options];
  const byId = new Map(options.map((option) => [option.id, option]));
  const picked = order.flatMap((id) => {
    const option = byId.get(id);
    return option ? [option] : [];
  });
  const named = new Set(order);
  return [...picked, ...options.filter((option) => !named.has(option.id))];
}

const choices = (
  options: readonly QuestionOption[],
  order: readonly string[] | undefined,
): { id: string; text: string }[] =>
  ordered(options, order).map((option) => ({ id: option.id, text: option.text }));

const shown = (media: readonly Media[] | undefined, base: string): CandidateQuestion["media"] =>
  media?.map((one) => ({ kind: "image" as const, src: `${base}${one.src}`, alt: one.alt }));

export function forCandidate(q: Question, opts: ForCandidateOptions): CandidateQuestion {
  const media = shown(q.media, opts.mediaBase);
  const base: CandidateQuestion = {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    // The same fallback `resolveScoring` and `toQuestionRecord` apply, so
    // the number on the paper is the number the grader will use.
    points: q.scoring?.points ?? 1,
    ...(media === undefined ? {} : { media }),
    ...(opts.group === undefined
      ? {}
      : { group: { id: opts.group.id, passage: opts.group.passage } }),
  };

  switch (q.type) {
    case "single":
    case "multiple":
      return { ...base, options: choices(q.options, opts.optionOrder) };
    case "select_k":
      return { ...base, options: choices(q.options, opts.optionOrder), k: q.k };
    case "true_false":
      return base;
    case "assertion_reason":
      return { ...base, assertion: q.assertion, reason: q.reason };
    case "matching":
    case "multi_matching":
      return { ...base, left: [...q.left], right: [...q.right] };
    case "ordering":
      return { ...base, items: [...q.items] };
    case "fill_blank":
      // The ids only. `accepted` and `match` are the key.
      return { ...base, blanks: q.blanks.map((blank) => ({ id: blank.id })) };
    case "numeric":
      // No `key`, so no value and no tolerance — a tolerance is half the
      // answer on a question whose answer is a number.
      return { ...base, ...(q.unit === undefined ? {} : { unit: q.unit }) };
    case "short_answer":
    case "long_answer":
      // `model_answer` and `rubric` are the key and the marking guide.
      return { ...base, ...(q.max_length === undefined ? {} : { maxLength: q.max_length }) };
  }
}

/**
 * Every storage key the selected questions reference, de-duplicated and
 * in a stable order.
 *
 * This is what `/start` pins into `layout.media`, and Task 7's candidate
 * media route authorises by membership in it. So the two failure modes
 * are not symmetrical and both are bad: a key missed here is an image the
 * candidate cannot load in the middle of a timed paper, and a key added
 * here that their paper does not use is a question from somebody else's
 * set they can fetch.
 */
export function mediaKeysOf(questions: readonly Question[]): string[] {
  const keys = new Set<string>();
  for (const question of questions) {
    for (const one of question.media ?? []) keys.add(one.src);
  }
  return [...keys];
}
