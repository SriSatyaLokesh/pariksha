// The organiser app's one door to the API.
//
// Phase 3 Task 9. Every endpoint below is specified by
// docs/superpowers/plans/2026-10-16-phase-3-auth-roles-and-landing.md and is
// being built in parallel (issues #26-#30); nothing here may run against a
// deployed Worker to be believed, which is why `ApiClient` is an interface
// the screens take as a prop and the tests satisfy with a typed object
// literal.

// The matrix these roles index lives in @pariksha/core (#25); the type is
// re-exported here so the screens have one import for the whole API surface.
import type { Difficulty, Question, QuestionType, Role } from "@pariksha/core";
export type { Role };

// Phase 4 Task 2: banks and questions. Mirrors
// `packages/db/src/repo/banks.ts`'s `BankRow`/`QuestionRow` — this is the
// JSON those rows serialise to, not a separate shape of its own.
export interface Bank {
  id: string;
  name: string;
  description: string | null;
  license: string | null;
  tags: string[];
  questionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface QuestionSummary {
  id: string;
  bankId: string;
  refId: string;
  document: Question;
  points: number;
  usedInTests: number;
  updatedAt: number;
}

export interface QuestionListFilter {
  type?: QuestionType;
  tag?: string;
  difficulty?: Difficulty;
  unused?: boolean;
  search?: string;
  cursor?: string;
}

/** `apps/api/src/auth/identity.ts`, per the Phase 3 plan's Task 3. */
export interface IdentityProvider {
  id: string;
  kind: "oidc" | "magic_link" | "password";
  label: string;
}

export interface SetupStatus {
  needed: boolean;
  providers: IdentityProvider[];
}

export interface Membership {
  workspaceId: string;
  role: Role;
  grants: { testId: string; role: Role }[];
}

/** The Phase 3 Task 2 `Actor`: who is signed in and what they may reach. */
export interface Actor {
  userId: string;
  email: string;
  memberships: Membership[];
}

// The plan never states a workspace's wire shape. Two fields are what the
// dashboard reads; widen it when a route needs more.
export interface Workspace {
  id: string;
  name: string;
}

/**
 * Every failure response is `{ error: { code, message, details? } }`. This
 * carries all three so a screen can render `message` — the human half —
 * and never a bare status code.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiClient {
  setupStatus(): Promise<SetupStatus>;
  /** The signed-in actor, or null when the API answers 401. */
  me(): Promise<Actor | null>;
  workspaces(): Promise<Workspace[]>;
  completeSetup(input: { workspaceName: string }): Promise<Workspace>;
  requestMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  listBanks(workspaceId: string): Promise<Bank[]>;
  createBank(workspaceId: string, input: { name: string }): Promise<Bank>;
  getBank(workspaceId: string, bankId: string): Promise<Bank>;
  updateBank(
    workspaceId: string,
    bankId: string,
    patch: { name?: string; description?: string; license?: string; tags?: string[] },
  ): Promise<Bank>;
  deleteBank(workspaceId: string, bankId: string): Promise<void>;
  listQuestions(
    workspaceId: string,
    bankId: string,
    filter?: QuestionListFilter,
  ): Promise<{ questions: QuestionSummary[]; cursor?: string }>;
  deleteQuestion(workspaceId: string, bankId: string, questionId: string): Promise<void>;
  /** Tags already used anywhere in the workspace (UX-03's autocomplete). */
  listTags(workspaceId: string): Promise<string[]>;
}

const API = "/api/v1";

/**
 * Review Focus item 2 of the Phase 3 plan: `?returnTo=https://evil.example`
 * is an open redirect. A return target is a same-origin *path* and nothing
 * else — so it must start with a single `/`, and carry no backslash (which
 * browsers normalise to `/`, smuggling `//evil.example` past a naive check)
 * and no whitespace (which can hide a scheme).
 *
 * `apps/api/src/auth/oidc.ts` validates the same thing server-side. Both
 * halves check it: this one decides where the browser is sent, that one
 * decides what the callback honours.
 */
const SAFE_RETURN_TO = /^\/(?![/\\])[^\s\\]*$/;

export function safeReturnTo(raw: string | null | undefined): string {
  return raw !== null && raw !== undefined && SAFE_RETURN_TO.test(raw)
    ? raw
    : "/";
}

/** Where the browser goes to start a sign-in. A navigation, not a fetch. */
export function signInUrl(
  providerId: string,
  returnTo: string | null | undefined,
): string {
  const params = new URLSearchParams({ returnTo: safeReturnTo(returnTo) });
  return `${API}/auth/${encodeURIComponent(providerId)}/start?${params}`;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  // Sessions are an HttpOnly cookie (Phase 3 Task 2), so every call is
  // credentialed. Same-origin only — the CSP is `connect-src 'self'`.
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    ...init,
  });
  if (response.ok) return response;

  const body: unknown = await response.json().catch(() => null);
  if (isErrorEnvelope(body)) {
    throw new ApiError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.details,
    );
  }
  // A failure that is not the envelope is a bug or a proxy in the way; say
  // something a person can act on rather than echoing the status.
  throw new ApiError(
    response.status,
    "unexpected_response",
    "Pariksha could not be reached. Check the server is running, then try again.",
  );
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

function withBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  };
}

const post = (body: unknown): RequestInit => withBody("POST", body);
const patchBody = (body: unknown): RequestInit => withBody("PATCH", body);

function query(params: Record<string, string | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function createApiClient(): ApiClient {
  return {
    setupStatus: () => json<SetupStatus>("/setup/status"),

    // The two routes below answer envelopes the screens do not use. This
    // file was written against a sketch of the API months before the
    // routes shipped, and the end-to-end flow is what caught the drift:
    // `/me` nests the account under `user`, and `/workspaces` returns a
    // named list rather than a bare array. The decoding belongs here — the
    // screens and their tests speak `Actor` and `Workspace`.
    async me() {
      try {
        const body = await json<{
          user: { id: string; email: string };
          memberships: Membership[];
        }>("/me");
        return {
          userId: body.user.id,
          email: body.user.email,
          memberships: body.memberships,
        };
      } catch (error) {
        // 401 is the ordinary answer for "nobody is signed in", not a
        // failure worth showing anyone.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },

    workspaces: async () =>
      (await json<{ workspaces: Workspace[] }>("/workspaces")).workspaces,

    completeSetup: (input) =>
      json<Workspace>("/setup/complete", post({ name: input.workspaceName })),

    async requestMagicLink(email) {
      await request("/auth/magic-link", post({ email }));
    },

    async signOut() {
      await request("/auth/signout", post({}));
    },

    listBanks: async (workspaceId) =>
      (await json<{ banks: Bank[] }>(`/workspaces/${workspaceId}/banks`)).banks,

    createBank: (workspaceId, input) =>
      json<Bank>(`/workspaces/${workspaceId}/banks`, post(input)),

    getBank: (workspaceId, bankId) => json<Bank>(`/workspaces/${workspaceId}/banks/${bankId}`),

    updateBank: (workspaceId, bankId, patch) =>
      json<Bank>(`/workspaces/${workspaceId}/banks/${bankId}`, patchBody(patch)),

    async deleteBank(workspaceId, bankId) {
      await request(`/workspaces/${workspaceId}/banks/${bankId}`, { method: "DELETE" });
    },

    async listQuestions(workspaceId, bankId, filter = {}) {
      const qs = query({
        type: filter.type,
        tag: filter.tag,
        difficulty: filter.difficulty,
        unused: filter.unused,
        search: filter.search,
        cursor: filter.cursor,
      });
      return json<{ questions: QuestionSummary[]; cursor?: string }>(
        `/workspaces/${workspaceId}/banks/${bankId}/questions${qs}`,
      );
    },

    async deleteQuestion(workspaceId, bankId, questionId) {
      await request(`/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}`, {
        method: "DELETE",
      });
    },

    listTags: async (workspaceId) => (await json<{ tags: string[] }>(`/workspaces/${workspaceId}/tags`)).tags,
  };
}
