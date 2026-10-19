import { describe, it, expect } from "vitest";
import {
  selectForSection,
  assignSet,
  layoutForAttempt,
  PoolTooSmallError,
} from "../src/select.js";
import type { Question, Section } from "../src/types.js";

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}

function single(id: string, extra: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    prompt: `Prompt ${id}`,
    options: [
      { id: `${id}-a`, text: "A" },
      { id: `${id}-b`, text: "B" },
      { id: `${id}-c`, text: "C" },
      { id: `${id}-d`, text: "D", pinned: true },
    ],
    key: `${id}-a`,
    ...extra,
  } as Question;
}

function trueFalse(id: string, extra: Partial<Question> = {}): Question {
  return { id, type: "true_false", prompt: `Prompt ${id}`, key: true, ...extra } as Question;
}

describe("assignSet", () => {
  it("AC-09: five sets, round robin, 50 registrations split 10 each with no two neighbours alike", () => {
    const got = Array.from({ length: 50 }, (_, i) =>
      assignSet({
        sets: ["A", "B", "C", "D", "E"],
        assignment: "round_robin",
        registrationIndex: i,
        candidateId: `c${i}`,
      }),
    );
    expect(countBy(got)).toEqual({ A: 10, B: 10, C: 10, D: 10, E: 10 });
    for (let i = 1; i < got.length; i++) expect(got[i]).not.toBe(got[i - 1]);
  });

  it("hash assignment is stable for one candidate and spreads across sets", () => {
    const sets = ["A", "B", "C", "D", "E"];
    const forCandidate = (candidateId: string): string =>
      assignSet({ sets, assignment: "hash", registrationIndex: 0, candidateId });

    // stable: calling it again for the same candidate (and a different
    // registrationIndex, since hash must not depend on it) gives the same set.
    const first = forCandidate("alice@example.com");
    expect(assignSet({ sets, assignment: "hash", registrationIndex: 99, candidateId: "alice@example.com" })).toBe(
      first,
    );
    expect(forCandidate("alice@example.com")).toBe(first);

    // spreads: across many candidates, every set gets used.
    const seen = new Set(Array.from({ length: 200 }, (_, i) => forCandidate(`candidate-${i}`)));
    expect(seen.size).toBe(sets.length);
  });

  it("random assignment returns a set from the list and spreads across many draws", () => {
    const sets = ["A", "B", "C"];
    const seen = new Set(
      Array.from({ length: 100 }, (_, i) =>
        assignSet({ sets, assignment: "random", registrationIndex: i, candidateId: `c${i}` }),
      ),
    );
    for (const s of seen) expect(sets).toContain(s);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("from_candidate_list returns the CSV-provided set, and throws without one", () => {
    const sets = ["A", "B", "C"];
    expect(
      assignSet({ sets, assignment: "from_candidate_list", registrationIndex: 0, candidateId: "c0", listValue: "B" }),
    ).toBe("B");
    expect(() =>
      assignSet({ sets, assignment: "from_candidate_list", registrationIndex: 0, candidateId: "c0" }),
    ).toThrow();
  });

  it("throws when given no sets to assign", () => {
    expect(() => assignSet({ sets: [], assignment: "round_robin", registrationIndex: 0, candidateId: "c0" })).toThrow();
  });
});

describe("selectForSection: fixed", () => {
  const bank = [single("Q1"), single("Q2"), single("Q3")];

  it("returns exactly the listed questions in the listed order when shuffle_questions is false", () => {
    const section: Section = {
      id: "sec1",
      title: "Section 1",
      shuffle_questions: false,
      source: { kind: "fixed", questions: ["Q3", "Q1", "Q2"] },
    };
    const result = selectForSection({ section, bank, seed: "seed-1" });
    expect(result.map((q) => q.id)).toEqual(["Q3", "Q1", "Q2"]);
  });
});

describe("selectForSection: pool", () => {
  function makeBank(): Question[] {
    const matching: Question[] = Array.from({ length: 12 }, (_, i) =>
      single(`SQL-${i}`, { tags: ["sql"], difficulty: "medium" }),
    );
    const wrongTag: Question[] = Array.from({ length: 5 }, (_, i) =>
      single(`OTHER-${i}`, { tags: ["networking"], difficulty: "medium" }),
    );
    const wrongDifficulty: Question[] = Array.from({ length: 5 }, (_, i) =>
      single(`HARD-${i}`, { tags: ["sql"], difficulty: "hard" }),
    );
    const wrongType: Question[] = Array.from({ length: 5 }, (_, i) =>
      trueFalse(`TF-${i}`, { tags: ["sql"], difficulty: "medium" }),
    );
    return [...matching, ...wrongTag, ...wrongDifficulty, ...wrongType];
  }

  it("AC-10: '10 from pool, tag sql, difficulty medium' gives 10 distinct matching questions", () => {
    const bank = makeBank();
    const section: Section = {
      id: "sec1",
      title: "SQL pool",
      source: { kind: "pool", count: 10, filter: { tags: ["sql"], difficulty: ["medium"] } },
    };
    const result = selectForSection({ section, bank, seed: "candidate-1" });
    expect(result).toHaveLength(10);
    expect(new Set(result.map((q) => q.id)).size).toBe(10); // distinct, not just count
    for (const q of result) {
      expect(q.tags).toContain("sql");
      expect(q.difficulty).toBe("medium");
    }
  });

  it("also filters by type", () => {
    const bank = makeBank();
    const section: Section = {
      id: "sec1",
      title: "SQL pool",
      source: { kind: "pool", count: 5, filter: { tags: ["sql"], difficulty: ["medium"], types: ["single"] } },
    };
    const result = selectForSection({ section, bank, seed: "candidate-2" });
    expect(result).toHaveLength(5);
    for (const q of result) expect(q.type).toBe("single");
  });

  it("a pool that asks for more than the filter yields throws PoolTooSmallError naming the section, wanted and available", () => {
    const bank = Array.from({ length: 7 }, (_, i) => single(`SQL-${i}`, { tags: ["sql"], difficulty: "medium" }));
    const section: Section = {
      id: "sql-section",
      title: "SQL pool",
      source: { kind: "pool", count: 20, filter: { tags: ["sql"], difficulty: ["medium"] } },
    };
    expect(() => selectForSection({ section, bank, seed: "candidate-1" })).toThrow(PoolTooSmallError);
    try {
      selectForSection({ section, bank, seed: "candidate-1" });
      expect.fail("expected PoolTooSmallError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PoolTooSmallError);
      const e = err as PoolTooSmallError;
      expect(e.sectionId).toBe("sql-section");
      expect(e.wanted).toBe(20);
      expect(e.available).toBe(7);
    }
  });
});

describe("selectForSection: sets", () => {
  const bank = [single("LOG-001"), single("LOG-002"), single("LOG-003"), single("LOG-004")];
  const section: Section = {
    id: "reasoning",
    title: "Reasoning",
    source: {
      kind: "sets",
      assignment: "round_robin",
      sets: [
        { set: "A", questions: ["LOG-001", "LOG-003"] },
        { set: "B", questions: ["LOG-002", "LOG-004"] },
      ],
    },
  };

  it("returns the questions belonging to the given set", () => {
    const resultA = selectForSection({ section, bank, seed: "x", setNo: "A" });
    expect(new Set(resultA.map((q) => q.id))).toEqual(new Set(["LOG-001", "LOG-003"]));
    const resultB = selectForSection({ section, bank, seed: "x", setNo: "B" });
    expect(new Set(resultB.map((q) => q.id))).toEqual(new Set(["LOG-002", "LOG-004"]));
  });

  it("throws when asked for a set that does not exist", () => {
    expect(() => selectForSection({ section, bank, seed: "x", setNo: "Z" })).toThrow();
  });

  // The same refusal reached with no set at all, which is the shape a
  // caller that forgot to assign one produces. The message has to name
  // that case rather than interpolating `undefined` into it: it is what
  // an organiser sees when a section is drawn without an assignment.
  it("names the missing set when none was given at all", () => {
    expect(() => selectForSection({ section, bank, seed: "x" })).toThrow(/has no set "\(none given\)"/);
  });

  it("throws when a set names a question the bank does not hold", () => {
    const missing: Section = {
      id: "reasoning",
      title: "Reasoning",
      source: {
        kind: "sets",
        assignment: "round_robin",
        sets: [{ set: "A", questions: ["LOG-001", "LOG-999"] }],
      },
    };
    expect(() => selectForSection({ section: missing, bank, seed: "x", setNo: "A" })).toThrow(
      /question "LOG-999" not found in bank/,
    );
  });
});

describe("layoutForAttempt (AC-11)", () => {
  const bank = [single("Q1"), single("Q2"), single("Q3"), single("Q4"), single("Q5")];
  const sections: Section[] = [
    {
      id: "sec1",
      title: "Section 1",
      source: { kind: "fixed", questions: ["Q1", "Q2", "Q3", "Q4", "Q5"] },
    },
  ];

  it("two seeds give different question and option orders, and one seed reproduces its own", () => {
    const layoutA1 = layoutForAttempt({ sections, bank, seed: "candidate-a" });
    const layoutA2 = layoutForAttempt({ sections, bank, seed: "candidate-a" });
    const layoutB = layoutForAttempt({ sections, bank, seed: "candidate-b" });

    // same seed reproduces its own order exactly
    expect(layoutA1).toEqual(layoutA2);

    // different seeds give different question order AND different option
    // order — checked independently, not ORed together, so this test
    // can't pass if one of the two shufflings were a complete no-op.
    expect(layoutA1.sections[0]?.questionIds).not.toEqual(layoutB.sections[0]?.questionIds);
    expect(layoutA1.sections[0]?.optionOrder).not.toEqual(layoutB.sections[0]?.optionOrder);

    // pinned option (the 4th, "-d") always stays last regardless of seed
    for (const layout of [layoutA1, layoutB]) {
      const section = layout.sections[0];
      expect(section).toBeDefined();
      for (const q of bank) {
        const order = section?.optionOrder[q.id];
        expect(order?.at(-1)).toBe(`${q.id}-d`);
      }
    }
  });

  it("carries setNo through when provided", () => {
    const setsSections: Section[] = [
      {
        id: "sec1",
        title: "Section 1",
        source: {
          kind: "sets",
          sets: [
            { set: "A", questions: ["Q1", "Q2"] },
            { set: "B", questions: ["Q3", "Q4"] },
          ],
        },
      },
    ];
    const layout = layoutForAttempt({ sections: setsSections, bank, seed: "candidate-a", setNo: "A" });
    expect(layout.setNo).toBe("A");
    expect(new Set(layout.sections[0]?.questionIds)).toEqual(new Set(["Q1", "Q2"]));
  });

  it("omits setNo entirely when not provided", () => {
    const layout = layoutForAttempt({ sections, bank, seed: "candidate-a" });
    expect("setNo" in layout).toBe(false);
  });

  // A layout mixes question types: only the option-bearing ones get an
  // `optionOrder` entry, and a `shuffle_options: false` question keeps the
  // authored order inside a layout whose other questions are shuffled.
  // Both halves in one section, because the bug either would hide is "the
  // other kind of question was quietly dropped from the layout".
  it("carries a question with no options, and leaves a pinned-order question alone", () => {
    const mixed = [
      single("Q1"),
      trueFalse("TF1"),
      single("Q2", { shuffle_options: false }),
    ];
    const section: Section[] = [
      { id: "sec1", title: "Section 1", source: { kind: "fixed", questions: ["Q1", "TF1", "Q2"] } },
    ];
    const layout = layoutForAttempt({ sections: section, bank: mixed, seed: "candidate-a" });

    expect(new Set(layout.sections[0]?.questionIds)).toEqual(new Set(["Q1", "TF1", "Q2"]));
    // A true/false question has no options to order, so it gets no entry
    // rather than an empty one.
    expect(Object.keys(layout.sections[0]?.optionOrder ?? {}).sort()).toEqual(["Q1", "Q2"]);
    expect(layout.sections[0]?.optionOrder.Q2).toEqual(["Q2-a", "Q2-b", "Q2-c", "Q2-d"]);
  });
});

describe("assignSet: the index is trusted but checked", () => {
  // `round_robin` is `registrationIndex % sets.length`, and a negative
  // index makes that negative — `sets[-1]` is `undefined`, which without
  // this guard would be returned as the set label and become a key of
  // `draw`/`setPoints` that matches nothing. A caller's defect, refused
  // where it is cheap to see rather than at the point it is used.
  it("refuses a negative registration index rather than returning no set", () => {
    expect(() =>
      assignSet({ sets: ["A", "B", "C"], assignment: "round_robin", registrationIndex: -1, candidateId: "cnd_1" }),
    ).toThrow(RangeError);
  });
});
