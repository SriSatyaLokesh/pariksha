// Both dialects, namespaced so a caller has to say which one it means, plus
// the manifest the two are checked against.

export * as sqliteSchema from "./sqlite.js";
export * as pgSchema from "./pg.js";
export * from "./columns.js";
