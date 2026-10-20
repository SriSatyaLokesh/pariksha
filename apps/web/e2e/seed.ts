// The one seeding helper for the end-to-end harness.
//
// Everything here goes through the HTTP API the organiser itself calls —
// never through the database. A fixture that writes rows directly stops
// matching what the product produces the first time a route grows a
// side effect, and then a gate built on it measures a shape no organiser
// can reach.
//
// `banks`, `questionsPerBank` and `tests` are parameters rather than
// constants because the density gate (D13) needs comfortably more rows
// than a viewport can hold, while a test about one bank wants three.

import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** The organiser app. Same URL `first-run.spec.ts` uses. */
export const ORGANISER = "/admin.html";

export interface SeedResult {
  /** The workspace the organiser opens — `OrganiserApp` boots on
   *  `workspaces[0]`, so the seed targets that one rather than adding a
   *  second the screens would never show. */
  workspaceId: string;
  bankIds: string[];
  testIds: string[];
}

export interface SeedCounts {
  banks: number;
  questionsPerBank: number;
  tests: number;
}

/**
 * Sign the browser in through the stub IdP. `e2e/stub-idp.mjs` asks no
 * questions, so this is one click on the one provider the instance
 * configures — the same two lines `first-run.spec.ts` spells out.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto(ORGANISER);
  await page.getByRole("link", { name: /continue with/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Create banks, questions and tests in the workspace the organiser opens,
 * and publish every test.
 *
 * Publishing is not decoration: a draft with no `duration_minutes` is
 * unpublishable (`publish/checklist.ts`, `timing_missing`), so a seed that
 * omitted it would have every publish refused and a gate built on it would
 * measure a list of drafts that no organiser would ever have. The shape
 * below — a duration, one titled section, a fixed source naming real
 * questions — is the smallest thing a real organiser produces.
 *
 * `request` must be able to reach the API; it signs itself in through the
 * stub IdP if it is not signed in already, which is the same single
 * account the browser gets.
 */
export async function seedWorkspace(
  request: APIRequestContext,
  counts: SeedCounts,
): Promise<SeedResult> {
  await signInApi(request);
  const workspaceId = await workspace(request);
  // A test slug is unique per workspace, so two seeds in one run would
  // collide on `assessment-01` and the second would 409. A per-call counter
  // keeps repeat seeding (6.5e, 6.5f) from needing to know that — and it is
  // a *counter* rather than a random token so every slug is the same length
  // in every run. Slug length is a column width on the test list, and a
  // figure three plans compare against should not have a random variable in
  // it, however small.
  seedCall += 1;
  const run = String(seedCall).padStart(2, "0");

  // Bank order is not stable between runs: these go out a few at a time and
  // `listBanks` sorts on `created_at` with no secondary key. Nothing measured
  // reads it — the bank list counts rows and the browser opens whichever is
  // first — so it is recorded rather than fixed.
  const bankIds = await inBatches(counts.banks, (i) =>
    created(request, `/api/v1/workspaces/${workspaceId}/banks`, {
      name: `Bank ${pad(i + 1)} — ${TOPICS[i % TOPICS.length]}`,
    }),
  );

  // Questions go in through **whole-bank import**, one request per bank,
  // rather than one request per question.
  //
  // Not a shortcut around the routes — import is a shipped organiser feature
  // (`POST .../banks/:bankId/import`, the same endpoint the import dialog
  // calls). It does **not** share the per-question route's write: that one
  // calls `upsertQuestion`, while import goes through `writeImportedBank` ->
  // `questionInsertStatements`, which exists precisely to replace that loop.
  // The two produce byte-identical rows — same mapping, same columns, same
  // values — which is why the figures are the same either way, verified
  // rather than assumed. It is about volume: a 40x40 seed is 1,600 round
  // trips the per-question way, and every one of them crosses
  // `vite preview`'s proxy to the API. At that rate the proxy intermittently
  // answered **502** mid-seed on Windows. 40 requests do not.
  //
  // One ceiling comes with it: `questionsPerBank` is now capped at
  // `IMPORT_MAX_QUESTIONS` (500), enforced per request and therefore per
  // bank. Harmless at 40; a caller asking for more gets a 413 where the
  // per-question path would have worked.
  await inBatches(counts.banks, (i) =>
    ok(request, "post", `/api/v1/workspaces/${workspaceId}/banks/${bankIds[i]}/import`, {
      format: "pariksha/bank@1",
      name: `Bank ${pad(i + 1)}`,
      questions: Array.from({ length: counts.questionsPerBank }, (_, q) => ({
        id: `Q${pad(q + 1)}`,
        type: "true_false",
        prompt: `${TOPICS[q % TOPICS.length]} — statement ${q + 1} is true of the set described above.`,
        key: q % 2 === 0,
        points: 1,
        difficulty: DIFFICULTIES[q % DIFFICULTIES.length],
        tags: [TOPICS[q % TOPICS.length]!.toLowerCase()],
      })),
    }),
  );

  // Every seeded test gets a section drawing from the first bank, because a
  // test with no questions cannot be published (`section_empty`). Asking for
  // tests without a bank to draw from would otherwise yield a list of silent
  // drafts, which is not the shape the density figures were measured against
  // and not what the caller asked for — so it is an error, not a surprise.
  // The ids come back from the list route: import reports a count, not ids.
  const firstBank = bankIds[0];
  const sectionQuestions =
    firstBank === undefined
      ? []
      : (
          (await getJson(request, `/api/v1/workspaces/${workspaceId}/banks/${firstBank}/questions`))
            .questions as { id: string }[]
        )
          .slice(0, 5)
          .map((question) => question.id);
  if (counts.tests > 0 && sectionQuestions.length === 0) {
    throw new Error(
      "seedWorkspace cannot publish tests without questions to draw from: " +
        "ask for at least one bank with at least one question, or for no tests.",
    );
  }

  const testIds = await inBatches(counts.tests, async (i) => {
    const testId = await created(request, `/api/v1/workspaces/${workspaceId}/tests`, {
      name: `${TOPICS[i % TOPICS.length]} assessment ${pad(i + 1)}`,
      slug: `assessment-${run}-${pad(i + 1)}`,
    });
    await ok(request, "patch", `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`, {
      settings: { timing: { duration_minutes: 60 } },
      sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: sectionQuestions } }],
    });
    await ok(request, "post", `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`, {});
    return testId;
  });

  return { workspaceId, bankIds, testIds };
}

/** Bumped once per `seedWorkspace` call, for the slug suffix above. */
let seedCall = 0;

const TOPICS = ["Algebra", "Mechanics", "Optics", "Genetics", "Kinetics", "Statistics", "Geometry", "Thermodynamics"];
const DIFFICULTIES = ["easy", "medium", "hard"];
/**
 * How many seed writes are in flight at once. Four, not sixteen: at sixteen
 * this seed intermittently failed mid-run on Windows with
 * `connect ETIMEDOUT ::1:4273` / `ECONNREFUSED 127.0.0.1:4273` — the burst
 * outruns `vite preview`'s accept backlog, and `localhost` resolving to `::1`
 * first makes the first attempt the slow one. Four is still ~9x faster than
 * serialising and has not failed. It is a concurrency limit, not a timeout:
 * no bar moved, and the figures are identical either way.
 */
const BATCH = 4;

const pad = (n: number): string => String(n).padStart(2, "0");

/** `Promise.all` over the whole range would open hundreds of sockets at
 *  once; this keeps the order of the results and the pressure bounded. */
async function inBatches<T>(count: number, make: (index: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < count; start += BATCH) {
    const size = Math.min(BATCH, count - start);
    out.push(...(await Promise.all(Array.from({ length: size }, (_, k) => make(start + k)))));
  }
  return out;
}

/** The stub provider's `/authorize` redirects straight back to the
 *  callback, and the callback's `Set-Cookie` lands on this context's own
 *  jar — so sign-in over the API is one GET that follows its redirects. */
async function signInApi(request: APIRequestContext): Promise<void> {
  if ((await request.get("/api/v1/me")).ok()) return;
  await request.get("/api/v1/auth/stub/start");
  const me = await request.get("/api/v1/me");
  expect(me.ok(), `the seed could not sign in: ${me.status()} ${await me.text()}`).toBe(true);
}

/** The workspace `OrganiserApp` will boot on, created if the instance has
 *  never been set up. */
async function workspace(request: APIRequestContext): Promise<string> {
  const listed = await request.get("/api/v1/workspaces");
  expect(listed.ok(), `workspaces: ${listed.status()} ${await listed.text()}`).toBe(true);
  const existing = (await listed.json()).workspaces?.[0]?.id;
  if (typeof existing === "string") return existing;

  // Nothing exists yet, so this is the first-run wizard's own endpoint —
  // `POST /workspaces` would create a row the instance has no owner for.
  return created(request, "/api/v1/setup/complete", { name: "Seeded workspace" });
}

async function getJson(request: APIRequestContext, url: string): Promise<Record<string, unknown>> {
  const res = await request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as Record<string, unknown>;
}

async function created(request: APIRequestContext, url: string, body: unknown): Promise<string> {
  const id = (await ok(request, "post", url, body)).id;
  expect(typeof id, `${url} answered no id`).toBe("string");
  return id as string;
}

async function ok(
  request: APIRequestContext,
  method: "post" | "patch",
  url: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await request[method](url, { data: body });
  expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as Record<string, unknown>;
}
