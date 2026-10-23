// Test analytics (Phase 8c Task 1, `R-06`, `K19`). Fixture helpers mirror
// `results.test.ts`'s own (`seedAttempt`, `candidateIn`, `publish`) —
// this file is `listAttemptsForTest`'s next reader, not a different shape
// of test.

import { afterAll, expect, it } from "vitest";
import {
  closeClient,
  createTest,
  createWorkspace,
  getDraftVersion,
  migrate,
  newId,
  publishDraftVersion,
  putDraftVersion,
  sqliteClient,
  testAnalytics,
  testItemAnalysis,
  type DbClient,
  type TestDocumentBody,
} from "../../src/index.js";

const NOW = 1_770_000_000_000;
const MINUTE = 60_000;

const db: DbClient = sqliteClient(":memory:");
await migrate(db);
afterAll(() => closeClient(db));

/** One call per raw operation — the same shape `results.test.ts` keeps. */
function countingClient(inner: DbClient): { db: DbClient; count: () => number } {
  let calls = 0;
  const bump = <T>(run: () => T): T => {
    calls += 1;
    return run();
  };
  return {
    db: {
      ...inner,
      exec: (sql) => bump(() => inner.exec(sql)),
      all: <T>(sql: string) => bump(() => inner.all<T>(sql)),
      query: <T>(sql: string, params?: unknown[]) => bump(() => inner.query<T>(sql, params)),
      run: (sql, params) => bump(() => inner.run(sql, params)),
      batch: (statements) => bump(() => inner.batch(statements)),
    },
    count: () => calls,
  };
}

const body: TestDocumentBody = {
  settings: { timing: { duration_minutes: 45, navigation: "linear", late_sync_grace_seconds: 30 } },
  sections: [{ id: "s1", title: "Logic", source: { kind: "fixed", questions: ["qst_1"] } }],
};

async function publish(slug: string): Promise<{ workspaceId: string; testId: string; versionId: string }> {
  const workspaceId = newId("wsp");
  await createWorkspace(db, workspaceId, { slug, name: slug, now: NOW });
  const test = await createTest(db, workspaceId, { name: slug, slug, now: NOW });
  const draft = await getDraftVersion(db, workspaceId, test.id);
  if (!draft) throw new Error("createTest did not seed a draft");
  await putDraftVersion(db, workspaceId, draft, body, NOW);
  await publishDraftVersion(db, workspaceId, test.id, NOW);
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
    [test.id],
  );
  return { workspaceId, testId: test.id, versionId: rows[0]!.id };
}

async function candidateIn(ws: { workspaceId: string; testId: string }, registered = true): Promise<string> {
  const id = newId("cnd");
  await db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
      "VALUES (?, ?, ?, NULL, NULL, 'registration', '{}', NULL, ?, ?)",
    [id, ws.workspaceId, ws.testId, registered ? NOW : null, NOW],
  );
  return id;
}

interface AttemptSeed {
  workspaceId: string;
  candidateId: string;
  testVersionId: string;
  setNo?: number;
  startedAt?: number;
  submittedAt?: number | null;
  submitReason?: string | null;
  lockedAt?: number | null;
  integrityFlag?: string;
  percent?: number;
  passed?: boolean | null;
  perQuestion?: Record<string, { points: number; max: number; correct: boolean | null }>;
}

async function seedAttempt(seed: AttemptSeed): Promise<string> {
  const id = newId("att");
  const scoreJson =
    seed.percent === undefined
      ? null
      : JSON.stringify({
          percent: seed.percent,
          total: seed.percent,
          max: 100,
          passed: seed.passed ?? null,
          pending: [],
          perQuestion: seed.perQuestion ?? {},
          sections: [],
        });
  await db.run(
    "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
      "integrity_flag, observed, locked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      seed.workspaceId,
      seed.candidateId,
      seed.testVersionId,
      seed.setNo ?? 1,
      "{}",
      seed.startedAt ?? NOW,
      (seed.startedAt ?? NOW) + 45 * MINUTE,
      seed.submittedAt ?? null,
      seed.submittedAt == null ? null : (seed.submitReason ?? "manual"),
      scoreJson,
      "clean",
      `hash-${id}`,
      0,
      null,
      seed.integrityFlag ?? "clean",
      1,
      seed.lockedAt ?? null,
    ],
  );
  return id;
}

async function seedResponse(
  workspaceId: string,
  attemptId: string,
  questionId: string,
  value: unknown,
): Promise<void> {
  await db.run(
    "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [newId("rsp"), workspaceId, attemptId, questionId, JSON.stringify(value), NOW, 1, null, null],
  );
}

it("computes the counts, mean, median and completion rate", async () => {
  const ws = await publish("numbers-core");
  // 9 submitted, scored 50..90 in steps of 5 → mean 70, median 70.
  const scores = [50, 55, 60, 65, 70, 75, 80, 85, 90];
  for (const percent of scores) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      submittedAt: NOW + MINUTE,
      percent,
    });
  }
  // One never started — registered 10, 9 submitted, completionRate 0.9.
  await candidateIn(ws);

  const s = await testAnalytics(db, ws.workspaceId, ws.testId);
  expect(s).toMatchObject({ mean: 70, median: 70, completionRate: 0.9 });
  expect(s.counts).toMatchObject({ registered: 10, submitted: 9, inProgress: 0, autoSubmitted: 0, locked: 0 });
});

it("reports passRate null when the test sets no pass mark", async () => {
  const ws = await publish("no-pass-mark");
  const candidateId = await candidateIn(ws);
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId,
    testVersionId: ws.versionId,
    submittedAt: NOW,
    percent: 80,
    passed: null,
  });
  expect((await testAnalytics(db, ws.workspaceId, ws.testId)).passRate).toBeNull();
});

it("computes passRate from AttemptScore.passed when the test does set one", async () => {
  const ws = await publish("with-pass-mark");
  const c1 = await candidateIn(ws);
  const c2 = await candidateIn(ws);
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId: c1,
    testVersionId: ws.versionId,
    submittedAt: NOW,
    percent: 80,
    passed: true,
  });
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId: c2,
    testVersionId: ws.versionId,
    submittedAt: NOW,
    percent: 20,
    passed: false,
  });
  expect((await testAnalytics(db, ws.workspaceId, ws.testId)).passRate).toBe(0.5);
});

it("buckets the distribution into ten", async () => {
  const ws = await publish("distribution");
  const candidateId = await candidateIn(ws);
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId,
    testVersionId: ws.versionId,
    submittedAt: NOW,
    percent: 64,
  });
  expect((await testAnalytics(db, ws.workspaceId, ws.testId)).distribution).toHaveLength(10);
});

it("counts a locked attempt as locked, not as in progress", async () => {
  const ws = await publish("locked-not-in-progress");
  const lockedCandidate = await candidateIn(ws);
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId: lockedCandidate,
    testVersionId: ws.versionId,
    lockedAt: NOW + MINUTE,
  });
  for (let i = 0; i < 9; i += 1) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      submittedAt: NOW,
      percent: 60,
    });
  }

  const s = await testAnalytics(db, ws.workspaceId, ws.testId);
  expect(s.counts.locked).toBe(1);
  expect(s.counts.inProgress).toBe(0);
});

it("keeps a locked attempt out of the completion rate's denominator", async () => {
  const ws = await publish("locked-denominator");
  const lockedCandidate = await candidateIn(ws);
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId: lockedCandidate,
    testVersionId: ws.versionId,
    lockedAt: NOW + MINUTE,
  });
  for (let i = 0; i < 9; i += 1) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      submittedAt: NOW,
      percent: 60,
    });
  }

  // 9 submitted, 1 locked, 0 in progress, registered 10 — not 0.9.
  const s = await testAnalytics(db, ws.workspaceId, ws.testId);
  expect(s.completionRate).toBe(1);
});

it("counts the integrity flags 7e writes", async () => {
  const ws = await publish("integrity-flags");
  for (let i = 0; i < 8; i += 1) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      submittedAt: NOW,
      percent: 60,
      integrityFlag: "clean",
    });
  }
  const review = await candidateIn(ws);
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId: review,
    testVersionId: ws.versionId,
    submittedAt: NOW,
    percent: 60,
    integrityFlag: "review",
  });
  const risky = await candidateIn(ws);
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId: risky,
    testVersionId: ws.versionId,
    submittedAt: NOW,
    percent: 60,
    integrityFlag: "high_risk",
  });

  expect((await testAnalytics(db, ws.workspaceId, ws.testId)).integrity).toEqual({
    clean: 8,
    review: 1,
    high_risk: 1,
  });
});

it("does not count an in-progress attempt's integrity flag yet", async () => {
  const ws = await publish("integrity-in-progress");
  const candidateId = await candidateIn(ws);
  // Never submitted, never locked — still running.
  await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId,
    testVersionId: ws.versionId,
    integrityFlag: "review",
  });
  expect((await testAnalytics(db, ws.workspaceId, ws.testId)).integrity).toEqual({
    clean: 0,
    review: 0,
    high_risk: 0,
  });
});

it("compares sets", async () => {
  const ws = await publish("per-set");
  for (const percent of [55, 60, 65]) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      setNo: 1,
      submittedAt: NOW,
      percent,
    });
  }
  for (const percent of [70, 75]) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      setNo: 2,
      submittedAt: NOW,
      percent,
    });
  }

  expect((await testAnalytics(db, ws.workspaceId, ws.testId)).perSet).toEqual([
    { setNo: 1, n: 3, mean: 60 },
    { setNo: 2, n: 2, mean: 72.5 },
  ]);
});

it("reports an honest empty state for a test with no attempts at all", async () => {
  const ws = await publish("zero-attempts");
  await candidateIn(ws);
  await candidateIn(ws);

  const s = await testAnalytics(db, ws.workspaceId, ws.testId);
  expect(s.mean).toBeNull();
  expect(s.median).toBeNull();
  expect(s.passRate).toBeNull();
  expect(s.averageSeconds).toBeNull();
  expect(s.distribution).toEqual(new Array(10).fill(0));
  expect(s.perSet).toEqual([]);
  expect(s.completionRate).toBe(0);
});

it("stays inside the subrequest ceiling for 300 candidates", async () => {
  const ws = await publish("subrequest-ceiling-300");
  for (let i = 0; i < 300; i += 1) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      startedAt: NOW + i,
      submittedAt: NOW + i + MINUTE,
      percent: 50 + (i % 40),
    });
  }

  const counting = countingClient(db);
  await testAnalytics(counting.db, ws.workspaceId, ws.testId);
  expect(counting.count()).toBeLessThanOrEqual(4);
});

// --- testItemAnalysis's own fetch -----------------------------------------

it("feeds itemAnalysis a scored attempt's responses, correctness read from its own score_json", async () => {
  const ws = await publish("item-fetch-basic");
  const candidateId = await candidateIn(ws);
  const attemptId = await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId,
    testVersionId: ws.versionId,
    submittedAt: NOW,
    percent: 100,
    perQuestion: {
      qst_1: { points: 1, max: 1, correct: true },
    },
  });
  await seedResponse(ws.workspaceId, attemptId, "qst_1", { kind: "option", option: "a" });

  const { items: stats } = await testItemAnalysis(db, ws.workspaceId, ws.testId);
  const q1 = stats.find((s) => s.questionId === "qst_1");
  expect(q1).toMatchObject({ shareCorrect: 1, optionPickRates: { a: 1 } });
});

it("excludes a response belonging to an attempt still in progress", async () => {
  const ws = await publish("item-fetch-in-progress");
  const candidateId = await candidateIn(ws);
  const attemptId = await seedAttempt({
    workspaceId: ws.workspaceId,
    candidateId,
    testVersionId: ws.versionId,
    // No submittedAt — never scored.
  });
  await seedResponse(ws.workspaceId, attemptId, "qst_1", { kind: "option", option: "a" });

  const { items: stats } = await testItemAnalysis(db, ws.workspaceId, ws.testId);
  expect(stats.find((s) => s.questionId === "qst_1")).toBeUndefined();
});

it("returns the same discrimination index on repeated calls — ordering is deterministic", async () => {
  const ws = await publish("item-fetch-deterministic");
  // 12 attempts, so the discrimination index is not withheld for being
  // under DISCRIMINATION_MIN_N (10) — several share the same percent, so a
  // non-deterministic tiebreak would be free to vary the top/bottom split
  // between runs.
  const percents = [40, 40, 50, 50, 50, 50, 60, 60, 60, 60, 70, 70];
  for (const percent of percents) {
    const candidateId = await candidateIn(ws);
    const attemptId = await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      submittedAt: NOW,
      percent,
      perQuestion: { qst_1: { points: 1, max: 1, correct: percent >= 50 } },
    });
    await seedResponse(ws.workspaceId, attemptId, "qst_1", { kind: "option", option: "a" });
  }

  const { items: first } = await testItemAnalysis(db, ws.workspaceId, ws.testId);
  const { items: second } = await testItemAnalysis(db, ws.workspaceId, ws.testId);
  expect(second.find((s) => s.questionId === "qst_1")!.discrimination).toBe(
    first.find((s) => s.questionId === "qst_1")!.discrimination,
  );
});

it("stays inside the subrequest ceiling for 300 candidates x 60 questions", async () => {
  const ws = await publish("item-fetch-ceiling-300");
  for (let i = 0; i < 300; i += 1) {
    const candidateId = await candidateIn(ws);
    const attemptId = await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      startedAt: NOW + i,
      submittedAt: NOW + i + MINUTE,
      percent: 50 + (i % 40),
      perQuestion: Object.fromEntries(
        Array.from({ length: 60 }, (_, q) => [`qst_${q}`, { points: 1, max: 1, correct: (i + q) % 3 !== 0 }]),
      ),
    });
    for (let q = 0; q < 60; q += 1) {
      await seedResponse(ws.workspaceId, attemptId, `qst_${q}`, { kind: "option", option: "a" });
    }
  }

  const counting = countingClient(db);
  const { items: stats, truncated } = await testItemAnalysis(counting.db, ws.workspaceId, ws.testId);
  expect(stats).toHaveLength(60);
  expect(truncated).toBe(false);
  expect(counting.count()).toBeLessThanOrEqual(2);
});

// --- Fix round 1, Important 1: a cohort past 500 rows, paged to exhaustion -

it("counts every attempt of a cohort past the 500-row page size, not just the first page", async () => {
  // 650: past one page (500) and short of two (1000), so a reader that
  // silently stopped at the first page's worth would under-report both the
  // registered-vs-counted arithmetic and the mean by a measurable amount —
  // not merely "some rows missing", a specific, checkable wrong number.
  const ws = await publish("past-one-page");
  const ATTEMPTS = 650;
  for (let i = 0; i < ATTEMPTS; i += 1) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      startedAt: NOW + i,
      submittedAt: NOW + i + MINUTE,
      percent: 50,
    });
  }

  const s = await testAnalytics(db, ws.workspaceId, ws.testId);
  expect(s.counts.submitted).toBe(ATTEMPTS);
  expect(s.counts.registered).toBe(ATTEMPTS);
  expect(s.truncated).toBe(false);
  // The histogram bucket for 50-60 holds every one of them — a reader
  // stuck on page one would report 500, not 650.
  expect(s.distribution[5]).toBe(ATTEMPTS);
}, 20_000);

it("feeds itemAnalysis every response of a cohort past the 500-row page size", async () => {
  const ws = await publish("past-one-page-items");
  const ATTEMPTS = 520;
  for (let i = 0; i < ATTEMPTS; i += 1) {
    const candidateId = await candidateIn(ws);
    const attemptId = await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      startedAt: NOW + i,
      submittedAt: NOW + i + MINUTE,
      percent: 50,
      perQuestion: { qst_1: { points: 1, max: 1, correct: true } },
    });
    await seedResponse(ws.workspaceId, attemptId, "qst_1", { kind: "option", option: "a" });
  }

  const { items, truncated } = await testItemAnalysis(db, ws.workspaceId, ws.testId);
  expect(truncated).toBe(false);
  // `n` is the whole attempts cohort `itemAnalysis` was handed (its own
  // contract) — 520 if every page was read, 500 if the fetch silently
  // stopped at page one.
  expect(items.find((s) => s.questionId === "qst_1")!.n).toBe(ATTEMPTS);
}, 20_000);

it("states truncation rather than silently dropping rows once the hard page cap is reached", async () => {
  // `maxAttemptPages: 1, attemptPageSize: 10` are the test-only overrides —
  // two pages of 10 rows (20 attempts) against a cap of one 10-row page
  // reaches the cap with the second page still unread, the same shape a
  // real cohort past `MAX_ATTEMPT_PAGES * 500` attempts would hit, at a
  // fixture size this test can seed in milliseconds rather than minutes.
  const ws = await publish("hits-the-page-cap");
  for (let i = 0; i < 20; i += 1) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      startedAt: NOW + i,
      submittedAt: NOW + i + MINUTE,
      percent: 50,
    });
  }

  const s = await testAnalytics(db, ws.workspaceId, ws.testId, 1, 10);
  expect(s.truncated).toBe(true);
  // The figures still describe exactly what was read — the first page's 10
  // rows, not a fabricated 20 — "bounded and said", never "bounded and
  // silent".
  expect(s.counts.submitted).toBe(10);

  const { truncated: itemsTruncated, items } = await testItemAnalysis(db, ws.workspaceId, ws.testId, 1, 10);
  expect(itemsTruncated).toBe(true);
  expect(items).toEqual([]);
});

it("does not report truncation for a cohort that exactly fills the page cap with nothing left over", async () => {
  // The boundary the loop's own `nextCursor === null` check has to get
  // right: a cohort that fits in exactly `maxAttemptPages` pages must not
  // be reported as truncated merely because the loop ran out of
  // iterations at the same moment the data ran out.
  const ws = await publish("exactly-fills-the-cap");
  for (let i = 0; i < 10; i += 1) {
    const candidateId = await candidateIn(ws);
    await seedAttempt({
      workspaceId: ws.workspaceId,
      candidateId,
      testVersionId: ws.versionId,
      startedAt: NOW + i,
      submittedAt: NOW + i + MINUTE,
      percent: 50,
    });
  }

  const s = await testAnalytics(db, ws.workspaceId, ws.testId, 1, 10);
  expect(s.truncated).toBe(false);
  expect(s.counts.submitted).toBe(10);
});
