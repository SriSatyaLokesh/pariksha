// Postgres tables. Written by hand against TABLE_MANIFEST in `columns.ts`,
// column for column with `sqlite.ts`; `test/parity.test.ts` asserts all three
// agree. This module exports tables and nothing else — the parity test reads
// it with `Object.values`.
//
// Three types differ from SQLite by design: JSON columns are `jsonb` rather
// than `text`, timestamps are `bigint` because a millisecond epoch overflowed
// `integer` in 1970, and points are `numeric` because SQLite has no exact
// decimal and `real` is the nearest it offers.

import {
  pgTable,
  text,
  integer,
  bigint,
  numeric,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const workspace = pgTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    brandingJson: jsonb("branding_json"),
    settingsJson: jsonb("settings_json"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("workspace_slug_uq").on(t.slug)],
);

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    authProvider: text("auth_provider").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("user_email_uq").on(t.email)],
);

export const membership = pgTable(
  "membership",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    testGrantsJson: jsonb("test_grants_json"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("membership_workspace_idx").on(t.workspaceId),
    index("membership_user_idx").on(t.userId),
    uniqueIndex("membership_workspace_user_uq").on(t.workspaceId, t.userId),
  ],
);

export const session = pgTable(
  "session",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    lastUsedAt: bigint("last_used_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const authToken = pgTable(
  "auth_token",
  {
    tokenHash: text("token_hash").primaryKey(),
    kind: text("kind").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    usedAt: bigint("used_at", { mode: "number" }),
  },
  (t) => [index("auth_token_expires_idx").on(t.expiresAt)],
);

export const questionBank = pgTable(
  "question_bank",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    license: text("license"),
    groupsJson: jsonb("groups_json"),
    tagsJson: jsonb("tags_json").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }),
  },
  (t) => [index("question_bank_workspace_idx").on(t.workspaceId)],
);

export const question = pgTable(
  "question",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    bankId: text("bank_id").notNull(),
    refId: text("ref_id").notNull(),
    groupRef: text("group_ref"),
    type: text("type").notNull(),
    promptMd: text("prompt_md").notNull(),
    mediaJson: jsonb("media_json"),
    optionsJson: jsonb("options_json"),
    keyJson: jsonb("key_json"),
    scoringJson: jsonb("scoring_json"),
    points: numeric("points", { mode: "number" }).notNull(),
    difficulty: text("difficulty"),
    tagsJson: jsonb("tags_json").notNull(),
    explanationMd: text("explanation_md"),
    extraJson: jsonb("extra_json"),
    version: integer("version").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }),
  },
  (t) => [
    index("question_workspace_idx").on(t.workspaceId),
    index("question_bank_idx").on(t.bankId),
    uniqueIndex("question_bank_ref_uq").on(t.bankId, t.refId),
  ],
);

export const test = pgTable(
  "test",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    shortCode: text("short_code").notNull(),
    status: text("status").notNull(),
    reviewRequested: boolean("review_requested").notNull(),
    currentVersion: integer("current_version"),
    tagsJson: jsonb("tags_json").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }),
  },
  (t) => [
    index("test_workspace_idx").on(t.workspaceId),
    index("test_status_idx").on(t.status),
    uniqueIndex("test_workspace_slug_uq").on(t.workspaceId, t.slug),
    uniqueIndex("test_short_code_uq").on(t.shortCode),
  ],
);

export const testVersion = pgTable(
  "test_version",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    testId: text("test_id").notNull(),
    version: integer("version").notNull(),
    settingsJson: jsonb("settings_json").notNull(),
    sectionsJson: jsonb("sections_json").notNull(),
    publishedAt: bigint("published_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("test_version_workspace_idx").on(t.workspaceId),
    index("test_version_test_idx").on(t.testId),
    uniqueIndex("test_version_test_version_uq").on(t.testId, t.version),
  ],
);

export const set = pgTable(
  "set",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    testVersionId: text("test_version_id").notNull(),
    setNo: integer("set_no").notNull(),
    questionIdsJson: jsonb("question_ids_json").notNull(),
  },
  (t) => [
    index("set_workspace_idx").on(t.workspaceId),
    index("set_test_version_idx").on(t.testVersionId),
    uniqueIndex("set_test_version_no_uq").on(t.testVersionId, t.setNo),
  ],
);

export const candidate = pgTable(
  "candidate",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    testId: text("test_id").notNull(),
    externalId: text("external_id"),
    setLabel: text("set_label"),
    source: text("source").notNull(),
    formValuesJson: jsonb("form_values_json").notNull(),
    consentVersion: text("consent_version"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("candidate_workspace_idx").on(t.workspaceId),
    index("candidate_test_idx").on(t.testId),
    uniqueIndex("candidate_test_external_uq").on(t.testId, t.externalId),
  ],
);

export const attempt = pgTable(
  "attempt",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    testVersionId: text("test_version_id").notNull(),
    setNo: integer("set_no").notNull(),
    layoutJson: jsonb("layout_json").notNull(),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    deadlineAt: bigint("deadline_at", { mode: "number" }).notNull(),
    submittedAt: bigint("submitted_at", { mode: "number" }),
    submitReason: text("submit_reason"),
    scoreJson: jsonb("score_json"),
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

export const response = pgTable(
  "response",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    questionId: text("question_id").notNull(),
    valueJson: jsonb("value_json").notNull(),
    savedAt: bigint("saved_at", { mode: "number" }).notNull(),
    clientSeq: integer("client_seq").notNull(),
    points: numeric("points", { mode: "number" }),
    gradedBy: text("graded_by"),
  },
  (t) => [
    index("response_workspace_idx").on(t.workspaceId),
    index("response_attempt_idx").on(t.attemptId),
    uniqueIndex("response_attempt_question_uq").on(t.attemptId, t.questionId),
  ],
);

export const event = pgTable(
  "event",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    type: text("type").notNull(),
    detailJson: jsonb("detail_json"),
    clientTs: bigint("client_ts", { mode: "number" }).notNull(),
    serverTs: bigint("server_ts", { mode: "number" }).notNull(),
  },
  (t) => [
    index("event_workspace_idx").on(t.workspaceId),
    index("event_attempt_idx").on(t.attemptId),
  ],
);

export const snapshot = pgTable(
  "snapshot",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    storageKey: text("storage_key").notNull(),
    takenAt: bigint("taken_at", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    faceCount: integer("face_count"),
  },
  (t) => [
    index("snapshot_workspace_idx").on(t.workspaceId),
    index("snapshot_attempt_idx").on(t.attemptId),
  ],
);

export const review = pgTable(
  "review",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    reviewer: text("reviewer").notNull(),
    verdict: text("verdict").notNull(),
    note: text("note"),
    at: bigint("at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("review_workspace_idx").on(t.workspaceId),
    index("review_attempt_idx").on(t.attemptId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    detailJson: jsonb("detail_json"),
    at: bigint("at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("audit_log_workspace_idx").on(t.workspaceId),
    index("audit_log_at_idx").on(t.at),
  ],
);

export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(),
    scopesJson: jsonb("scopes_json").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    lastUsedAt: bigint("last_used_at", { mode: "number" }),
    revokedAt: bigint("revoked_at", { mode: "number" }),
  },
  (t) => [
    index("api_key_workspace_idx").on(t.workspaceId),
    uniqueIndex("api_key_secret_hash_uq").on(t.secretHash),
  ],
);

export const webhook = pgTable(
  "webhook",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    url: text("url").notNull(),
    eventsJson: jsonb("events_json").notNull(),
    signingSecret: text("signing_secret").notNull(),
    active: boolean("active").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("webhook_workspace_idx").on(t.workspaceId)],
);
