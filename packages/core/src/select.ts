// Picks which questions a candidate sees (fixed list, pool draw, or one of
// several sets) and in what order, and which set a candidate is assigned to.
// All randomness is seeded (`makeRng`/`shuffle` from `rng.ts`) — no
// `Math.random()`, per the package-wide constraint.

import { makeRng, shuffle, shuffleOptions } from "./rng.js";
import type { PoolFilter, Question, Section, SetAssignment } from "./types.js";

/** A pool section asked for more questions than its filter matched. */
export class PoolTooSmallError extends Error {
  readonly sectionId: string;
  readonly wanted: number;
  readonly available: number;

  constructor(sectionId: string, wanted: number, available: number) {
    super(`section "${sectionId}" asked for ${wanted} questions but only ${available} matched its filter`);
    this.name = "PoolTooSmallError";
    this.sectionId = sectionId;
    this.wanted = wanted;
    this.available = available;
  }
}

function findQuestion(bank: readonly Question[], id: string): Question {
  const question = bank.find((q) => q.id === id);
  if (!question) throw new Error(`question "${id}" not found in bank`);
  return question;
}

function matchesFilter(question: Question, filter: PoolFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.tags && !filter.tags.some((tag) => question.tags?.includes(tag))) return false;
  if (filter.difficulty && (question.difficulty === undefined || !filter.difficulty.includes(question.difficulty)))
    return false;
  if (filter.types && !filter.types.includes(question.type)) return false;
  return true;
}

/** Draws/picks the questions for one section, before question-order shuffling. */
function pickQuestions(section: Section, bank: readonly Question[], seed: string, setNo: string | undefined): Question[] {
  const source = section.source;
  switch (source.kind) {
    case "fixed":
      return source.questions.map((id) => findQuestion(bank, id));

    case "pool": {
      const matching = bank.filter((q) => matchesFilter(q, source.filter));
      if (matching.length < source.count) {
        throw new PoolTooSmallError(section.id, source.count, matching.length);
      }
      return shuffle(matching, makeRng(`${seed}:${section.id}:pool-draw`)).slice(0, source.count);
    }

    case "sets": {
      const set = source.sets.find((s) => s.set === setNo);
      if (!set) throw new Error(`section "${section.id}" has no set "${setNo ?? "(none given)"}"`);
      return set.questions.map((id) => findQuestion(bank, id));
    }
  }
}

export function selectForSection(input: { section: Section; bank: Question[]; seed: string; setNo?: string }): Question[] {
  const { section, bank, seed, setNo } = input;
  const picked = pickQuestions(section, bank, seed, setNo);
  if (section.shuffle_questions === false) return picked;
  return shuffle(picked, makeRng(`${seed}:${section.id}:question-order`));
}

function pickAt(sets: readonly string[], index: number): string {
  const set = sets[index];
  if (set === undefined) throw new RangeError("set index out of range");
  return set;
}

export function assignSet(input: {
  sets: readonly string[];
  assignment: SetAssignment;
  registrationIndex: number;
  candidateId: string;
  listValue?: string;
}): string {
  const { sets, assignment, registrationIndex, candidateId, listValue } = input;
  if (sets.length === 0) throw new Error("assignSet requires at least one set");

  switch (assignment) {
    case "round_robin":
      return pickAt(sets, registrationIndex % sets.length);

    case "hash":
      // Stable per candidate: the seed is the candidate ID alone, so the
      // same candidate always lands on the same set across attempts.
      return pickAt(sets, Math.floor(makeRng(candidateId)() * sets.length));

    case "random":
      // Deterministic (no Math.random in this package), but not pinned to
      // the candidate alone — two registrations don't need the same draw.
      return pickAt(sets, Math.floor(makeRng(`${candidateId}:${registrationIndex}`)() * sets.length));

    case "from_candidate_list":
      if (listValue === undefined) {
        throw new Error(`from_candidate_list assignment requires a listValue for candidate "${candidateId}"`);
      }
      return listValue;
  }
}

export interface AttemptLayout {
  sections: { sectionId: string; questionIds: string[]; optionOrder: Record<string, string[]> }[];
  setNo?: string;
}

export function layoutForAttempt(input: {
  sections: Section[];
  bank: Question[];
  seed: string;
  setNo?: string;
}): AttemptLayout {
  const { sections, bank, seed, setNo } = input;

  const layoutSections = sections.map((section) => {
    const questions =
      setNo === undefined ? selectForSection({ section, bank, seed }) : selectForSection({ section, bank, seed, setNo });
    const optionOrder: Record<string, string[]> = {};

    for (const question of questions) {
      if (!("options" in question)) continue;
      const ordered =
        question.shuffle_options === false
          ? question.options
          : shuffleOptions(question.options, makeRng(`${seed}:${section.id}:${question.id}:options`));
      optionOrder[question.id] = ordered.map((o) => o.id);
    }

    return { sectionId: section.id, questionIds: questions.map((q) => q.id), optionOrder };
  });

  return setNo === undefined ? { sections: layoutSections } : { sections: layoutSections, setNo };
}
