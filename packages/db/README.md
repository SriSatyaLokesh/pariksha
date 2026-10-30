# packages/db

[Drizzle ORM](https://orm.drizzle.team/) schema and migrations, shared by Cloudflare D1, SQLite and Postgres. Every query is scoped by workspace ID.

**Status:** planned for v0.1. See [PRD — Data model](../../docs/PRD.md#data-model-question-format-and-api).

## PostgreSQL Testing

Pariksha employs a dual-dialect database strategy:
- **SQLite / Cloudflare D1**: Tested offline and in CI via `better-sqlite3` and Miniflare (`apps/api/test/worker.test.ts`).
- **PostgreSQL**: Tested in CI via the GitHub Actions `postgres:16` service container, executing migrations 0000 through 0016, repository CRUD, and dialect-conditional SQL paths (`packages/db/test/postgres-repo.test.ts` and `test/migrate.test.ts`).

### Running Postgres Tests Locally

To run the PostgreSQL test suite against a local database container:

1. Start the Postgres service via Docker Compose:
   ```bash
   docker compose -f deploy/docker/docker-compose.yml up -d postgres
   ```

2. Run the Postgres repository test runner:
   ```bash
   pnpm --filter @pariksha/db test:pg
   ```

When `TEST_POSTGRES_URL` is unset, Vitest marks Postgres repository tests as skipped, enabling developers to run the test suite locally without requiring a PostgreSQL daemon. In CI, the gate is mandatory and fails if `TEST_POSTGRES_URL` is absent.

