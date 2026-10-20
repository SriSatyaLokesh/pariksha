// C-01 and S-10, over the mounted application. Nothing here calls
// `resolvePublishedTest` beside the route; every assertion goes through
// `app.request()` on a real `createApp(deps)` (Global Constraints), because
// the question is what a candidate with no cookie actually receives.

import { afterAll, expect, it } from "vitest";
import { closeClient } from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, seedPublishedTest } from "./fixtures.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

await seedPublishedTest(deps);

const json = async (path: string): Promise<Record<string, unknown>> =>
  (await app.request(path)).json() as Promise<Record<string, unknown>>;

it("C-01: the landing payload carries everything the page shows", async () => {
  expect(await json("/api/v1/run/alpha/aptitude")).toMatchObject({
    name: "Aptitude",
    description: "A 45-minute aptitude paper.",
    durationMinutes: 45,
    // 4 fixed + 10 pooled + 3 per set.
    questionCount: 17,
    sections: [
      { id: "logic", title: "Logic", questionCount: 4, timeLimitMinutes: 15 },
      { id: "numeracy", title: "Numeracy", questionCount: 10, timeLimitMinutes: null },
      { id: "verbal", title: "Verbal", questionCount: 3, timeLimitMinutes: null },
    ],
    proctoring: "standard",
    accessMode: "link_code",
    timezone: "Asia/Kolkata",
    state: "open",
    opensAt: FIXED_NOW - DAY,
    closesAt: FIXED_NOW + DAY,
    latestStartAt: FIXED_NOW + DAY - 3_600_000,
    serverNow: FIXED_NOW,
    branding: {
      logo: "9f1c.png",
      logoAlt: "Alpha Corp",
      primaryColour: "#b63a10",
      footerText: "Alpha Corp · Hyderabad",
      startMessage: "Read every instruction before you begin.",
    },
  });
});

it("C-01: the navigation rule is stated to the candidate before they start", async () => {
  // `rules` is not a field of `pariksha/test@1` — the one rule a candidate
  // must know before starting is what navigation mode they are about to be
  // held to, and @pariksha/core already owns that sentence
  // (NAVIGATION_CONSEQUENCE), stated once rather than worded a second way.
  expect(await json("/api/v1/run/alpha/aptitude")).toMatchObject({
    rules: "A candidate cannot go back to an earlier question.",
  });
  // Absent `navigation` means the documented default, `free` — applied by
  // the server, because nothing shared applies it (reconciliation row 8).
  expect(await json("/api/v1/run/alpha/pooled")).toMatchObject({
    rules: "A candidate can jump to any question at any time.",
  });
});

it("defaults a test with no window to an open one, and reports no dates", async () => {
  expect(await json("/api/v1/run/alpha/pooled")).toMatchObject({
    state: "open",
    opensAt: null,
    closesAt: null,
    latestStartAt: null,
    // No `access` block at all: the document makes it optional and the
    // server answers with the mode a candidate then meets.
    accessMode: "link_code",
    proctoring: "off",
    timezone: "UTC",
  });
});

it("a scheduled test is reachable and reports its window rather than 404ing", async () => {
  // Reconciliation row 12: the column holds "published" and can never hold
  // "open". A route comparing `status === "open"` would make every
  // scheduled test unreachable forever.
  expect(await json("/api/v1/run/alpha/scheduled")).toMatchObject({
    state: "scheduled",
    opensAt: FIXED_NOW + DAY,
    closesAt: FIXED_NOW + 2 * DAY,
  });
});

it("a test whose window is over is still reachable, as closed", async () => {
  expect(await json("/api/v1/run/alpha/shut")).toMatchObject({ state: "closed" });
});

it("S-10: the landing payload names no question, key, code or internal id", async () => {
  const text = await (await app.request("/api/v1/run/alpha/aptitude")).text();
  for (const leak of ["LOG-001", "qst_", "wsp_", "tst_", "ver_", "OPENSESAME", "access_code"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("T-21: the landing payload says the test identifies candidates by ID, and never who", async () => {
  // The gate's form labels the identifier optional and `listEntry`
  // refuses a blank one with `code_wrong` — the same bytes as a wrong
  // access code. A listed candidate following the UI's own wording was
  // told their correct code was wrong, so the browser has to know which
  // form to render.
  expect(await json("/api/v1/run/alpha/listed")).toMatchObject({ candidateList: true });
  expect(await json("/api/v1/run/alpha/aptitude")).toMatchObject({ candidateList: false });
  // A boolean about the test, not a word about a person: the uploaded
  // file name and every identifier on it stay server-side (`S-10`).
  const text = await (await app.request("/api/v1/run/alpha/listed")).text();
  for (const leak of ["list.csv", "21CS0147", "ananya"]) expect(text, leak).not.toContain(leak);
});

it("a pool section reports its requested count without reading the bank", async () => {
  const counting = countingDeps(deps);
  const body = (await (await createApp(counting.deps).request("/api/v1/run/alpha/pooled")).json()) as {
    sections: { questionCount: number }[];
  };
  expect(body.sections[0]?.questionCount).toBe(10);
  expect(counting.counts().total).toBe(1);
});

it("measures the real subrequest cost of the landing route", async () => {
  // The floor is 0, not 2: `authenticate` reads a session only when a
  // signed cookie is present and a candidate carries none, so this is the
  // one read the route itself makes.
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request("/api/v1/run/alpha/aptitude");
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug"]);
  expect(counting.counts().total).toBe(1);
});

it("unpublished, archived and unknown are the same 404, byte for byte", async () => {
  const paths = ["alpha/draft-only", "alpha/archived", "alpha/nope", "nope/x"];
  const answers = await Promise.all(
    paths.map(async (path) => {
      const res = await app.request(`/api/v1/run/${path}`);
      return `${res.status} ${await res.text()}`;
    }),
  );
  expect(new Set(answers).size).toBe(1);
  expect(answers[0]).toContain("404");
});

it("the slug 'attempt' cannot shadow the attempt routes the later tasks mount", async () => {
  // `/api/v1/run/attempt/answer` and `/api/v1/run/:workspaceSlug/:testSlug`
  // both match three segments. Hono prefers a static segment to a
  // parameter, which Task 5 pins once `/run/attempt/...` is really mounted;
  // until then the belt is `resolvePublishedTest`'s own refusal.
  //
  // The fixtures publish a REAL test at `attempt/answer`, so the only thing
  // that can produce a 404 here is the refusal itself (review finding I-5).
  // Asserting against a slug pair that resolved to nothing anyway is what
  // made the first version of this test unable to fail.
  expect((await app.request("/api/v1/run/attempt/answer")).status).toBe(404);

  // The control: the identical test under any other workspace slug is
  // served normally, so what refused above was the slug and not the paper.
  const control = await app.request("/api/v1/run/not-attempt/answer");
  expect(control.status).toBe(200);
  expect(await control.json()).toMatchObject({ name: "Answer", durationMinutes: 10 });
});
