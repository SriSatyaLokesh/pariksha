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
  // collide on `assessment-01` and the second would 409. One short token
  // per call keeps repeat seeding (6.5e, 6.5f) from needing to know that.
  const run = Math.random().toString(36).slice(2, 7);

  const bankIds: string[] = [];
  for (let i = 0; i < counts.banks; i += 1) {
    bankIds.push(
      await created(request, `/api/v1/workspaces/${workspaceId}/banks`, {
        name: `Bank ${pad(i + 1)} — ${TOPICS[i % TOPICS.length]}`,
      }),
    );
  }

  // Questions and tests are independent writes against one SQLite file, so
  // they go out a few at a time rather than one at a time: a 40×40 seed is
  // 1,600 round trips and serialising them is the difference between a
  // couple of seconds and most of a minute.
  const questionIds = new Map<string, string[]>();
  for (const bankId of bankIds) {
    questionIds.set(
      bankId,
      await inBatches(counts.questionsPerBank, (i) =>
        created(request, `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`, {
          id: `Q${pad(i + 1)}`,
          type: "true_false",
          prompt: `${TOPICS[i % TOPICS.length]} — statement ${i + 1} is true of the set described above.`,
          key: i % 2 === 0,
          points: 1,
          difficulty: DIFFICULTIES[i % DIFFICULTIES.length],
          tags: [TOPICS[i % TOPICS.length]!.toLowerCase()],
        }),
      ),
    );
  }

  const firstBank = bankIds[0];
  const sectionQuestions = firstBank === undefined ? [] : (questionIds.get(firstBank) ?? []).slice(0, 5);

  const testIds = await inBatches(counts.tests, async (i) => {
    const testId = await created(request, `/api/v1/workspaces/${workspaceId}/tests`, {
      name: `${TOPICS[i % TOPICS.length]} assessment ${pad(i + 1)}`,
      slug: `assessment-${run}-${pad(i + 1)}`,
    });
    if (sectionQuestions.length > 0) {
      await ok(request, "patch", `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`, {
        settings: { timing: { duration_minutes: 60 } },
        sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: sectionQuestions } }],
      });
      await ok(request, "post", `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`, {});
    }
    return testId;
  });

  return { workspaceId, bankIds, testIds };
}

const TOPICS = ["Algebra", "Mechanics", "Optics", "Genetics", "Kinetics", "Statistics", "Geometry", "Thermodynamics"];
const DIFFICULTIES = ["easy", "medium", "hard"];
const BATCH = 16;

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
