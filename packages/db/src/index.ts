// The public surface of @pariksha/db.

export * from "./ids.js";
export * from "./schema/index.js";
export * from "./client.js";
export * from "./migrate.js";
// The generated bundle `migrate()` itself reads. Exported so a test can run
// one migration's own statements against a real engine instead of retyping
// its SQL: a retyped copy keeps passing while the migration it claims to
// cover drifts away from it.
export * from "./migrations.generated.js";
export * from "./repo/index.js";
// Deliberately outside repo/index.js — see the header of identity.ts.
export * from "./repo/identity.js";
// Deliberately outside repo/index.js too — see the header of
// question-document.ts. A pure document<->row mapping, not a workspace-scoped
// repository function.
export * from "./repo/question-document.js";
// Deliberately outside repo/index.js too, for the same reason — see the
// header of test-document.ts.
export * from "./repo/test-document.js";
// Deliberately outside repo/index.js too — see the header of shortlink.ts.
// `/t/<code>` names no workspace, so there is nothing for `scoped()` to check.
export * from "./repo/shortlink.js";
// Deliberately outside repo/index.js too — see the header of
// candidate-entry.ts. The candidate's pre-workspace read: the workspace ID
// is what it produces, not an argument it can take (ADR 0006).
export * from "./repo/candidate-entry.js";
// Deliberately outside repo/index.js too — see the header of rate-limit.ts.
// A `/t/:code` miss bucket has no workspace, so there is nothing for
// `scoped()` to check (Phase 6 Task 3, #67).
export * from "./repo/rate-limit.js";
// Phase 8d Task 1: `urlRefusal`, T-19's SSRF refusal table, moved here so
// `repo/webhooks.ts` and `apps/api/src/net/reachable.ts` share one copy —
// see net.ts's own header.
export * from "./net.js";
// Phase 8d Task 2 (K25, K26): deliberately outside repo/index.js too — see
// the header of keys.ts. `resolveApiKey` takes no workspace ID: which
// workspace a presented secret belongs to is what it produces, not an
// argument it can take, the same reason candidate-entry.ts sits outside
// that barrel.
export { resolveApiKey } from "./repo/keys.js";
// Same reason, different shape: `ApiKeyNotFoundError` is a class, which
// `typeof` reports as `"function"` — exporting it through `repo/index.js`
// would make `scoping.test.ts`'s "every exported repository function is
// scoped" enumeration pick it up and fail, since it is an error type, not a
// repository function `scoped()` could wrap.
export { ApiKeyNotFoundError } from "./repo/keys.js";
