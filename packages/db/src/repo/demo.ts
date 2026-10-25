// Ephemeral demo workspace provisioning and showcase seeding.
//
// Provisions a demo workspace with a sample question bank, published test with
// 3 sections, and 5 attempts with realistic scores and flags (clean, review,
// scoring_blocked) — all written via a single D1 `db.batch()` to strictly
// respect the <= 12 subrequest route budget ceiling.

import type { DbClient } from "../client.js";
import { newId, newShortCode } from "../ids.js";
import { scoped } from "./guard.js";

export interface SeedDemoWorkspaceOptions {
  userId?: string;
  slug?: string;
  name?: string;
  now?: number;
}

export interface SeedDemoWorkspaceResult {
  workspace: {
    id: string;
    slug: string;
    name: string;
    isDemo: true;
  };
  userId: string;
  bankId: string;
  testId: string;
  testVersionId: string;
  attemptIds: string[];
}

export const seedDemoWorkspace = scoped(
  "seedDemoWorkspace",
  async (
    db: DbClient,
    workspaceId: string,
    options: SeedDemoWorkspaceOptions = {},
  ): Promise<SeedDemoWorkspaceResult> => {
    const now = options.now ?? Date.now();
    const expiresAt = now + 3600_000;
    const slugSuffix = newShortCode().toLowerCase();
    const slug = options.slug ?? `demo-${slugSuffix}`;
    const name = options.name ?? "Demo Workspace";
    const userId = options.userId ?? newId("usr");
    const memberId = newId("mbr");
    const bankId = newId("bnk");
    const testId = newId("tst");
    const testVersionId = newId("ver");
    const setId = newId("set");

    // 6 questions: 2 per section across 3 sections
    const q1Id = newId("qst");
    const q2Id = newId("qst");
    const q3Id = newId("qst");
    const q4Id = newId("qst");
    const q5Id = newId("qst");
    const q6Id = newId("qst");

    const questions = [
      {
        id: q1Id,
        refId: "QUANT-01",
        prompt: "A train running at 72 km/h crosses a 260 m long platform in 23 seconds. What is the length of the train?",
        options: [
          { id: "a", text: "200 m" },
          { id: "b", text: "220 m" },
          { id: "c", text: "240 m" },
          { id: "d", text: "180 m" },
        ],
        key: { correct: "a" },
        points: 2,
        explanation: "Speed = 72 * 5/18 = 20 m/s. Total distance = 20 * 23 = 460 m. Train length = 460 - 260 = 200 m.",
      },
      {
        id: q2Id,
        refId: "QUANT-02",
        prompt: "If 12 men or 18 women can do a work in 14 days, in how many days can 8 men and 16 women do the same work?",
        options: [
          { id: "a", text: "7 days" },
          { id: "b", text: "9 days" },
          { id: "c", text: "10 days" },
          { id: "d", text: "12 days" },
        ],
        key: { correct: "b" },
        points: 2,
        explanation: "12M = 18W => 1M = 1.5W. 8M + 16W = (8 * 1.5) + 16 = 28W. Days = (18 * 14) / 28 = 9 days.",
      },
      {
        id: q3Id,
        refId: "LOGIC-01",
        prompt: "Look at this series: 2, 1, (1/2), (1/4), ... What number should come next?",
        options: [
          { id: "a", text: "(1/3)" },
          { id: "b", text: "(1/8)" },
          { id: "c", text: "(2/8)" },
          { id: "d", text: "(1/16)" },
        ],
        key: { correct: "b" },
        points: 2,
        explanation: "Each number is half the previous number. (1/4) * (1/2) = (1/8).",
      },
      {
        id: q4Id,
        refId: "LOGIC-02",
        prompt: "Statements: All bags are cakes. All lamps are cakes. Conclusions: I. Some cakes are bags. II. No lamp is a bag.",
        options: [
          { id: "a", text: "Only conclusion I follows" },
          { id: "b", text: "Only conclusion II follows" },
          { id: "c", text: "Either I or II follows" },
          { id: "d", text: "Neither I nor II follows" },
        ],
        key: { correct: "a" },
        points: 2,
        explanation: "Since all bags are cakes, some cakes must be bags. Whether lamps and bags overlap is indeterminate.",
      },
      {
        id: q5Id,
        refId: "TECH-01",
        prompt: "Which data structure provides amortized O(1) time complexity for insert, delete, and lookup operations?",
        options: [
          { id: "a", text: "Hash Table" },
          { id: "b", text: "Red-Black Tree" },
          { id: "c", text: "Binary Heap" },
          { id: "d", text: "B-Tree" },
        ],
        key: { correct: "a" },
        points: 2,
        explanation: "Hash tables offer amortized O(1) performance with reasonable collision handling.",
      },
      {
        id: q6Id,
        refId: "TECH-02",
        prompt: "In relational database ACID guarantees, what does the 'I' (Isolation) property ensure?",
        options: [
          { id: "a", text: "Transactions are executed in isolated physical hardware" },
          { id: "b", text: "Concurrent transactions execute without uncommitted interference" },
          { id: "c", text: "System crashes do not lose already committed data" },
          { id: "d", text: "Constraints and foreign keys are never violated" },
        ],
        key: { correct: "b" },
        points: 2,
        explanation: "Isolation guarantees concurrent transaction execution results match a serial execution schedule.",
      },
    ];

    const sections = [
      {
        id: "sec-quant",
        title: "Quantitative Reasoning",
        instructions: "Solve the numerical and algebraic problems.",
        source: { kind: "fixed", questions: [q1Id, q2Id] },
      },
      {
        id: "sec-logic",
        title: "Logic & Problem Solving",
        instructions: "Identify logical deductions and structural series.",
        source: { kind: "fixed", questions: [q3Id, q4Id] },
      },
      {
        id: "sec-tech",
        title: "Technical Knowledge",
        instructions: "Core computer science fundamentals.",
        source: { kind: "fixed", questions: [q5Id, q6Id] },
      },
    ];

    const layout = {
      sections: [
        { sectionId: "sec-quant", questionIds: [q1Id, q2Id] },
        { sectionId: "sec-logic", questionIds: [q3Id, q4Id] },
        { sectionId: "sec-tech", questionIds: [q5Id, q6Id] },
      ],
    };

    // 5 Candidates & Attempts with realistic scores and flags:
    // 1. Clean - High scorer (100%)
    // 2. Clean - Passed (83%)
    // 3. Review - Marginal (50%)
    // 4. Review - Proctoring flagged (67%)
    // 5. Scoring blocked - Disallowed attempt / system hold
    const candidatesData = [
      {
        name: "Alice Smith",
        email: "alice.smith@example.test",
        flag: "clean",
        integrityFlag: "clean",
        scoreJson: { total: 12, max: 12, percent: 100, passed: true },
        answers: { [q1Id]: "a", [q2Id]: "b", [q3Id]: "b", [q4Id]: "a", [q5Id]: "a", [q6Id]: "b" },
      },
      {
        name: "Bob Jones",
        email: "bob.jones@example.test",
        flag: "clean",
        integrityFlag: "clean",
        scoreJson: { total: 10, max: 12, percent: 83.33, passed: true },
        answers: { [q1Id]: "a", [q2Id]: "b", [q3Id]: "b", [q4Id]: "a", [q5Id]: "a", [q6Id]: "c" },
      },
      {
        name: "Charlie Brown",
        email: "charlie.brown@example.test",
        flag: "review",
        integrityFlag: "review",
        scoreJson: { total: 6, max: 12, percent: 50, passed: false },
        answers: { [q1Id]: "a", [q2Id]: "c", [q3Id]: "b", [q4Id]: "c", [q5Id]: "a", [q6Id]: "c" },
      },
      {
        name: "Diana Prince",
        email: "diana.prince@example.test",
        flag: "clean",
        integrityFlag: "review",
        scoreJson: { total: 8, max: 12, percent: 66.67, passed: true },
        answers: { [q1Id]: "a", [q2Id]: "b", [q3Id]: "b", [q4Id]: "d", [q5Id]: "a", [q6Id]: "c" },
      },
      {
        name: "Evan Wright",
        email: "evan.wright@example.test",
        flag: "scoring_blocked",
        integrityFlag: "clean",
        scoreJson: null,
        answers: { [q1Id]: "a", [q2Id]: "b" },
      },
    ];

    const candidateIds = candidatesData.map(() => newId("cnd"));
    const attemptIds = candidatesData.map(() => newId("att"));

    // Build batch statements array: single round trip on D1
    const statements: { sql: string; params: unknown[] }[] = [];

    // 1. Workspace
    statements.push({
      sql:
        "INSERT INTO workspace (id, slug, name, branding_json, settings_json, created_at) " +
        "VALUES (?, ?, ?, NULL, ?, ?)",
      params: [
        workspaceId,
        slug,
        name,
        db.jsonParam({ is_demo: true, expires_at: expiresAt }),
        now,
      ],
    });

    // 2. Evaluator user
    statements.push({
      sql: 'INSERT INTO "user" (id, email, auth_provider, created_at) VALUES (?, ?, ?, ?)',
      params: [userId, `evaluator-${workspaceId.replace("wsp_", "")}@demo.pariksha.test`, "demo", now],
    });

    // 3. Workspace Owner Membership
    statements.push({
      sql:
        "INSERT INTO membership (id, workspace_id, user_id, role, test_grants_json, created_at) " +
        "VALUES (?, ?, ?, 'owner', NULL, ?)",
      params: [memberId, workspaceId, userId, now],
    });

    // 4. Sample Question Bank
    statements.push({
      sql:
        "INSERT INTO question_bank (id, workspace_id, name, description, license, groups_json, tags_json, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
      params: [
        bankId,
        workspaceId,
        "General & Technical Aptitude Bank",
        "Pre-seeded question bank featuring quantitative, logic, and technical items.",
        db.jsonParam(["demo", "sample"]),
        now,
        now,
      ],
    });

    // 5. Questions
    for (const q of questions) {
      statements.push({
        sql:
          "INSERT INTO question (id, workspace_id, bank_id, ref_id, group_ref, type, prompt_md, media_json, " +
          "options_json, key_json, scoring_json, points, difficulty, tags_json, explanation_md, extra_json, version, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, NULL, 'multiple_choice', ?, NULL, ?, ?, ?, ?, 'medium', ?, ?, NULL, 1, ?, ?)",
        params: [
          q.id,
          workspaceId,
          bankId,
          q.refId,
          q.prompt,
          db.jsonParam(q.options),
          db.jsonParam(q.key),
          db.jsonParam({ points: q.points }),
          q.points,
          db.jsonParam(["demo"]),
          q.explanation,
          now,
          now,
        ],
      });
    }

    // 6. Test
    statements.push({
      sql:
        "INSERT INTO test (id, workspace_id, slug, name, description, short_code, status, review_requested, " +
        "current_version, tags_json, created_at, updated_at) " +
        "VALUES (?, ?, 'general-skills-assessment', 'General Skills & Aptitude Assessment', " +
        "'Showcase evaluation assessment with 3 sections: Quantitative, Logic, and Technical fundamentals.', " +
        "?, 'published', 0, 1, ?, ?, NULL)",
      params: [testId, workspaceId, newShortCode().toLowerCase(), db.jsonParam(["demo", "showcase"]), now],
    });

    // 7. Test Version (published, 3 sections)
    statements.push({
      sql:
        "INSERT INTO test_version (id, workspace_id, test_id, version, settings_json, sections_json, published_at, created_at) " +
        "VALUES (?, ?, ?, 1, ?, ?, ?, ?)",
      params: [
        testVersionId,
        workspaceId,
        testId,
        db.jsonParam({ timing: { duration_minutes: 45 }, scoring: { pass_mark_percent: 60 } }),
        db.jsonParam(sections),
        now,
        now,
      ],
    });

    // 8. Set
    statements.push({
      sql:
        'INSERT INTO "set" (id, workspace_id, test_version_id, set_no, question_ids_json) ' +
        "VALUES (?, ?, ?, 1, ?)",
      params: [setId, workspaceId, testVersionId, db.jsonParam([q1Id, q2Id, q3Id, q4Id, q5Id, q6Id])],
    });

    // 9. Candidates & Attempts & Responses
    for (let i = 0; i < candidatesData.map(c => c).length; i++) {
      const c = candidatesData[i]!;
      const cId = candidateIds[i]!;
      const aId = attemptIds[i]!;
      const startedAt = now - (3600_000 - i * 60_000);
      const submittedAt = startedAt + 1800_000;

      // Candidate row
      statements.push({
        sql:
          "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
          "VALUES (?, ?, ?, ?, NULL, 'registration', ?, '1', ?, ?)",
        params: [
          cId,
          workspaceId,
          testId,
          `demo-${i + 1}`,
          db.jsonParam({ name: c.name, email: c.email }),
          startedAt,
          startedAt,
        ],
      });

      // Attempt row
      statements.push({
        sql:
          "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
          "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
          "integrity_flag, observed) " +
          "VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'finished', ?, ?, ?, 5, NULL, ?, 1)",
        params: [
          aId,
          workspaceId,
          cId,
          testVersionId,
          db.jsonParam(layout),
          startedAt,
          startedAt + 2700_000,
          submittedAt,
          c.scoreJson === null ? null : db.jsonParam(c.scoreJson),
          c.flag,
          `hash-demo-att-${aId}`,
          c.integrityFlag,
        ],
      });

      // Sample responses
      let seq = 0;
      for (const [qid, option] of Object.entries(c.answers)) {
        seq++;
        const targetQ = questions.find((q) => q.id === qid);
        const isCorrect = targetQ?.key.correct === option;
        const pts = isCorrect ? (targetQ?.points ?? 2) : 0;

        statements.push({
          sql:
            "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto')",
          params: [
            newId("rsp"),
            workspaceId,
            aId,
            qid,
            db.jsonParam({ kind: "option", option }),
            startedAt + seq * 30_000,
            seq,
            pts,
          ],
        });
      }
    }

    // Execute everything in a single D1 batch
    await db.batch(statements);

    return {
      workspace: {
        id: workspaceId,
        slug,
        name,
        isDemo: true,
      },
      userId,
      bankId,
      testId,
      testVersionId,
      attemptIds,
    };
  },
);
