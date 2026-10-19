// The public surface of @pariksha/db.

export * from "./ids.js";
export * from "./schema/index.js";
export * from "./client.js";
export * from "./migrate.js";
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
