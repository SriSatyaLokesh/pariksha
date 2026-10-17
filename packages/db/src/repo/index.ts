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
