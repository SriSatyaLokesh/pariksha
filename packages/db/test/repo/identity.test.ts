import { expect, it } from "vitest";
import { REPO_FUNCTIONS } from "../../src/repo/guard.js";
import * as identity from "../../src/repo/identity.js";
import * as repo from "../../src/repo/index.js";

// `identity.ts` is the one part of the repository layer that is not
// workspace-scoped, because a session is looked up before any workspace is
// known. It keeps its distance from the guard instead of being exempted by
// it: the barrel `scoping.test.ts` reads — `repo/index.ts` — does not
// re-export this module, so "every function there is scoped" stays true with
// no exemption list to grow. This file is what stops either half drifting
// into the other.

const UNSCOPED_BY_DESIGN = [
  "createUser",
  // Sign-in reads and the short-lived tokens that precede it: there is no
  // workspace to scope them to, because which workspaces the actor may see
  // is the answer these produce, not an argument they take (ADR 0006).
  "findUserByEmail",
  // A user's workspace list spans every workspace by definition, so there is
  // no single one to scope it to.
  "listUserWorkspaces",
  // "has this instance been claimed?" is asked by the first-run wizard
  // before any workspace exists, and the answer is that none does.
  "anyWorkspaceExists",
  "insertAuthToken",
  "consumeAuthToken",
  "insertSession",
  "readSessionActor",
  "touchSession",
  "deleteSession",
  "deleteUserSessions",
];

function functionNames(module: Record<string, unknown>): string[] {
  return Object.entries(module)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name);
}

it("the unscoped set is exactly the one named here", () => {
  // Adding a function to identity.ts is a deliberate act, not a side effect
  // of importing one: it fails here until someone writes its name down.
  expect(new Set(functionNames(identity))).toEqual(new Set(UNSCOPED_BY_DESIGN));
});

it("no unscoped function reaches the scoped barrel or its registry", () => {
  for (const name of UNSCOPED_BY_DESIGN) {
    expect(repo, `${name} is exported from repo/index.ts`).not.toHaveProperty(
      name,
    );
    expect(
      REPO_FUNCTIONS,
      `${name} is registered as a scoped function`,
    ).not.toHaveProperty(name);
  }
});
