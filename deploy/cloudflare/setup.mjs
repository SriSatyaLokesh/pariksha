#!/usr/bin/env node
// Creates the D1 database and the R2 bucket this Worker binds, writes the
// database's id into wrangler.toml, and applies the migrations. Idempotent:
// run it again and it reports what already exists and changes nothing.
//
// `node deploy/cloudflare/setup.mjs --dry-run` runs the whole flow twice
// against an in-memory Cloudflare that needs no account, and asserts the
// second run is a no-op. That is this script's test; CI runs it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Not re-implemented here: the same runner the Worker boots with, so the
// `_migrations` bookkeeping that makes a second run a no-op is one
// implementation rather than two that have to agree.
import { migrate } from "../../packages/db/dist/migrate.js";

const CONFIG = fileURLToPath(new URL("wrangler.toml", import.meta.url));
const WRANGLER = fileURLToPath(
  new URL(
    "../../apps/api/node_modules/wrangler/bin/wrangler.js",
    import.meta.url,
  ),
);

/** The config is small and flat; one regex beats a TOML parser dependency. */
const scalar = (toml, key) =>
  new RegExp(`^${key} = "(.*)"$`, "m").exec(toml)?.[1];

/**
 * Names come from the config rather than from constants here, so there is
 * one place that says what the database and bucket are called.
 */
function names(toml) {
  const databaseName = scalar(toml, "database_name");
  const bucketName = scalar(toml, "bucket_name");
  assert(databaseName && bucketName, "wrangler.toml is missing a binding name");
  return { databaseName, bucketName };
}

/**
 * The id is only ever read back from `d1 list`, never from the output of
 * `d1 create` — which is what makes "already there" and "just created" the
 * same code path instead of two that can disagree.
 */
function ensureDatabase(cf, name, log) {
  const find = () =>
    JSON.parse(cf(["d1", "list", "--json"])).find((db) => db.name === name);

  const existing = find();
  if (existing) {
    log(`D1 database ${name} already exists (${existing.uuid}).`);
    return existing.uuid;
  }

  cf(["d1", "create", name]);
  const created = find();
  assert(created, `wrangler created ${name} but d1 list does not show it`);
  log(`Created D1 database ${name} (${created.uuid}).`);
  return created.uuid;
}

/**
 * R2 has no id to read back, so the create is simply allowed to fail as
 * already-existing. Cheaper and less brittle than parsing a bucket listing
 * whose shape differs between wrangler versions.
 */
function ensureBucket(cf, name, log) {
  try {
    cf(["r2", "bucket", "create", name]);
    log(`Created R2 bucket ${name}.`);
  } catch (error) {
    const message = String(error.stdout ?? "") + String(error.message ?? "");
    if (!/already (exists|owned)/i.test(message)) throw error;
    log(`R2 bucket ${name} already exists.`);
  }
}

function withDatabaseId(toml, uuid) {
  return toml.replace(/^database_id = ".*"$/m, `database_id = "${uuid}"`);
}

/**
 * Just enough of `DbClient` for `migrate`, which uses `dialect`, `exec` and
 * `all` and nothing else.
 *
 * ponytail: one `wrangler d1 execute` process per statement, so a first run
 * takes a couple of minutes. It runs once per deployment; batching would mean
 * owning the bookkeeping `migrate` already does.
 */
function d1OverWrangler(cf, name) {
  const run = (sql) =>
    cf(["d1", "execute", name, "--remote", "--json", "--command", sql]);
  return {
    dialect: "d1",
    exec: (sql) => Promise.resolve(void run(sql)),
    all: (sql) => Promise.resolve(JSON.parse(run(sql))[0]?.results ?? []),
  };
}

export async function setup({ cf, readConfig, writeConfig, log }) {
  const toml = readConfig();
  const { databaseName, bucketName } = names(toml);

  const uuid = ensureDatabase(cf, databaseName, log);
  ensureBucket(cf, bucketName, log);

  const updated = withDatabaseId(toml, uuid);
  if (updated === toml) log("wrangler.toml already carries the database id.");
  else {
    writeConfig(updated);
    log("Wrote the database id into wrangler.toml.");
  }

  const { applied } = await migrate(d1OverWrangler(cf, databaseName));
  log(
    applied.length
      ? `Applied ${applied.length} migration(s): ${applied.join(", ")}.`
      : "No migrations to apply.",
  );

  return { uuid, applied };
}

/** An in-memory Cloudflare: enough for --dry-run, and no account. */
function fakeCloudflare() {
  const databases = [];
  const buckets = new Set();
  const tables = new Map();

  return (args) => {
    const [service, verb, name] = args;
    if (service === "d1" && verb === "list") return JSON.stringify(databases);
    if (service === "d1" && verb === "create") {
      databases.push({ name, uuid: "00000000-0000-4000-8000-000000000000" });
      return "";
    }
    if (service === "r2" && verb === "bucket") {
      const bucket = args[3];
      if (buckets.has(bucket))
        throw new Error("A bucket with that name already exists");
      buckets.add(bucket);
      return "";
    }
    if (service === "d1" && verb === "execute") {
      // Only `_migrations` is read back, and only for the names in it. Every
      // other statement is accepted unexamined — this fake checks the
      // script's control flow, not SQLite's.
      const sql = args[args.length - 1];
      const insert =
        /INSERT INTO _migrations \(name, applied_at\) VALUES \('(.*?)'/.exec(
          sql,
        );
      if (insert) tables.set(insert[1], true);
      const rows = sql.startsWith("SELECT name FROM _migrations")
        ? [...tables.keys()].map((n) => ({ name: n }))
        : [];
      return JSON.stringify([{ results: rows }]);
    }
    throw new Error(`unexpected wrangler command: ${args.join(" ")}`);
  };
}

async function dryRun() {
  const cf = fakeCloudflare();
  let config = readFileSync(CONFIG, "utf8");
  const options = {
    cf,
    readConfig: () => config,
    writeConfig: (next) => void (config = next),
    log: (line) => console.log(`  ${line}`),
  };

  console.log("first run:");
  const first = await setup(options);
  const afterFirst = config;

  console.log("second run:");
  const second = await setup(options);

  assert.equal(
    second.uuid,
    first.uuid,
    "the second run picked a different database",
  );
  assert.deepEqual(second.applied, [], "the second run re-applied migrations");
  assert.equal(config, afterFirst, "the second run rewrote wrangler.toml");
  assert.notEqual(
    first.applied.length,
    0,
    "the first run applied no migrations",
  );
  console.log(
    "\nidempotent: the second run created nothing and applied nothing.",
  );
}

/**
 * A failed `wrangler` call arrives as an execFileSync error whose message is
 * the command line and whose useful half is on the inherited stderr, already
 * scrolled past. Left alone, Node prints a stack trace through this script's
 * internals — which says nothing about the two things that are actually
 * wrong in practice: the token lacks a permission, or it is for the wrong
 * account. This is operator-facing tooling, so it names them.
 */
function explain(error) {
  const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;

  // 10000 is Cloudflare's "authentication error", which `wrangler whoami`
  // will happily contradict: the token is valid, it just has no grant for
  // the product being called. Deploying a Worker and creating a D1 database
  // are separate permissions, so one working says nothing about the other.
  if (text.includes("10000") || /Authentication error/i.test(text)) {
    return [
      "The API token authenticated but is not allowed to do this.",
      "",
      "A custom API token carries its own permissions and does NOT inherit",
      "your user's account role, so a token that deploys a Worker can still",
      "be unable to create a database. Add these at",
      "https://dash.cloudflare.com/profile/api-tokens:",
      "",
      "  D1                   Edit    create the database, run migrations",
      "  Workers R2 Storage   Edit    create the bucket",
      "  Workers Scripts      Edit    deploy (likely already present)",
      "",
      "If you rotate the token rather than editing it, update the GitHub",
      "secret too: gh secret set CLOUDFLARE_API_TOKEN",
    ].join("\n");
  }

  // Deliberately narrow, and checked after 10000: wrangler prints the words
  // "CLOUDFLARE_API_TOKEN" on a perfectly successful `whoami`, so a loose
  // match here reports "not authenticated" for a token that authenticated
  // fine and merely lacks a grant.
  if (/not logged in|you are not authenticated|wrangler login/i.test(text)) {
    return [
      "wrangler is not authenticated.",
      "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or run `wrangler login`.",
    ].join("\n");
  }

  return null;
}

async function main() {
  if (process.argv.includes("--dry-run")) return dryRun();

  const result = await setup({
    // stderr is captured, not inherited: wrangler reports *why* a call failed
    // there, and inheriting it means the reason reaches the terminal but not
    // this script, which can then only guess. It is echoed below on failure,
    // so nothing is hidden — it just arrives after the diagnosis instead of
    // scrolling past before it.
    cf: (args) =>
      execFileSync(process.execPath, [WRANGLER, ...args], {
        encoding: "utf8",
        stdio: ["inherit", "pipe", "pipe"],
      }),
    readConfig: () => readFileSync(CONFIG, "utf8"),
    writeConfig: (next) => writeFileSync(CONFIG, next),
    log: (line) => console.log(line),
  });

  console.log(
    `\nNext: set the secrets, then deploy.\n` +
      `  pnpm --filter @pariksha/api exec wrangler secret put SESSION_SECRET -c ${CONFIG}\n` +
      `  pnpm build && pnpm deploy:cf\n` +
      `Database ${result.uuid} is migrated and committed to wrangler.toml — commit that change.`,
  );
}

try {
  await main();
} catch (error) {
  const advice = explain(error);
  if (!advice) throw error;
  // What wrangler said, then what to do about it. Both, in that order.
  const detail = `${error.stderr ?? ""}`.trim();
  console.error(
    `\nSetup stopped.\n${detail ? `\n${detail}\n` : ""}\n${advice}\n`,
  );
  process.exitCode = 1;
}
