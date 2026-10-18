// D1 and SQLite tables. Written by hand against TABLE_MANIFEST in
// `columns.ts`; `test/parity.test.ts` asserts this file, `pg.ts` and the
// manifest all agree. This module exports tables and nothing else — the
// parity test reads it with `Object.values`.

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    brandingJson: text("branding_json", { mode: "json" }),
    settingsJson: text("settings_json", { mode: "json" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("workspace_slug_uq").on(t.slug)],
);

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    authProvider: text("auth_provider").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("user_email_uq").on(t.email)],
);

export const membership = sqliteTable(
  "membership",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    testGrantsJson: text("test_grants_json", { mode: "json" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("membership_workspace_idx").on(t.workspaceId),
    index("membership_user_idx").on(t.userId),
    uniqueIndex("membership_workspace_user_uq").on(t.workspaceId, t.userId),
  ],
);

export const session = sqliteTable(
  "session",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const authToken = sqliteTable(
  "auth_token",
  {
    tokenHash: text("token_hash").primaryKey(),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (t) => [index("auth_token_expires_idx").on(t.expiresAt)],
);

export const questionBank = sqliteTable(
  "question_bank",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    license: text("license"),
    groupsJson: text("groups_json", { mode: "json" }),
    tagsJson: text("tags_json", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at"),
  },
  (t) => [index("question_bank_workspace_idx").on(t.workspaceId)],
);

export const question = sqliteTable(
  "question",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    bankId: text("bank_id").notNull(),
    refId: text("ref_id").notNull(),
    groupRef: text("group_ref"),
    type: text("type").notNull(),
    promptMd: text("prompt_md").notNull(),
    mediaJson: text("media_json", { mode: "json" }),
    optionsJson: text("options_json", { mode: "json" }),
    keyJson: text("key_json", { mode: "json" }),
    scoringJson: text("scoring_json", { mode: "json" }),
    points: real("points").notNull(),
    difficulty: text("difficulty"),
    tagsJson: text("tags_json", { mode: "json" }).notNull(),
    explanationMd: text("explanation_md"),
    extraJson: text("extra_json", { mode: "json" }),
    version: integer("version").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at"),
  },
  (t) => [
    index("question_workspace_idx").on(t.workspaceId),
    index("question_bank_idx").on(t.bankId),
    uniqueIndex("question_bank_ref_uq").on(t.bankId, t.refId),
  ],
);

export const test = sqliteTable(
  "test",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    currentVersion: integer("current_version"),
    tagsJson: text("tags_json", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("test_workspace_idx").on(t.workspaceId),
    index("test_status_idx").on(t.status),
    uniqueIndex("test_workspace_slug_uq").on(t.workspaceId, t.slug),
  ],
);

export const testVersion = sqliteTable(
  "test_version",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    testId: text("test_id").notNull(),
    version: integer("version").notNull(),
    settingsJson: text("settings_json", { mode: "json" }).notNull(),
    sectionsJson: text("sections_json", { mode: "json" }).notNull(),
    publishedAt: integer("published_at"),
  },
  (t) => [
    index("test_version_workspace_idx").on(t.workspaceId),
    index("test_version_test_idx").on(t.testId),
    uniqueIndex("test_version_test_version_uq").on(t.testId, t.version),
  ],
);

export const set = sqliteTable(
  "set",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    testVersionId: text("test_version_id").notNull(),
    setNo: integer("set_no").notNull(),
    questionIdsJson: text("question_ids_json", { mode: "json" }).notNull(),
  },
  (t) => [
    index("set_workspace_idx").on(t.workspaceId),
    index("set_test_version_idx").on(t.testVersionId),
    uniqueIndex("set_test_version_no_uq").on(t.testVersionId, t.setNo),
  ],
);

export const candidate = sqliteTable(
  "candidate",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    testId: text("test_id").notNull(),
    formValuesJson: text("form_values_json", { mode: "json" }).notNull(),
    consentVersion: text("consent_version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("candidate_workspace_idx").on(t.workspaceId),
    index("candidate_test_idx").on(t.testId),
  ],
);

export const attempt = sqliteTable(
  "attempt",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    testVersionId: text("test_version_id").notNull(),
    setNo: integer("set_no").notNull(),
    layoutJson: text("layout_json", { mode: "json" }).notNull(),
    startedAt: integer("started_at").notNull(),
    deadlineAt: integer("deadline_at").notNull(),
    submittedAt: integer("submitted_at"),
    submitReason: text("submit_reason"),
    scoreJson: text("score_json", { mode: "json" }),
    flag: text("flag").notNull(),
    tokenHash: text("token_hash").notNull(),
  },
  (t) => [
    index("attempt_workspace_idx").on(t.workspaceId),
    index("attempt_candidate_idx").on(t.candidateId),
    index("attempt_test_version_idx").on(t.testVersionId),
    uniqueIndex("attempt_token_hash_uq").on(t.tokenHash),
  ],
);

export const response = sqliteTable(
  "response",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    questionId: text("question_id").notNull(),
    valueJson: text("value_json", { mode: "json" }).notNull(),
    savedAt: integer("saved_at").notNull(),
    clientSeq: integer("client_seq").notNull(),
    points: real("points"),
    gradedBy: text("graded_by"),
  },
  (t) => [
    index("response_workspace_idx").on(t.workspaceId),
    index("response_attempt_idx").on(t.attemptId),
    uniqueIndex("response_attempt_question_uq").on(t.attemptId, t.questionId),
  ],
);

export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    type: text("type").notNull(),
    detailJson: text("detail_json", { mode: "json" }),
    clientTs: integer("client_ts").notNull(),
    serverTs: integer("server_ts").notNull(),
  },
  (t) => [
    index("event_workspace_idx").on(t.workspaceId),
    index("event_attempt_idx").on(t.attemptId),
  ],
);

export const snapshot = sqliteTable(
  "snapshot",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    storageKey: text("storage_key").notNull(),
    takenAt: integer("taken_at").notNull(),
    reason: text("reason").notNull(),
    faceCount: integer("face_count"),
  },
  (t) => [
    index("snapshot_workspace_idx").on(t.workspaceId),
    index("snapshot_attempt_idx").on(t.attemptId),
  ],
);

export const review = sqliteTable(
  "review",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    reviewer: text("reviewer").notNull(),
    verdict: text("verdict").notNull(),
    note: text("note"),
    at: integer("at").notNull(),
  },
  (t) => [
    index("review_workspace_idx").on(t.workspaceId),
    index("review_attempt_idx").on(t.attemptId),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    detailJson: text("detail_json", { mode: "json" }),
    at: integer("at").notNull(),
  },
  (t) => [
    index("audit_log_workspace_idx").on(t.workspaceId),
    index("audit_log_at_idx").on(t.at),
  ],
);

export const apiKey = sqliteTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(),
    scopesJson: text("scopes_json", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    index("api_key_workspace_idx").on(t.workspaceId),
    uniqueIndex("api_key_secret_hash_uq").on(t.secretHash),
  ],
);

export const webhook = sqliteTable(
  "webhook",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    url: text("url").notNull(),
    eventsJson: text("events_json", { mode: "json" }).notNull(),
    signingSecret: text("signing_secret").notNull(),
    active: integer("active", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("webhook_workspace_idx").on(t.workspaceId)],
);
