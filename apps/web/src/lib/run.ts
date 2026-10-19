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

export type { AccessMode, FieldIssue, RegistrationFormSpec, TestConsent };

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
}

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
  // Same origin, no credentials to send: a candidate carries no cookie and
  // the attempt token (Task 5) is its own header, not an ambient one.
  const res = await fetch(path, {
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
    register: async (entryToken, values, captchaToken) => {
      // The proof of work is part of registering, not a separate step a
      // screen has to remember: the challenge is cut from this very
      // entry token, so the only caller that could ask for it is this
      // one. A browser that cannot run it says so in one sentence rather
      // than leaving a dead Continue button.
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
