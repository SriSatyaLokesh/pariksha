// The candidate app's one door to the API.
//
// A separate module from `lib/api.ts` on purpose, and not a widening of it:
// `lib/api.ts` is organiser code, `bundle.test.ts`'s `ADMIN_PATH_RE` names
// it by path, and the candidate's 300 KB budget (PRD non-functional table)
// is the reason the two bundles are split at all. One import of the
// organiser client would pull every organiser screen into a bundle a
// candidate downloads under a clock.
//
// `RunClient` is an interface the screens take as a prop, the same shape
// `ApiClient` has and for the same reason: nothing here may need a deployed
// Worker to be believed.

import type { AccessMode, FieldIssue, RegistrationFormSpec, TestConsent } from "@pariksha/core";
import type { AttemptPaper } from "./paper.js";
import type { QueuedSave, SaveOutcome } from "./queue.js";

export type { AccessMode, FieldIssue, RegistrationFormSpec, TestConsent };
export type { AttemptPaper, CandidateQuestion, PaperSection } from "./paper.js";
export type { QueuedSave, SaveOutcome, SaveState } from "./queue.js";

/** The five states `deriveState` answers with — the stored column holds
 * only four of them and never `"open"`. */
export type TestState = "draft" | "scheduled" | "open" | "closed" | "archived";

/** `GET /api/v1/run/:workspaceSlug/:testSlug` — C-01 in one read. */
export interface LandingPayload {
  name: string;
  description: string | null;
  durationMinutes: number;
  questionCount: number;
  sections: { id: string; title: string; questionCount: number; timeLimitMinutes: number | null }[];
  rules: string | null;
  proctoring: "off" | "standard" | "strict";
  accessMode: AccessMode;
  state: TestState;
  opensAt: number | null;
  closesAt: number | null;
  latestStartAt: number | null;
  timezone: string;
  branding: {
    logo: string | null;
    logoAlt: string | null;
    primaryColour: string | null;
    footerText: string | null;
    startMessage: string | null;
  };
  /**
   * Whether this test identifies its candidates by an uploaded list
   * (`T-21`). When it does, the gate **requires** the roll number or ID,
   * because `listEntry` refuses a blank one with `code_wrong` — the same
   * bytes as a wrong access code, so a listed candidate who left it blank
   * was told their correct code was wrong. When it does not, the field is
   * not shown at all rather than offered as optional.
   *
   * **Not an `S-10` disclosure.** `S-10` protects a *person*: whether a
   * given identifier is on the list. This is a property of the test,
   * identical for every visitor holding the link, and a candidate has to
   * know it to comply.
   */
  candidateList: boolean;
  /**
   * The server's own reading of the clock when it answered. Every countdown
   * is a delta from this plus `performance.now()`, never from `Date.now()`
   * (Review Focus 4) — Task 9 builds the clock; this is where its anchor
   * arrives.
   */
  serverNow: number;
}

/**
 * What the access gate takes. Every field is optional because the four
 * modes need different ones, and which they need is the server's
 * decision: the browser sends what the candidate filled in and the
 * server says whether that was enough (Review Focus: the server decides,
 * the browser displays).
 */
export interface AccessRequest {
  code?: string;
  invite?: string;
  email?: string;
  otp?: string;
  /** The test's first unique registration field, on a candidate-listed
   *  test — the gate runs before the form is shown. */
  identifier?: string;
  /** Task 4's proof of work. Accepted and ignored by the server until it
   *  lands, so the request shape does not change when it does. */
  captchaToken?: string;
}

/**
 * `GET /api/v1/run/:ws/:test/form` — what to put in front of the candidate
 * once the gate has let them through.
 *
 * `registered` is `T-14`'s re-entry: the gate recognised someone who has
 * already consented and filled this form (a second allowed attempt, a lost
 * cookie, another device), so the form is skipped and the token `/start`
 * spends arrives here instead.
 */
export interface RegistrationPayload {
  consent: TestConsent | null;
  form: RegistrationFormSpec;
  registered?: boolean;
  registrationToken?: string;
}

/**
 * `C-08`'s finish page (Task 11). The receipt carries **no score**: the
 * score, if the organiser released one, is the separate `ReleasedResult`
 * the server's own gate assembled.
 */
export interface Receipt {
  attemptId: string;
  submittedAt: number;
  answered: number;
  unanswered: number;
  total: number;
  /** "Attempt 2 of 3" — this attempt's ordinal, and what the test allows. */
  attemptNo: number;
  attemptsAllowed: number;
}

/**
 * One attempt's result, **exactly as much of it as the candidate may see**
 * (`AC-16`).
 *
 * The optional keys are optional on the wire, not in the renderer: a
 * `score_only` release arrives with no `sections` key at all and a
 * `score_and_sections` release with no `review` key. Nothing in this
 * bundle decides that — `releasedResult` on the server does, and the
 * browser has no way to ask for more than it was sent. `show` says which
 * level was actually served, which is not always the one the organiser
 * configured: `full_review` degrades while the candidate still has an
 * attempt left.
 */
export interface ReleasedResult {
  show: "score_only" | "score_and_sections" | "full_review";
  total: number;
  max: number;
  percent: number;
  /** `null` when the test sets no pass mark — not `false`. */
  passed: boolean | null;
  /** Questions still waiting on a person, so the score may yet rise. */
  pending: string[];
  sections?: { sectionId: string; title: string; points: number; max: number }[];
  review?: {
    questionId: string;
    yourAnswer: unknown;
    correct: unknown;
    explanation: string | null;
    points: number;
  }[];
}

/** Widened by Tasks 2, 3, 5, 8 and 11. */
export interface RunClient {
  landing(): Promise<LandingPayload>;
  /** All four modes end here: a single-use entry token the registration
   *  step (Task 3) spends. */
  access(input: AccessRequest): Promise<{ entryToken: string }>;
  /** The `email_code` mode's first leg. Resolves on 202 and tells the
   *  caller nothing else — the code goes to an inbox. */
  requestEmailCode(email: string): Promise<void>;
  /** The consent text and the registration form, behind the entry token.
   *  410 (`RunError`, `entry_expired`) once the token has been spent. */
  form(entryToken: string): Promise<RegistrationPayload>;
  /**
   * The submission. The server re-checks every rule the browser just
   * checked, so a 422 carries `issues` positioned on their fields — the
   * same `FieldIssue[]` `validateRegistration` produced locally, with the
   * same messages, which is what makes showing either one correct.
   *
   * `values` carries the form's own field ids plus the reserved
   * `"consent"` key, which is the acceptance rather than a stored answer.
   */
  register(
    entryToken: string,
    values: Record<string, unknown>,
    captchaToken?: string,
  ): Promise<{ registrationToken: string }>;
  /**
   * Spends the single-use `registrationToken` and mints the attempt
   * (Task 5). The 256-bit attempt token comes back as an `HttpOnly`
   * cookie the browser stores and this module never sees — which is why
   * nothing is returned but the paper, and why `resume` takes nothing.
   *
   * 409 (`RunError`) when the candidate already has this test open, has
   * used every attempt, is inside a cooldown, or the published version
   * has gone stale; 410 once the registration token has been spent.
   */
  start(registrationToken: string): Promise<AttemptPaper>;
  /**
   * The same paper again, from the attempt cookie alone — `C-06`'s
   * "closing the browser and reopening it resumes the same attempt".
   * `null` when this browser holds no live attempt, which is the
   * ordinary case on a first visit and not an error to show anyone.
   */
  resume(): Promise<AttemptPaper | null>;
  /**
   * One answer, saved (Task 8). The transport half of the offline queue:
   * it turns the route's answer into an **outcome**, because the status
   * code alone cannot be trusted to mean "stored".
   *
   *  * 200 `accepted` / `superseded` — the server's own word. The second
   *    is not an error: a late retry of sequence 4 after 5 must not
   *    regress the answer, and the queue is right to drop it.
   *  * 404 → `dropped`. The question is not on this candidate's pinned
   *    paper, so no retry will ever store it. The queue discards it and
   *    says so; it carries no `message`, because the route's own body is
   *    the deliberately uninformative `S-10` 404 and the candidate needs
   *    a sentence they can act on instead.
   *  * every other 4xx → `refused`, carrying the server's sentence. The
   *    queue **keeps** the answer and the banner never reads Saved.
   *  * 5xx and a transport failure **throw**, so the queue backs off and
   *    tries again rather than treating a bad minute as a verdict.
   *
   * `remainingMs`, `maxIndex` and `sectionRemainingMs` are absent on a
   * refusal and present on every answer the route actually produced.
   *
   * **The browser stores all three and derives none of them.** The
   * countdown re-anchors from the first two readings — re-anchoring to a
   * number nobody sent would be worse than not re-anchoring at all — and
   * `maxIndex` is how far the server now says this candidate has got,
   * which is what the rail's lock, the opening index and the Previous
   * button are all drawn from. A browser that tracked its own furthest
   * index would be a second implementation of a server rule, and a wrong
   * one: the progress bump rides the same statement guarded only by
   * `max_index < ?`, so it happens on a `superseded` save too.
   */
  putAnswer(save: QueuedSave): Promise<{
    outcome: SaveOutcome;
    message?: string;
    remainingMs?: number;
    maxIndex?: number;
    /** `null` on a paper with no section time limit — a reading, not an
     *  absence, so it is distinguished from `undefined`. */
    sectionRemainingMs?: number | null;
  }>;
  /**
   * End the attempt (Task 11, `C-08`). Takes nothing: the cookie is the
   * credential and the scope, and there is no field a candidate could
   * send that the server should believe.
   *
   * Idempotent on the server — a second call answers the first call's
   * receipt rather than scoring again — so a double press, the browser's
   * own auto-submit at zero racing the candidate's, and a reload of the
   * finish page all end in one score, one audit row and one receipt.
   */
  submit(): Promise<{ receipt: Receipt; released: ReleasedResult | null }>;
  /**
   * `C-09`'s return visit, a week later with no cookie left. Resolves on
   * 202 and tells the caller nothing else — an unknown reference and the
   * wrong address answer identically, because anything else would say
   * whether an address sat a test.
   */
  requestResultCode(attemptRef: string, email: string): Promise<void>;
  /** Spends the emailed code. 410 (`RunError`, `code_expired`) once it has
   *  been used or has lapsed. */
  verifyResultCode(attemptRef: string, email: string, code: string): Promise<ReleasedResult | null>;
}

/** The save path. The attempt cookie rides it on its own (`S-06`), so
 *  the queue's replay needs no credential of its own. */
const ANSWER_PATH = "/api/v1/run/attempt/answer";

/**
 * `S-07`'s bot protection, candidate side (ADR 0009): find a counter
 * whose SHA-256 over the challenge starts with `bits` zero bits.
 *
 * WebCrypto and nothing else — no widget, no third-party origin, no CSP
 * change, which is the whole reason this exists instead of Turnstile. In
 * the page rather than a worker: at the shipped difficulty it is a short
 * burst, and a worker would be a second bundle entry for a wait a
 * candidate does not see.
 *
 * `bits` comes from the server rather than from a constant here, so
 * raising the difficulty against an abusive deployment is an API deploy
 * and not a web one. The cap is the other side of that: a misconfigured
 * difficulty must fail in a second, not hang a candidate's tab forever.
 */
export async function solvePow(challenge: string, bits: number): Promise<string> {
  const encoder = new TextEncoder();
  for (let base = 0; base < POW_CEILING; base += POW_BATCH) {
    // **Batched on purpose, and this is the whole performance story.**
    // `crypto.subtle.digest` is asynchronous, so hashing forty bytes
    // costs one promise and one thread hop rather than one SHA-256 — a
    // measured ~22 microseconds an await on a desktop, which at the
    // shipped difficulty is a second and a half of a candidate's life
    // and several times that on a phone. Issuing a block of digests and
    // awaiting them together pays that overhead once per block instead
    // of once per hash: ~5 microseconds each, four times faster, for
    // three lines. A sync SHA-256 of our own would be faster still and
    // is sixty lines of hand-rolled crypto nobody asked for.
    const digests = await Promise.all(
      Array.from({ length: POW_BATCH }, (_, offset) =>
        crypto.subtle.digest("SHA-256", encoder.encode(`${challenge}:${String(base + offset)}`)),
      ),
    );
    for (let offset = 0; offset < POW_BATCH; offset++) {
      if (hasLeadingZeroBits(new Uint8Array(digests[offset] as ArrayBuffer), bits)) {
        return String(base + offset);
      }
    }
  }
  throw new RunError(0, "bot_check_failed", BOT_CHECK_MESSAGE);
}

/** How many digests are in flight at once. Large enough to amortise the
 *  per-call overhead, small enough that the loop is still interruptible
 *  and allocates nothing memorable. */
const POW_BATCH = 256;

/** A search that has not finished by here is a misconfigured difficulty,
 *  not an unlucky candidate: at the shipped 16 bits the chance of
 *  reaching it is about one in e^256. The ceiling is what keeps a bad
 *  `bits` from hanging a tab instead of showing a sentence. */
const POW_CEILING = 1 << 24;

/**
 * Bits, not bytes and not hex characters — the same arithmetic as the
 * server's `meetsDifficulty`, which is the only opinion that counts.
 * Worth writing properly even though 16 happens to land on a byte: the
 * day someone raises the difficulty to 18 against an abusive deployment,
 * a byte-counting check would quietly keep charging for 16.
 */
function hasLeadingZeroBits(digest: Uint8Array, bits: number): boolean {
  let left = bits;
  let index = 0;
  while (left >= 8) {
    if (digest[index] !== 0) return false;
    index += 1;
    left -= 8;
  }
  return left === 0 || (digest[index] ?? 255) >> (8 - left) === 0;
}

/** The one sentence a candidate sees when the check could not run — an
 *  ancient browser, a disabled WebCrypto, a difficulty nobody can pay.
 *  `C-02`: it names the thing that helps. */
export const BOT_CHECK_MESSAGE =
  "Your browser could not complete the security check on this page. Reload the page and try again, or ask your organiser.";

/**
 * What to show while `register()` is running, and the reason the screen
 * must show something.
 *
 * Submitting used to be a single round trip. It is now a round trip, a
 * sub-second-to-a-few-seconds proof of work, and a second round trip —
 * long enough on a phone that a candidate with no feedback presses the
 * button again. The screen's obligation is to disable the control and
 * show this line for the duration; `register()` closes the hole from its
 * own side as well (see the de-duplication below), but a button that
 * looks dead for three seconds before a timed exam is its own defect.
 */
export const REGISTER_PENDING_MESSAGE = "Checking your browser…";

/** The error envelope every route answers with: `{ error: { code, message } }`. */
export class RunError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RunError";
    this.status = status;
    this.code = code;
  }
}

const bearer = (entryToken: string): Record<string, string> => ({
  authorization: `Bearer ${entryToken}`,
});

/** A 422 from `register`: the server's own copy of the rules, refused. */
export class RegistrationInvalid extends RunError {
  readonly issues: FieldIssue[];

  constructor(message: string, issues: FieldIssue[]) {
    super(422, "invalid_registration", message);
    this.name = "RegistrationInvalid";
    this.issues = issues;
  }
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  // Same origin, and the cookie goes with it. Before an attempt is
  // minted a candidate carries none; from `/start` onward they carry
  // exactly one, `pk_attempt`, scoped to `/api/v1/run` and `HttpOnly`,
  // so no script here can read it and every request under that prefix
  // carries it without a line of code — including the offline queue's
  // replay (Task 8). `same-origin` is already the default; it is named
  // because the attempt depends on it.
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { accept: "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; details?: { issues?: unknown } } }
      | null;
    const code = body?.error?.code ?? "request_failed";
    const message = body?.error?.message ?? "This test is not available.";
    // The one refusal that carries more than a sentence: a registration
    // the server re-checked and rejected names every field it rejected,
    // so the screen can put each one back beside its own input.
    const issues = body?.error?.details?.issues;
    if (code === "invalid_registration" && Array.isArray(issues)) {
      throw new RegistrationInvalid(message, issues as FieldIssue[]);
    }
    throw new RunError(res.status, code, message);
  }
  // 202 and 204 carry no body. Returning `null` rather than throwing on
  // the parse keeps "it worked and said nothing" distinct from "it
  // answered something unreadable".
  return (await res.json().catch(() => null)) as T | null;
}

async function get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
  return (await send<T>(path, { headers })) as T;
}

async function post<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T | null> {
  return send<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * `T-02`: the candidate URL is `/<workspace-slug>/<test-slug>`, so the two
 * slugs the page was opened at are the only identifier the client needs.
 * `encodeURIComponent` on both, because a slug arrives from the address bar.
 */
export function createRunClient(workspaceSlug: string, testSlug: string): RunClient {
  const base = `/api/v1/run/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(testSlug)}`;
  /** Registrations in flight, by entry token. At most one entry. */
  const registering = new Map<string, Promise<{ registrationToken: string }>>();

  /**
   * The proof of work is part of registering, not a separate step a
   * screen has to remember: the challenge is cut from this very entry
   * token, so the only caller that could ask for it is this one. A
   * browser that cannot run it says so in one sentence rather than
   * leaving a dead Continue button.
   */
  async function registerOnce(
    entryToken: string,
    values: Record<string, unknown>,
    captchaToken: string | undefined,
  ): Promise<{ registrationToken: string }> {
    const { challenge, bits } = await get<{ challenge: string; bits: number }>(
      `${base}/challenge`,
      bearer(entryToken),
    );
    let solution: string;
    try {
      solution = await solvePow(challenge, bits);
    } catch (error) {
      throw error instanceof RunError
        ? error
        : new RunError(0, "bot_check_failed", BOT_CHECK_MESSAGE);
    }
    return (
      (await post<{ registrationToken: string }>(
        `${base}/register`,
        { values, solution, ...(captchaToken === undefined ? {} : { captchaToken }) },
        bearer(entryToken),
      )) ?? { registrationToken: "" }
    );
  }

  return {
    landing: () => get<LandingPayload>(base),
    access: async (input) =>
      (await post<{ entryToken: string }>(`${base}/access`, input)) ?? { entryToken: "" },
    requestEmailCode: async (email) => {
      await post(`${base}/email-code`, { email });
    },
    form: (entryToken) =>
      send<RegistrationPayload>(`${base}/form`, { headers: bearer(entryToken) }) as Promise<
        RegistrationPayload
      >,
    register: (entryToken, values, captchaToken) => {
      // **One registration per entry token at a time.** A second press
      // during the solve used to be a second challenge, a second solve
      // and a second POST on the same single-use token: whichever batch
      // landed first consumed it, and the loser's answer was
      // 410 `entry_expired` — "this registration link is no longer
      // valid" — to a candidate who had just filled the form before a
      // timed exam. The window was tens of milliseconds before the proof
      // of work and is seconds after it, so the fix belongs here, at the
      // one place both presses pass through, rather than only in a
      // screen's disabled attribute (which the screen must still have —
      // `REGISTER_PENDING_MESSAGE`). The second caller joins the first's
      // promise and gets the same token.
      const already = registering.get(entryToken);
      if (already) return already;

      const attempt = registerOnce(entryToken, values, captchaToken);
      registering.set(entryToken, attempt);
      // Cleared on settle, not on success: a 422 is a form the candidate
      // can correct and resubmit against the same entry token.
      void attempt.catch(() => undefined).finally(() => registering.delete(entryToken));
      return attempt;
    },
    start: async (registrationToken) =>
      (await post<AttemptPaper>(`${base}/start`, undefined, bearer(registrationToken))) as AttemptPaper,
    resume: async () => {
      try {
        return await get<AttemptPaper>("/api/v1/run/attempt");
      } catch (error) {
        /* No attempt in this browser is the ordinary first visit, not a
         * failure: the screen shows the landing page rather than an
         * error. Narrowed to the one code the context answers with, so a
         * 401 that ever came to mean something else is still thrown. */
        if (error instanceof RunError && error.code === "attempt_required") return null;
        throw error;
      }
    },
    submit: async () =>
      (await post<{ receipt: Receipt; released: ReleasedResult | null }>(
        "/api/v1/run/attempt/submit",
        undefined,
      )) as { receipt: Receipt; released: ReleasedResult | null },
    requestResultCode: async (attemptRef, email) => {
      await post("/api/v1/run/result/code", { attemptRef, email });
    },
    // `post` answers `null` for a body that is literally `null` as well as
    // for one it could not read, and here they are the same thing: a test
    // that releases nothing to the candidate.
    verifyResultCode: async (attemptRef, email, code) =>
      (await post<ReleasedResult | null>("/api/v1/run/result/verify", {
        attemptRef,
        email,
        code,
      })) ?? null,
    putAnswer: async (save) => {
      try {
        const body = await send<{
          outcome: SaveOutcome;
          remainingMs: number;
          maxIndex: number;
          sectionRemainingMs: number | null;
        }>(ANSWER_PATH, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            questionId: save.questionId,
            value: save.value,
            clientSeq: save.clientSeq,
          }),
        });
        return {
          outcome: body?.outcome ?? "accepted",
          ...(body?.remainingMs === undefined ? {} : { remainingMs: body.remainingMs }),
          ...(body?.maxIndex === undefined ? {} : { maxIndex: body.maxIndex }),
          ...(body?.sectionRemainingMs === undefined
            ? {}
            : { sectionRemainingMs: body.sectionRemainingMs }),
        };
      } catch (error) {
        // Anything that is not a refusal the server *chose* — a dropped
        // connection, a 502 from the edge, a 500 — is a bad minute, not
        // a verdict on the answer. Rethrown so the queue keeps it and
        // backs off.
        if (!(error instanceof RunError) || error.status < 400 || error.status >= 500) throw error;
        if (error.status === 404) return { outcome: "dropped" };
        return { outcome: "refused", message: error.message };
      }
    },
  };
}

/** The slug pair the browser is currently at, or null when the path is not
 * a candidate URL. Exported so `exam-main.tsx` stays binding code. */
export function slugPairFromPath(pathname: string): { workspaceSlug: string; testSlug: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  const [workspaceSlug, testSlug] = parts;
  if (parts.length !== 2 || !workspaceSlug || !testSlug) return null;
  return { workspaceSlug, testSlug };
}
