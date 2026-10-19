// The table manifest: one description of every table, as plain data.
//
// Both dialect modules are written by hand against this — Drizzle's types come
// from literal table definitions, so generating them from this manifest would
// trade away every typed query in the repository layer. `parity.test.ts`
// asserts the three agree, which is what keeps "SQLite and Postgres drift"
// from becoming a bug a Postgres user reports months later.

/**
 * The storage classes a column can have. Each maps to one SQLite type and one
 * Postgres type, and the two are allowed to differ only here:
 *
 * | class       | SQLite    | Postgres  | why                                  |
 * | ----------- | --------- | --------- | ------------------------------------ |
 * | `text`      | `text`    | `text`    |                                      |
 * | `json`      | `text`    | `jsonb`   | SQLite has no JSON type              |
 * | `int`       | `integer` | `integer` |                                      |
 * | `bool`      | `integer` | `boolean` | SQLite has no boolean type           |
 * | `timestamp` | `integer` | `bigint`  | epoch milliseconds overflow int4     |
 * | `decimal`   | `real`    | `numeric` | scores are fractional; keep them exact |
 *
 * `decimal` is Postgres `numeric` rather than `double precision` because the
 * values are scores: packages/core rounds every one to 2dp precisely so no
 * `26.800000000000004` reaches a results CSV, and `numeric` stores that
 * decimal rather than the nearest binary approximation of it. SQLite offers
 * no exact decimal, so `real` is the closest it has — which is also why a
 * fractional value has to be asserted through a real round trip and not
 * inferred from SQLite going green (see `test/migrate.test.ts`).
 */
export type ColumnClass =
  | "text"
  | "json"
  | "int"
  | "bool"
  | "timestamp"
  | "decimal";

export interface ColumnSpec {
  name: string;
  class: ColumnClass;
  notNull: boolean;
  primaryKey: boolean;
}

export interface TableSpec {
  name: string;
  /** Holds tenant data, so it carries an indexed `workspace_id`. */
  tenant: boolean;
  columns: ColumnSpec[];
  indexes: string[][];
  uniques: string[][];
}

const column =
  (klass: ColumnClass) =>
  (
    name: string,
    opts: { null?: boolean; pk?: boolean } = {},
  ): ColumnSpec => ({
    name,
    class: klass,
    notNull: !(opts.null ?? false),
    primaryKey: opts.pk ?? false,
  });

const text = column("text");
const json = column("json");
const int = column("int");
const bool = column("bool");
const ts = column("timestamp");
const decimal = column("decimal");

/** Every tenant table opens with these two, in this order. */
const tenantHead = (idName = "id"): ColumnSpec[] => [
  text(idName, { pk: true }),
  text("workspace_id"),
];

export const TIMESTAMP_CLASS: ColumnClass = "timestamp";

export const TABLE_MANIFEST: TableSpec[] = [
  {
    name: "workspace",
    tenant: false,
    columns: [
      text("id", { pk: true }),
      text("slug"),
      text("name"),
      json("branding_json", { null: true }),
      json("settings_json", { null: true }),
      ts("created_at"),
    ],
    indexes: [],
    uniques: [["slug"]],
  },
  {
    name: "user",
    tenant: false,
    columns: [
      text("id", { pk: true }),
      text("email"),
      text("auth_provider"),
      ts("created_at"),
    ],
    indexes: [],
    uniques: [["email"]],
  },
  {
    name: "membership",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("user_id"),
      text("role"),
      json("test_grants_json", { null: true }),
      ts("created_at"),
    ],
    indexes: [["workspace_id"], ["user_id"]],
    uniques: [["workspace_id", "user_id"]],
  },
  {
    name: "session",
    tenant: false,
    columns: [
      // Only the hash is stored (S-03), so a database dump yields no live
      // session. The hash is the primary key: a lookup is the only read.
      text("token_hash", { pk: true }),
      text("user_id"),
      ts("created_at"),
      ts("last_used_at"),
      ts("expires_at"),
    ],
    indexes: [["user_id"]],
    uniques: [],
  },
  {
    // Every short-lived single-use secret the server mints before a session
    // exists: an OIDC `state` with its PKCE verifier, and a magic-link token.
    // One table rather than two because the interesting code is the consume
    // — a single `UPDATE … WHERE used_at IS NULL … RETURNING` that makes a
    // concurrent replay find nothing — and two tables would mean two copies
    // of it. `kind` is in that WHERE clause, so a magic-link token cannot be
    // redeemed as an OIDC state; everything that differs between the two is
    // payload, which is what a JSON column is for.
    name: "auth_token",
    tenant: false,
    columns: [
      // Only the hash, for the same reason `session` stores only one: a
      // database dump must not yield a redeemable link or a hijackable flow.
      text("token_hash", { pk: true }),
      text("kind"),
      json("payload_json"),
      ts("created_at"),
      ts("expires_at"),
      // Set rather than deleted, so a replay is distinguishable from a token
      // that never existed when someone has to explain a support ticket.
      ts("used_at", { null: true }),
    ],
    indexes: [["expires_at"]],
    uniques: [],
  },
  {
    name: "question_bank",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("name"),
      text("description", { null: true }),
      text("license", { null: true }),
      // Passage groups live here rather than in a table of their own: a bank
      // holds a handful, they are always read whole with the bank, and a
      // table would be three CRUD surfaces for a list nobody queries into.
      json("groups_json", { null: true }),
      json("tags_json"),
      ts("created_at"),
      // Null until the first edit, so "last edited" can say "never" rather
      // than repeating the creation time as though someone had touched it.
      ts("updated_at", { null: true }),
    ],
    indexes: [["workspace_id"]],
    uniques: [],
  },
  {
    name: "question",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("bank_id"),
      // The `id` the question carries *inside the bank file*
      // (`^[A-Za-z0-9_.-]{1,64}$`). The row's own `id` is a `qst_…` this
      // installation minted, which is not what an export has to hand back.
      text("ref_id"),
      text("group_ref", { null: true }),
      text("type"),
      text("prompt_md"),
      json("media_json", { null: true }),
      json("options_json", { null: true }),
      json("key_json", { null: true }),
      json("scoring_json", { null: true }),
      decimal("points"),
      text("difficulty", { null: true }),
      json("tags_json"),
      text("explanation_md", { null: true }),
      // Every type-specific field with no column of its own: `k`, `left`,
      // `right`, `items`, `blanks`, `unit`, `assertion`, `reason`,
      // `max_length`, `model_answer`, `rubric`, `shuffle_options`. Eleven
      // columns that are null for most types, or one that is replaced whole
      // when the type changes.
      json("extra_json", { null: true }),
      int("version"),
      ts("created_at"),
      ts("updated_at", { null: true }),
    ],
    indexes: [["workspace_id"], ["bank_id"]],
    uniques: [["bank_id", "ref_id"]],
  },
  {
    name: "test",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("slug"),
      text("name"),
      // Phase 5 Task 2 (#54): identity fields a `pariksha/test@1` document
      // round-trips. `short_code` is six characters from `ids.ts`'s Crockford
      // alphabet, unique **bare** — not composite with `workspace_id`, unlike
      // every other tenant-table unique in this manifest — because `/t/<code>`
      // (the public short link) names no workspace at all (Review Focus 5).
      text("description", { null: true }),
      text("short_code"),
      text("status"),
      // UX-10's "In review" badge — the only half of review Phase 5 ships
      // (ADR 0007).
      bool("review_requested"),
      int("current_version", { null: true }),
      json("tags_json"),
      ts("created_at"),
      // Null until the first edit, matching question_bank.updated_at.
      ts("updated_at", { null: true }),
    ],
    indexes: [["workspace_id"], ["status"]],
    uniques: [["workspace_id", "slug"], ["short_code"]],
  },
  {
    name: "test_version",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("test_id"),
      int("version"),
      json("settings_json"),
      json("sections_json"),
      ts("published_at", { null: true }),
      // Phase 5 Task 2: a draft version has no published_at, so without this
      // there is nothing to order versions by.
      ts("created_at"),
    ],
    indexes: [["workspace_id"], ["test_id"]],
    uniques: [["test_id", "version"]],
  },
  {
    name: "set",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("test_version_id"),
      int("set_no"),
      json("question_ids_json"),
    ],
    indexes: [["workspace_id"], ["test_version_id"]],
    uniques: [["test_version_id", "set_no"]],
  },
  // Task 9 (#60 / #56, P5.7b): the candidate list. `external_id` is the
  // value of the test's first `unique: true` registration field, which is
  // what Phase 6 mints an invite against and matches a registration to;
  // `set_label` is T-09's set *name* ("A"), never `attempt.set_no`, which
  // is an integer.
  //
  // **`source` is the provenance of the row, not whether anyone has
  // registered** (Phase 6 Task 3, #67). It was both until Phase 6: a
  // registration now *fills the matched `"list"` row in place* — the
  // `(test_id, external_id)` unique below makes a second row impossible,
  // and `set_label` has to survive registration or `assignSet` loses the
  // `listValue` it draws a candidate's set from. A `"registration"` row is
  // written only when nothing on the list matched.
  //
  // **Registered is therefore `consent_at IS NOT NULL`**, and that is the
  // whole reason that column exists. `consent_version` cannot carry it: it
  // is nullable (a listed candidate has not consented yet), but a list row
  // could in principle be uploaded with one, while `consent_at` has
  // exactly one writer. The three populations an organiser asks about:
  //
  //   listed, never registered   source = 'list'         AND consent_at IS NULL
  //   listed, registered         source = 'list'         AND consent_at IS NOT NULL
  //   self-registered, unlisted  source = 'registration'
  //
  // **No token column, deliberately.** `POST /tests/{id}/invites`, the
  // single-use signed token, its hash and its expiry are Phase 6's — the
  // token's hashing and lifetime belong to the runtime that consumes
  // them (`S-06` is written about attempt tokens, not list rows).
  {
    name: "candidate",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("test_id"),
      text("external_id", { null: true }),
      text("set_label", { null: true }),
      text("source"),
      json("form_values_json"),
      text("consent_version", { null: true }),
      // `S-12`: the version *and* the moment, so a later edit to the
      // consent text stays distinguishable from a candidate who accepted
      // the earlier one. `created_at` cannot stand in — on a list row it
      // is the upload's time, not the candidate's.
      ts("consent_at", { null: true }),
      ts("created_at"),
    ],
    indexes: [["workspace_id"], ["test_id"]],
    uniques: [["test_id", "external_id"]],
  },
  // `T-17`'s "a second registration with the same value is refused", as a
  // table (Phase 6 Task 3, #67).
  //
  // `candidate.form_values_json` is a JSON column and neither dialect
  // offers a portable unique index into one, so the claim is its own row.
  // The value is a **SHA-256 of the normalised value**
  // (`normaliseUniqueValue`, @pariksha/core) rather than the value itself,
  // so the table that stops a repeated email does not become a second
  // plaintext copy of every candidate's email beside the encryptable one
  // (`S-15`).
  //
  // Every claim is written in the same `db.batch` as the candidate, so a
  // duplicate rolls the whole registration back — `AC-12`'s refusal with
  // no half-written candidate behind it.
  {
    name: "candidate_unique",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("test_id"),
      text("candidate_id"),
      // The registration field's own id, so a 409 can name the field.
      text("field_id"),
      text("value_hash"),
      ts("created_at"),
    ],
    indexes: [["workspace_id"], ["test_id"], ["candidate_id"]],
    uniques: [["test_id", "field_id", "value_hash"]],
  },
  // `S-07`'s volume defence (Phase 6 Task 3, #67): one fixed window per
  // bucket, counted in one statement.
  //
  // **`tenant: false`, like `auth_token` and for the same reason.** The
  // `/t/:code` miss bucket is a six-character code and no workspace, and a
  // sentinel workspace id would be a lie in the one column `S-09` audits.
  // Every bucket string embeds a globally unique id (a `ver_`, a digest),
  // so the primary key above is the whole key.
  //
  // **Count misses, never successes.** 500 candidates opening the one link
  // they were given in the same minute is the expected load, not an
  // attack: a bucket that counted them would lock out 489 people on the
  // first live test. `LIMITS` (apps/api/src/run/limit.ts) sizes each.
  {
    name: "rate_limit",
    tenant: false,
    columns: [
      text("bucket", { pk: true }),
      ts("window_start"),
      int("count"),
    ],
    indexes: [["window_start"]],
    uniques: [],
  },
  {
    name: "attempt",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("candidate_id"),
      text("test_version_id"),
      int("set_no"),
      json("layout_json"),
      ts("started_at"),
      ts("deadline_at"),
      ts("submitted_at", { null: true }),
      text("submit_reason", { null: true }),
      json("score_json", { null: true }),
      text("flag"),
      text("token_hash"),
      // Phase 6 Task 5 (#69, P6.5). Two columns, and only two.
      //
      // `max_index` is the furthest flat question index this candidate has
      // reached, counted across sections in the pinned order. It carries
      // **both** navigation rules, which is why `per_section` needs no
      // second column: `linear` refuses a target below it, and the current
      // section is the one that index falls in. `NOT NULL DEFAULT 0`, which
      // is the one shape SQLite's `ALTER TABLE … ADD COLUMN` accepts for a
      // NOT NULL column.
      //
      // `section_started_at` is what a per-section deadline is measured
      // from, and is null until the candidate enters a timed section.
      int("max_index"),
      ts("section_started_at", { null: true }),
    ],
    indexes: [["workspace_id"], ["candidate_id"], ["test_version_id"]],
    uniques: [["token_hash"]],
  },
  {
    name: "response",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("attempt_id"),
      text("question_id"),
      json("value_json"),
      ts("saved_at"),
      int("client_seq"),
      decimal("points", { null: true }),
      text("graded_by", { null: true }),
    ],
    indexes: [["workspace_id"], ["attempt_id"]],
    // The upsert target: one row per question per attempt, which is what makes
    // `INSERT … ON CONFLICT DO UPDATE WHERE excluded.client_seq > client_seq`
    // a single statement rather than a read-then-write race.
    uniques: [["attempt_id", "question_id"]],
  },
  {
    name: "event",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("attempt_id"),
      text("type"),
      json("detail_json", { null: true }),
      ts("client_ts"),
      ts("server_ts"),
    ],
    indexes: [["workspace_id"], ["attempt_id"]],
    uniques: [],
  },
  {
    name: "snapshot",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("attempt_id"),
      text("storage_key"),
      ts("taken_at"),
      text("reason"),
      int("face_count", { null: true }),
    ],
    indexes: [["workspace_id"], ["attempt_id"]],
    uniques: [],
  },
  {
    name: "review",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("attempt_id"),
      text("reviewer"),
      text("verdict"),
      text("note", { null: true }),
      ts("at"),
    ],
    indexes: [["workspace_id"], ["attempt_id"]],
    uniques: [],
  },
  {
    name: "audit_log",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("actor"),
      text("action"),
      text("target"),
      json("detail_json", { null: true }),
      ts("at"),
    ],
    indexes: [["workspace_id"], ["at"]],
    uniques: [],
  },
  {
    name: "api_key",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("name"),
      text("secret_hash"),
      json("scopes_json"),
      ts("created_at"),
      ts("last_used_at", { null: true }),
      ts("revoked_at", { null: true }),
    ],
    indexes: [["workspace_id"]],
    uniques: [["secret_hash"]],
  },
  {
    name: "webhook",
    tenant: true,
    columns: [
      ...tenantHead(),
      text("url"),
      json("events_json"),
      text("signing_secret"),
      bool("active"),
      ts("created_at"),
    ],
    indexes: [["workspace_id"]],
    uniques: [],
  },
];

export const TABLE_NAMES = TABLE_MANIFEST.map((t) => t.name);

/** Every `(table, column)` pair holding epoch milliseconds. */
export function timestampColumns(): { table: string; column: string }[] {
  return TABLE_MANIFEST.flatMap((table) =>
    table.columns
      .filter((c) => c.class === TIMESTAMP_CLASS)
      .map((c) => ({ table: table.name, column: c.name })),
  );
}

export function tableSpec(name: string): TableSpec {
  const spec = TABLE_MANIFEST.find((t) => t.name === name);
  if (!spec) throw new Error(`No table named ${name} in the manifest`);
  return spec;
}
