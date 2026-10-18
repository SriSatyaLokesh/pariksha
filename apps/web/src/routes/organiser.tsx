import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type Actor,
  type ApiClient,
  type SetupStatus,
  type Workspace,
} from "../lib/api";
import { SignIn } from "./signin";
import { Setup } from "./setup";
import { Dashboard } from "./dashboard";

// Routing, without a router.
//
// No router library is installed, and none is added: which of the three
// screens a visitor sees is not a property of the URL, it is a property of
// two API answers.
//
//   GET /setup/status → needed?        GET /me → signed in?
//   ────────────────────────────────────────────────────────────
//   not signed in            → sign in (whatever the URL said)
//   signed in, no owner yet  → the first-run wizard
//   signed in, owner exists  → the dashboard
//
// That is also what the Phase 3 plan's end-to-end tests describe: "visiting
// /setup after setup is complete redirects to sign-in, not to the wizard" is
// this table, not a route guard. A client-side path router would additionally
// need a server rewrite that the static host (public/_headers, no
// _redirects) does not have — /dashboard would 404 before React ever ran.
//
// The URL does carry one thing: `?returnTo=`, which survives the round trip
// through the identity provider and is validated by lib/api's safeReturnTo
// before it is ever put in a link.

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "signin"; providers: SetupStatus["providers"] }
  | { kind: "setup" }
  | { kind: "dashboard"; actor: Actor; workspace: Workspace };

export function OrganiserApp({
  client,
  returnTo,
}: {
  client: ApiClient;
  returnTo?: string | null | undefined;
}) {
  const [view, setView] = useState<View>({ kind: "loading" });

  const boot = useCallback(async () => {
    setView({ kind: "loading" });
    try {
      const status = await client.setupStatus();
      const actor = await client.me();
      if (actor === null) {
        setView({ kind: "signin", providers: status.providers });
        return;
      }
      if (status.needed) {
        setView({ kind: "setup" });
        return;
      }
      const workspaces = await client.workspaces();
      const workspace = workspaces[0];
      if (workspace === undefined) {
        // Signed in, setup done, but this actor belongs to nothing. Only
        // reachable if every membership was revoked between the two calls.
        setView({
          kind: "error",
          message:
            "You are signed in, but you are not a member of any workspace. Ask an owner to add you.",
        });
        return;
      }
      setView({ kind: "dashboard", actor, workspace });
    } catch (cause) {
      setView({
        kind: "error",
        message:
          cause instanceof ApiError
            ? cause.message
            : "Pariksha could not be reached. Check the server is running, then reload.",
      });
    }
  }, [client]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const signOut = useCallback(() => {
    void client.signOut().finally(() => void boot());
  }, [client, boot]);

  switch (view.kind) {
    case "loading":
      return (
        <main id="main-content" className="organiser">
          <p className="organiser__status" role="status">
            Loading…
          </p>
        </main>
      );
    case "error":
      return (
        <main id="main-content" className="organiser">
          <h1 className="organiser__title">Pariksha</h1>
          <p className="organiser__notice" role="alert">
            {view.message}
          </p>
        </main>
      );
    case "signin":
      return (
        <SignIn
          client={client}
          providers={view.providers}
          returnTo={returnTo}
        />
      );
    case "setup":
      return <Setup client={client} onComplete={() => void boot()} />;
    case "dashboard":
      return (
        <Dashboard
          actor={view.actor}
          workspace={view.workspace}
          onSignOut={signOut}
        />
      );
  }
}
