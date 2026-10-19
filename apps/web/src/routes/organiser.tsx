import { useCallback, useEffect, useState } from "react";
import type { Question } from "@pariksha/core";
import {
  ApiError,
  type Actor,
  type ApiClient,
  type QuestionSummary,
  type SetupStatus,
  type Workspace,
} from "../lib/api";
import { SignIn } from "./signin";
import { Setup } from "./setup";
import { Dashboard } from "./dashboard";
import { BankList } from "./banks";
import { BankBrowser } from "./bank";
import { QuestionScreen } from "./question";
import { TestList } from "./tests";
import { TestBuilder } from "./test";

// Routing, without a router.
//
// No router library is installed, and none is added: which screen a
// visitor sees is not a property of the URL, it is a property of API
// answers and, once signed in, of the one piece of state this component
// owns itself — which bank, and which question, an Author opened.
//
//   GET /setup/status → needed?        GET /me → signed in?
//   ────────────────────────────────────────────────────────────
//   not signed in            → sign in (whatever the URL said)
//   signed in, no owner yet  → the first-run wizard
//   signed in, owner exists  → the dashboard, banks, bank browser or
//                              question editor — a state machine on top of
//                              that last answer, not a second URL table.
//
// That is also what the Phase 3 plan's end-to-end tests describe: "visiting
// /setup after setup is complete redirects to sign-in, not to the wizard" is
// this table, not a route guard. A client-side path router would additionally
// need a server rewrite that the static host (public/_headers, no
// _redirects) does not have — /dashboard would 404 before React ever ran.
// Fix round (whole-branch review, C1): the bank/question screens below are
// reached the same way — a `View` variant this component switches to, never
// a path — rather than reaching for a router to wire up the surface that
// nine tasks built and no Author could open.
//
// The URL does carry one thing: `?returnTo=`, which survives the round trip
// through the identity provider and is validated by lib/api's safeReturnTo
// before it is ever put in a link.

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "signin"; providers: SetupStatus["providers"] }
  | { kind: "setup" }
  | { kind: "dashboard"; actor: Actor; workspace: Workspace }
  | { kind: "banks"; actor: Actor; workspace: Workspace }
  | { kind: "tests"; actor: Actor; workspace: Workspace }
  | { kind: "test"; actor: Actor; workspace: Workspace; testId: string }
  | { kind: "bank"; actor: Actor; workspace: Workspace; bankId: string }
  | {
      kind: "question";
      actor: Actor;
      workspace: Workspace;
      bankId: string;
      initial?: Question;
    };

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
          onOpenBanks={() => setView({ kind: "banks", actor: view.actor, workspace: view.workspace })}
          onOpenTests={() => setView({ kind: "tests", actor: view.actor, workspace: view.workspace })}
        />
      );
    case "tests":
      return (
        <TestList
          workspaceId={view.workspace.id}
          client={client}
          actorEmail={view.actor.email}
          onSignOut={signOut}
          onBack={() => setView({ kind: "dashboard", actor: view.actor, workspace: view.workspace })}
          onOpenTest={(testId) => setView({ kind: "test", actor: view.actor, workspace: view.workspace, testId })}
        />
      );
    case "test":
      return (
        <TestBuilder
          workspaceId={view.workspace.id}
          testId={view.testId}
          client={client}
          // The whole actor, not just the address: T-23's workspace half
          // is readable by every member and writable only by an owner, so
          // the builder needs the membership to know which it is showing.
          actor={view.actor}
          onSignOut={signOut}
          onBack={() => setView({ kind: "tests", actor: view.actor, workspace: view.workspace })}
        />
      );
    case "banks":
      return (
        <BankList
          workspaceId={view.workspace.id}
          client={client}
          actorEmail={view.actor.email}
          onSignOut={signOut}
          onBack={() => setView({ kind: "dashboard", actor: view.actor, workspace: view.workspace })}
          onOpenBank={(bankId) => setView({ kind: "bank", actor: view.actor, workspace: view.workspace, bankId })}
        />
      );
    case "bank":
      return (
        <BankBrowser
          bankId={view.bankId}
          workspaceId={view.workspace.id}
          client={client}
          actorEmail={view.actor.email}
          onSignOut={signOut}
          onBack={() => setView({ kind: "banks", actor: view.actor, workspace: view.workspace })}
          onNewQuestion={() =>
            setView({ kind: "question", actor: view.actor, workspace: view.workspace, bankId: view.bankId })
          }
          onEditQuestion={(question: QuestionSummary) =>
            setView({
              kind: "question",
              actor: view.actor,
              workspace: view.workspace,
              bankId: view.bankId,
              initial: question.document,
            })
          }
        />
      );
    case "question":
      return (
        <QuestionScreen
          workspaceId={view.workspace.id}
          bankId={view.bankId}
          initial={view.initial}
          client={client}
          actorEmail={view.actor.email}
          onSignOut={signOut}
          onBack={() => setView({ kind: "bank", actor: view.actor, workspace: view.workspace, bankId: view.bankId })}
          // Stays on this screen after a save (`QuestionScreen`'s own
          // "Saved." status announces it) rather than navigating away —
          // `onBack` above is the deliberate, explicit way out. A caller
          // that wanted to know a save happened would be given one here;
          // `BankBrowser` re-fetches its own list on mount, which going
          // "Back to bank" already triggers.
          onSaved={() => undefined}
        />
      );
  }
}
