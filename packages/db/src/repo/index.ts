// Every repository function, and nothing else.
//
// The suite reads this module's exports and asserts that each one is
// registered through `scoped()` — so a function added here without the guard
// fails the build rather than shipping an unscoped read. Keep it to
// functions: a type or constant exported here would look like an unguarded
// repository function to that test.

export * from "./workspaces.js";
export * from "./tests.js";
export * from "./attempts.js";
export * from "./audit.js";
export * from "./banks.js";
export * from "./candidates.js";
// Phase 6 (#66): the candidate runtime's scoped reads and writes. Its
// `INVITE_KIND` string rides along — the rule above is about functions,
// and `scoping.test.ts` enumerates only those.
export * from "./run.js";
// Phase 8a Task 7 (K9, KG3): the organiser's first attempt read.
export * from "./results.js";
// Phase 8b Task 1 (K14): manual grading's writes and the grading queue's
// one read.
export * from "./grading.js";
// Phase 8b Task 3 (K16): the reviewer's verdict, append-only.
export * from "./review.js";
// Phase 8b Task 4 (K17/K18): regrade's own, version-scoped attempt reads
// and batched write. `regrade-scan.ts` sits beside this list, not in it —
// see its own header for why.
export * from "./regrade.js";
// Phase 8d Task 1: webhook CRUD, and Task 3's own delivery read.
export * from "./webhooks.js";
// Phase 8c Task 1 (`K19`, #94): test analytics, one fetch over
// `listAttemptsForTest` plus one `COUNT`.
export * from "./analytics.js";
// Phase 9 Task 4: ephemeral demo workspace provisioning and showcase seeding.
export * from "./demo.js";
// Phase 8d Task 2 (K25, K26): scoped API keys. `resolveApiKey` is
// deliberately NOT re-exported here — see `repo/keys.ts`'s own header and
// `src/index.ts`'s — it takes no workspace ID, so `scoped()` cannot wrap
// it and this barrel's own "every export is scoped" guard
// (`test/repo/scoping.test.ts`) would fail the moment it appeared here.
export { createApiKey, listApiKeys, revokeApiKey, KEY_FORBIDDEN_ACTIONS, type ApiKeyRow } from "./keys.js";
