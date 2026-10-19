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

/** Widened by Tasks 2, 3, 5, 8 and 11. */
export interface RunClient {
  landing(): Promise<LandingPayload>;
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

async function get<T>(path: string): Promise<T> {
  // Same origin, no credentials to send: a candidate carries no cookie and
  // the attempt token (Task 5) is its own header, not an ambient one.
  const res = await fetch(path, { headers: { accept: "application/json" } });
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
  return (await res.json()) as T;
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
