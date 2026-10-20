// Task 5 (#69, P6.5): a real question bank, and the tests drawn from it.
//
// Every fixture in `fixtures.ts` names `qst_` ids that were never
// written, because no route before `/start` reads the bank. `/start`
// does, so these are the first fixtures with questions behind them —
// kept in their own file so the suites that do not need a bank keep
// paying nothing for one.

import { createBank, replaceCandidateList, upsertGroup, upsertQuestions } from "@pariksha/db";
import type { Question, SetAssignment, SingleQuestion } from "@pariksha/core";
import type { AppDeps } from "../../src/app.js";
import { FIXED_NOW } from "../deps.js";
import { CONSENT, DAY, iso, seedTest } from "./fixtures.js";

/** A choice question carrying everything `S-10` must strip. */
const single = (ref: string, extra: Partial<SingleQuestion> = {}): Question => ({
  id: ref,
  type: "single",
  prompt: `What does ${ref} ask?`,
  options: [
    { id: "a", text: "The first option" },
    { id: "b", text: "The second option" },
    { id: "c", text: "The third option" },
    { id: "none-of-the-above", text: "None of the above" },
  ],
  key: "a",
  scoring: { points: 2 },
  explanation: `Because ${ref} says so.`,
  ...extra,
});

/** `qst_` row ids, by the `ref_id` the fixture names them with, plus the
 *  bank's own id under `bank`. */
export type QuestionIds = Readonly<Record<string, string>>;

/**
 * One bank holding every question the Task 5 tests draw from.
 *
 * `LOG-*` are the fixed section — one with pinned options, one with
 * media, and two whose stored documents carry a model answer, a rubric
 * and a list of accepted spellings. `QNT-*` are the pool, each with
 * media of its own so "the layout pins the selected keys and nothing
 * else" has undrawn keys to be wrong about. `CMP-1` hangs off a passage.
 */
export async function seedBank(deps: AppDeps, workspaceId: string): Promise<QuestionIds> {
  const bankId = await createBank(deps.db, workspaceId, { name: "Aptitude bank", now: FIXED_NOW });
  await upsertGroup(
    deps.db,
    workspaceId,
    bankId,
    {
      id: "passage-1",
      title: "The monsoon",
      passage: "The monsoon arrives in June.\n\nIt leaves in September.",
    },
    FIXED_NOW,
  );

  const docs: Question[] = [
    single("LOG-001", { shuffle_options: false }),
    single("LOG-002", { media: [{ kind: "image", src: "log2-diagram.png", alt: "A diagram" }] }),
    {
      id: "LOG-003",
      type: "short_answer",
      prompt: "Summarise the argument.",
      max_length: 400,
      model_answer: "The argument is circular.",
      rubric: [{ level: "full", points: 3, description: "Names the circularity" }],
      scoring: { points: 3 },
    },
    {
      id: "LOG-004",
      type: "fill_blank",
      prompt: "The capital is ___.",
      blanks: [{ id: "b1", accepted: ["Delhi", "New Delhi"], match: "case_insensitive" }],
      scoring: { points: 1 },
    },
    {
      id: "CMP-1",
      type: "single",
      prompt: "When does the monsoon arrive?",
      group: "passage-1",
      options: [
        { id: "june", text: "June" },
        { id: "may", text: "May" },
      ],
      key: "june",
      scoring: { points: 1 },
    },
    ...Array.from({ length: 12 }, (_, i): Question => {
      const ref = `QNT-${String(i + 1).padStart(3, "0")}`;
      return single(ref, {
        tags: ["quant"],
        media: [{ kind: "image", src: `${ref.toLowerCase()}.png`, alt: ref }],
      });
    }),
    ...["A", "B", "C", "D", "E"].flatMap((set) =>
      [1, 2].map((n) => single(`SET-${set}${String(n)}`, { tags: ["sets"] })),
    ),
  ];

  const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, docs, FIXED_NOW);
  const byRef: Record<string, string> = { bank: bankId };
  docs.forEach((doc, index) => {
    byRef[doc.id] = ids[index] as string;
  });
  return byRef;
}

/** `roll` is the one unique field, so it is `external_id` and the value a
 *  listed candidate types at the gate. */
export const PAPER_FORM = {
  fields: [
    { id: "roll", type: "short_text" as const, label: "Roll number", required: true, unique: true },
    { id: "full_name", type: "short_text" as const, label: "Full name" },
  ],
};

const paperTiming = {
  duration_minutes: 45,
  opens_at: iso(FIXED_NOW - DAY),
  closes_at: iso(FIXED_NOW + DAY),
  navigation: "linear" as const,
  warn_at_minutes: [10, 2],
  late_sync_grace_seconds: 30,
};

const gated = { mode: "link_code" as const, access_code: "OPENSESAME" };

/**
 * Every test `/start` is proved against. They share one bank, so a paper
 * drawn from one is comparable with a paper drawn from another.
 */
export async function seedAttemptTests(deps: AppDeps, workspaceId: string): Promise<QuestionIds> {
  const q = await seedBank(deps, workspaceId);
  const sets = (labels: string[], assignment: SetAssignment) => ({
    kind: "sets" as const,
    assignment,
    sets: labels.map((set) => ({
      set,
      questions: [q[`SET-${set}1`] as string, q[`SET-${set}2`] as string],
    })),
  });

  // The main paper: a fixed section whose questions carry every field
  // `S-10` strips, and a pool that draws 10 of 12.
  await seedTest(deps, workspaceId, {
    name: "Paper",
    slug: "paper",
    body: {
      settings: { timing: paperTiming, access: gated, consent: CONSENT, registration_form: PAPER_FORM },
      sections: [
        {
          id: "logic",
          title: "Logic",
          instructions: "Answer every question.",
          time_limit_minutes: 15,
          source: {
            kind: "fixed",
            questions: [
              q["LOG-001"] as string,
              q["LOG-002"] as string,
              q["LOG-003"] as string,
              q["LOG-004"] as string,
              q["CMP-1"] as string,
            ],
          },
        },
        { id: "quant", title: "Quant", source: { kind: "pool", count: 10, filter: { tags: ["quant"] } } },
      ],
    },
  });

  // Five sets, round robin — and the one test that turns the calculator
  // on, so `allowCalculator` is proved in both directions.
  await seedTest(deps, workspaceId, {
    name: "Five sets",
    slug: "sets5",
    body: {
      settings: {
        timing: { ...paperTiming, navigation: "free" },
        access: gated,
        registration_form: PAPER_FORM,
        proctoring: { overrides: { allow_calculator: true } },
      },
      sections: [
        { id: "verbal", title: "Verbal", source: sets(["A", "B", "C", "D", "E"], "round_robin") },
      ],
    },
  });

  // `T-09`: the set comes off the list row, never off the order. The
  // three listed candidates are the three cases — a label, no label, and
  // a label no section carries.
  const byList = await seedTest(deps, workspaceId, {
    name: "By list",
    slug: "by-list",
    body: {
      settings: {
        timing: paperTiming,
        access: { ...gated, candidate_list: "list.csv" },
        registration_form: PAPER_FORM,
      },
      sections: [
        { id: "verbal", title: "Verbal", source: sets(["A", "B", "C"], "from_candidate_list") },
        // The passage section is here and not elsewhere on purpose: this
        // is the test whose start pays the most — the candidate row for
        // the list label, the round-robin index when that label is null,
        // the bank, *and* the passages — so it is what the declared
        // budget is measured on.
        { id: "comp", title: "Comprehension", source: { kind: "fixed", questions: [q["CMP-1"] as string] } },
      ],
    },
  });
  await replaceCandidateList(
    deps.db,
    workspaceId,
    byList,
    [
      // The first row and the first set would both be "A", so "B" here is
      // the only reading under which the row was consulted at all.
      { externalId: "21CS0147", setLabel: "B", formValues: { full_name: "Ananya" } },
      { externalId: "21CS0148", setLabel: null, formValues: { full_name: "Bharat" } },
      { externalId: "21CS0149", setLabel: "Z", formValues: { full_name: "Chetan" } },
    ],
    FIXED_NOW,
  );

  // `T-14`: two attempts, half an hour apart.
  await seedTest(deps, workspaceId, {
    name: "Twice",
    slug: "twice",
    body: {
      settings: {
        timing: { ...paperTiming, duration_minutes: 10, attempts_allowed: 2, cooldown_minutes: 30 },
        access: gated,
        registration_form: PAPER_FORM,
      },
      sections: [
        { id: "logic", title: "Logic", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
      ],
    },
  });

  // `T-12` and `AC-13`: a window that shuts in ten minutes and a paper
  // that runs for forty-five. The deadline is **not** clipped to it.
  await seedTest(deps, workspaceId, {
    name: "Late",
    slug: "late",
    body: {
      settings: {
        timing: {
          duration_minutes: 45,
          opens_at: iso(FIXED_NOW - DAY),
          closes_at: iso(FIXED_NOW + 10 * 60_000),
          latest_start_at: iso(FIXED_NOW + 5 * 60_000),
        },
        access: gated,
        registration_form: PAPER_FORM,
      },
      sections: [
        { id: "logic", title: "Logic", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
      ],
    },
  });

  // Tasks 9 and 10. Three siblings of `alpha/paper`, each differing in
  // exactly one timing field, so a navigation or clock assertion can only
  // be passing because of the field it names.
  //
  // Two *fixed* sections, unshuffled, so a test can name "the last
  // question of section one" and "the first of section two" by position
  // rather than by searching the returned paper — and so the flat index
  // the server locks on is the index the fixture wrote.
  const twoSections = (limits: (number | null)[]) =>
    [
      ["logic", "Logic", ["LOG-001", "LOG-002", "LOG-003"]],
      ["quant", "Quant", ["QNT-001", "QNT-002", "QNT-003"]],
    ].map(([id, title, refs], at) => ({
      id: id as string,
      title: title as string,
      shuffle_questions: false,
      ...(limits[at] === null || limits[at] === undefined
        ? {}
        : { time_limit_minutes: limits[at] as number }),
      source: {
        kind: "fixed" as const,
        questions: (refs as string[]).map((ref) => q[ref] as string),
      },
    }));

  // `T-13`'s middle mode: free inside the section you are in, locked once
  // you have left it. Both sections are timed, so "the second section's
  // clock runs from its own stamp" is a real assertion rather than a null.
  await seedTest(deps, workspaceId, {
    name: "Per section",
    slug: "per-section",
    body: {
      settings: {
        timing: { ...paperTiming, navigation: "per_section" },
        access: gated,
        registration_form: PAPER_FORM,
      },
      sections: twoSections([15, 10]),
    },
  });

  // The control: the same paper with nothing locked at all. Untimed
  // sections, so a navigation assertion can only fail for a navigation
  // reason.
  await seedTest(deps, workspaceId, {
    name: "Free nav",
    slug: "free-nav",
    body: {
      settings: {
        timing: { ...paperTiming, navigation: "free" },
        access: gated,
        registration_form: PAPER_FORM,
      },
      sections: twoSections([null, null]),
    },
  });

  // The combination nothing judged: `free` navigation **and** per-section
  // time limits. `assertReachable` returns immediately for `free`, so the
  // section clock is the only thing standing between a candidate sitting
  // in section two and a write back into section one — whose limit ran out
  // while they were in it, and whose anchor the one `section_started_at`
  // column no longer holds.
  await seedTest(deps, workspaceId, {
    name: "Free and timed",
    slug: "free-timed",
    body: {
      settings: {
        timing: { ...paperTiming, navigation: "free" },
        access: gated,
        registration_form: PAPER_FORM,
      },
      sections: twoSections([15, 10]),
    },
  });

  // `AC-13`: the grace comes from the **version**, not from a constant.
  // Twice the default, so a save 45 s late is refused on `alpha/paper`
  // and accepted here — which no hard-coded 30 can produce. No section
  // limit, so the only clock in play is the paper's own.
  await seedTest(deps, workspaceId, {
    name: "Sixty second grace",
    slug: "grace60",
    body: {
      settings: {
        timing: { ...paperTiming, late_sync_grace_seconds: 60 },
        access: gated,
        registration_form: PAPER_FORM,
      },
      sections: twoSections([null, null]),
    },
  });

  // A `timing` block carrying **only** `duration_minutes` — the one field
  // `schemas/test-1.json` requires inside it — so what the paper carries
  // for the other four is the server's own defaults (reconciliation row 8:
  // they live only in the builder UI, and `Test.timing` is optional by
  // design). The duration is here because a version without one is not
  // startable at all: `?? 0` would mint an attempt whose deadline is its
  // own start, and that refusal has a test of its own in `clock.test.ts`.
  await seedTest(deps, workspaceId, {
    name: "Bare",
    slug: "bare",
    body: {
      settings: {
        timing: { duration_minutes: 45 },
        access: gated,
        registration_form: PAPER_FORM,
      },
      sections: [
        { id: "logic", title: "Logic", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
      ],
    },
  });

  // And the shape `durationMinutesOf` refuses: no `timing` block at all.
  // `buildChecklist` already refuses to publish this, so it can only be
  // reached by a direct write — which is exactly what `seedTest` is.
  await seedTest(deps, workspaceId, {
    name: "Undated",
    slug: "no-duration",
    body: {
      settings: { access: gated, registration_form: PAPER_FORM },
      sections: [
        { id: "logic", title: "Logic", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
      ],
    },
  });

  return q;
}

/** One question of every type, with every answer-bearing field set, so
 *  the scrubber's allowlist is proved through the route for all twelve
 *  rather than for the three a realistic paper happens to use. */
export const ALL_TYPES: Question[] = [
  {
    id: "T-single",
    type: "single",
    prompt: "Single",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    key: "a",
    scoring: { points: 1 },
    explanation: "SECRET",
  },
  {
    id: "T-multiple",
    type: "multiple",
    prompt: "Multiple",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    key: ["a", "b"],
    scoring: { points: 2 },
  },
  {
    id: "T-selectk",
    type: "select_k",
    prompt: "Select two",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ],
    k: 2,
    key: ["a", "b"],
    scoring: { points: 2 },
  },
  { id: "T-truefalse", type: "true_false", prompt: "True or false", key: true, scoring: { points: 1 } },
  {
    id: "T-assertion",
    type: "assertion_reason",
    prompt: "Assertion and reason",
    assertion: "The sky is blue.",
    reason: "Rayleigh scattering.",
    key: "both_true_explains",
    scoring: { points: 2 },
  },
  {
    id: "T-matching",
    type: "matching",
    prompt: "Match them",
    left: ["L1", "L2"],
    right: ["R1", "R2"],
    key: { L1: "R1", L2: "R2" },
    scoring: { points: 2 },
  },
  {
    id: "T-multimatching",
    type: "multi_matching",
    prompt: "Match several",
    left: ["L1"],
    right: ["R1", "R2"],
    key: { L1: ["R1", "R2"] },
    scoring: { points: 2 },
  },
  { id: "T-ordering", type: "ordering", prompt: "Put these in order", items: ["one", "two"], scoring: { points: 2 } },
  {
    id: "T-fillblank",
    type: "fill_blank",
    prompt: "Fill ___ in",
    blanks: [{ id: "b1", accepted: ["SECRET"] }],
    scoring: { points: 1 },
  },
  {
    id: "T-numeric",
    type: "numeric",
    prompt: "How many?",
    unit: "kg",
    key: { value: 42, tolerance: 0.5 },
    scoring: { points: 1 },
  },
  {
    id: "T-short",
    type: "short_answer",
    prompt: "In a sentence",
    max_length: 200,
    model_answer: "SECRET",
    scoring: { points: 3 },
  },
  {
    id: "T-long",
    type: "long_answer",
    prompt: "In an essay",
    max_length: 2000,
    rubric: [{ level: "full", points: 5, description: "SECRET" }],
    scoring: { points: 5 },
  },
];

/** `alpha/alltypes`: the twelve, in a fixed section whose order is not
 *  shuffled, so a test can index them. */
export async function seedAllTypes(deps: AppDeps, workspaceId: string): Promise<QuestionIds> {
  const bankId = await createBank(deps.db, workspaceId, { name: "All types", now: FIXED_NOW });
  const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, ALL_TYPES, FIXED_NOW);
  const byRef: Record<string, string> = {};
  ALL_TYPES.forEach((doc, index) => {
    byRef[doc.id] = ids[index] as string;
  });
  await seedTest(deps, workspaceId, {
    name: "All types",
    slug: "alltypes",
    body: {
      settings: { timing: paperTiming, access: gated, registration_form: PAPER_FORM },
      sections: [
        { id: "every", title: "Every type", shuffle_questions: false, source: { kind: "fixed", questions: ids } },
      ],
    },
  });
  return byRef;
}
