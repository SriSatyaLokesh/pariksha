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

import type { AccessMode } from "@pariksha/core";

export type { AccessMode };

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

/** Widened by Tasks 2, 3, 5, 8 and 11. */
export interface RunClient {
  landing(): Promise<LandingPayload>;
  /** All four modes end here: a single-use entry token the registration
   *  step (Task 3) spends. */
  access(input: AccessRequest): Promise<{ entryToken: string }>;
  /** The `email_code` mode's first leg. Resolves on 202 and tells the
   *  caller nothing else — the code goes to an inbox. */
  requestEmailCode(email: string): Promise<void>;
}

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

async function send<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  // Same origin, no credentials to send: a candidate carries no cookie and
  // the attempt token (Task 5) is its own header, not an ambient one.
  const res = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new RunError(
      res.status,
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? "This test is not available.",
    );
  }
  // 202 and 204 carry no body. Returning `null` rather than throwing on
  // the parse keeps "it worked and said nothing" distinct from "it
  // answered something unreadable".
  return (await res.json().catch(() => null)) as T | null;
}

async function get<T>(path: string): Promise<T> {
  return (await send<T>(path)) as T;
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  return send<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
