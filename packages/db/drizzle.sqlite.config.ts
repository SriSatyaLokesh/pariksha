import { defineConfig } from "drizzle-kit";

// D1 and SQLite share a dialect; the D1 deployment applies the same files.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/sqlite.ts",
  out: "./migrations/sqlite",
});
