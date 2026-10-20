// The attempt-scoped media route (#71, P6.7) — **Review Focus 2**.
//
// The obvious implementation of this route is "the attempt token names a
// workspace, so serve `media/<workspaceId>/<key>`". It works perfectly for
// every candidate in every happy-path test, and it authorises every image
// in the workspace to every candidate: the diagram in a question they were
// not given, in a bank belonging to a different test, in a draft nobody has
// published. Nothing fails — their own images load, the route is 200, the
// budget is 2.
//
// So the tests below are not about the happy path. They are about the
// distinction: a key that **exists, in this very workspace, in storage** and
// is not in this attempt's pinned `layout.media` must be the same 404 as a
// key from another tenant. `storedOutsideMyPaper` is put into alpha's own
// storage prefix and asserted to be really there, so the 404 it gets can
// only be the layout check — a missing object would prove nothing.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  closeClient,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { MEDIA_BASE, type AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { seedPublishedTest, seedWorkspace, seedTest, DAY, iso } from "./fixtures.js";
import { seedAttemptTests, seedBank, PAPER_FORM } from "./paper-fixtures.js";

const T = FIXED_NOW;

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
await seedAttemptTests(deps, workspaceId);

// A second tenant, with a paper and a stored image of its own.
const otherWorkspaceId = await seedWorkspace(deps, "omega", "Omega Corp");
const otherQ = await seedBank(deps, otherWorkspaceId);
await seedTest(deps, otherWorkspaceId, {
  name: "Paper",
  slug: "paper",
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
    },
    sections: [
      {
        id: "logic",
        title: "Logic",
        source: { kind: "fixed", questions: [otherQ["LOG-002"] as string] },
      },
    ],
  },
});

/** A one-pixel PNG, near enough: the route never parses the bytes, it
 *  only hands them back, so what matters is that they differ per key. */
const bytesFor = (key: string): Uint8Array => new TextEncoder().encode(`PNG:${key}`);

/** In alpha's own storage prefix, and in alpha's own bank's reach — but
 *  in no attempt's pinned layout. The whole of Review Focus 2. */
const OUTSIDE = "stored-outside-my-paper.png";
/** In the other tenant's prefix entirely. */
const OTHER_WS = "omega-only.png";
/** In my layout, from `LOG-002` in the fixed section of `alpha/paper`. */
const MINE = "log2-diagram.png";

for (const [prefix, key] of [
  [workspaceId, MINE],
  [workspaceId, OUTSIDE],
  [otherWorkspaceId, MINE],
  [otherWorkspaceId, OTHER_WS],
] as const) {
  await deps.storage.put(`media/${prefix}/${key}`, bytesFor(`${prefix}/${key}`), {
    contentType: "image/png",
  });
}

afterAll(() => closeClient(deps.db));

// --- helpers -----------------------------------------------------------

let serial = 1;

async function startOn(
  workspace: string,
  slug: string,
): Promise<{ cookie: string; paper: AttemptPaper }> {
  const test = await resolvePublishedTest(deps.db, workspace, slug, T);
  if (!test) throw new Error(`no published test at ${workspace}/${slug}`);
  const candidateId = await createCandidate(deps.db, test.workspaceId, {
    testId: test.testId,
    formValues: { roll: `R${String(serial++)}` },
    consentVersion: "2026-10-01",
    now: T,
  });
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId: test.workspaceId, testVersionId: test.testVersionId, candidateId },
    now: T,
    expiresAt: T + REGISTRATION_TTL_MS,
  });
  const res = await app.request(`/api/v1/run/${workspace}/${slug}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 201) throw new Error(`start answered ${String(res.status)}`);
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    paper: (await res.json()) as AttemptPaper,
  };
}

const fetchMedia = (key: string, cookie: string | undefined, on = app): Promise<Response> =>
  on.request(
    `/api/v1/run/attempt/media/${key}`,
    cookie === undefined ? {} : { headers: { cookie } },
  );

async function layoutOf(attemptId: string): Promise<{ media: string[] }> {
  const rows = await deps.db.query<{ layout_json: string }>(
    "SELECT layout_json FROM attempt WHERE id = ?",
    [attemptId],
  );
  return JSON.parse(rows[0]?.layout_json ?? "{}") as { media: string[] };
}

let mine: { cookie: string; paper: AttemptPaper };

beforeEach(async () => {
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM auth_token", []);
  mine = await startOn("alpha", "paper");
});

// --- the paper the candidate was actually given -------------------------

it("a candidate loads exactly the media in their own attempt's pinned layout", async () => {
  const res = await fetchMedia(MINE, mine.cookie);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytesFor(`${workspaceId}/${MINE}`));
});

it("the key really is in the layout, and the one beside it really is in storage", async () => {
  const layout = await layoutOf(mine.paper.attemptId);
  expect(layout.media).toContain(MINE);
  expect(layout.media).not.toContain(OUTSIDE);
  // The object the next test expects a 404 for exists, in this very
  // workspace. A 404 from a missing object would prove nothing.
  expect(await deps.storage.get(`media/${workspaceId}/${OUTSIDE}`)).not.toBeNull();
});

it("REVIEW FOCUS 2: a key in the same workspace but outside this attempt's layout is 404", async () => {
  expect((await fetchMedia(OUTSIDE, mine.cookie)).status).toBe(404);
});

it("S-10: every refusal is one 404 with one body, byte for byte", async () => {
  // In the layout and in no bucket, so the fourth refusal below is the
  // storage miss and not the membership check.
  const phantom = "pinned-but-never-uploaded.png";
  const layout = await layoutOf(mine.paper.attemptId);
  layout.media.push(phantom);
  await deps.db.run("UPDATE attempt SET layout_json = ? WHERE id = ?", [
    JSON.stringify(layout),
    mine.paper.attemptId,
  ]);

  const answers = await Promise.all(
    [
      OUTSIDE, // exists, same workspace, outside this paper
      OTHER_WS, // another tenant entirely
      "notanimage.pdf", // an extension this route will not serve
      phantom, // in this very paper, and no object behind it
    ].map(async (key) => {
      const res = await fetchMedia(key, mine.cookie);
      return `${String(res.status)} ${await res.text()}`;
    }),
  );

  expect(new Set(answers).size).toBe(1);
  expect(answers[0]).toContain("404");
  // And it says nothing about which of the four it was.
  expect(answers[0]).not.toMatch(/paper|layout|workspace|attempt|svg|pdf/i);
});

it("S-10: the same key under two tenants serves each candidate only their own copy", async () => {
  const theirs = await startOn("omega", "paper");
  const ours = await fetchMedia(MINE, mine.cookie);
  const theirsRes = await fetchMedia(MINE, theirs.cookie);

  expect(ours.status).toBe(200);
  expect(theirsRes.status).toBe(200);
  // Same key, two tenants, two different objects — so the storage path is
  // still scoped by the attempt's own workspace even though the
  // *authorisation* is not.
  expect(await theirsRes.text()).toBe(`PNG:${otherWorkspaceId}/${MINE}`);
  expect(await ours.text()).toBe(`PNG:${workspaceId}/${MINE}`);
});

// --- the credential ------------------------------------------------------

it("no cookie is 401, and the organiser route is still banks.edit", async () => {
  expect((await fetchMedia(MINE, undefined)).status).toBe(401);
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/media/:key"]).toBe("banks.edit");
  expect(ROUTE_AUTH["GET /api/v1/run/attempt/media/:key"]).toBe("attempt");
});

// --- Phase 4's two carried properties ------------------------------------

it("the response is private and immutable", async () => {
  expect((await fetchMedia(MINE, mine.cookie)).headers.get("cache-control")).toBe(
    "private, max-age=31536000, immutable",
  );
});

it("SVG is still refused — even a stored SVG the layout itself names", async () => {
  const svg = "scripted.svg";
  await deps.storage.put(`media/${workspaceId}/${svg}`, bytesFor(svg), {
    contentType: "image/svg+xml",
  });
  // Forged into the very array the route authorises by, so what refuses
  // this is the extension and nothing else.
  const layout = await layoutOf(mine.paper.attemptId);
  layout.media.push(svg);
  await deps.db.run("UPDATE attempt SET layout_json = ? WHERE id = ?", [
    JSON.stringify(layout),
    mine.paper.attemptId,
  ]);
  expect((await layoutOf(mine.paper.attemptId)).media).toContain(svg);

  expect((await fetchMedia(svg, mine.cookie)).status).toBe(404);
});

// --- the scrubber's rewrite ----------------------------------------------

it("the scrubber rewrites media.src to the run path, so no paper names the organiser route", async () => {
  const res = await app.request("/api/v1/run/attempt", { headers: { cookie: mine.cookie } });
  const text = JSON.stringify(await res.json());
  expect(text).toContain(`${MEDIA_BASE}${MINE}`);
  expect(text).not.toContain("/api/v1/workspaces/");
  // And the rewritten src is a URL this route really answers.
  const src = (await startOn("alpha", "paper")).paper.sections
    .flatMap((section) => section.questions)
    .flatMap((question) => question.media ?? [])
    .map((image) => image.src)[0] as string;
  expect(src.startsWith(MEDIA_BASE)).toBe(true);
  expect((await app.request(src, { headers: { cookie: mine.cookie } })).status).toBe(200);
});

// --- the budget ----------------------------------------------------------

it("authorising the key costs no extra subrequest", async () => {
  const counting = countingDeps(deps);
  const res = await fetchMedia(MINE, mine.cookie, createApp(counting.deps));
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(
    ROUTE_BUDGETS["/api/v1/run/attempt/media/:key"] as number,
  );
  // One of each, named: the attempt join and the object read. A layout
  // membership test that reached for the workspace's questions, or listed
  // the bucket, would move one of these.
  expect(counting.counts()).toMatchObject({ db: 1, storage: 1 });
});

it("a refused key costs the lookup and no storage read at all", async () => {
  const counting = countingDeps(deps);
  expect((await fetchMedia(OUTSIDE, mine.cookie, createApp(counting.deps))).status).toBe(404);
  expect(counting.counts()).toMatchObject({ db: 1, storage: 0 });
});
