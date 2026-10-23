import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Question } from "@pariksha/core";
import {
  ApiError,
  type Actor,
  type ApiClient,
  type QuestionSummary,
  type SetupStatus,
  type Workspace,
} from "../lib/api";
import { OrganiserShell, type NavKey } from "../components/OrganiserShell";
import { readView, resetViewForWorkspace, writeView, type ViewParams } from "../lib/view-url";
import { SignIn } from "./signin";
import { Setup } from "./setup";
import { Home } from "./home";
import { BankList } from "./banks";
import { BankBrowser } from "./bank";
import { QuestionScreen } from "./question";
import { TestList } from "./tests";
import { TestBuilder } from "./test";
import { ImportScreen } from "./import";
import { GradingRoute } from "./grading";
import { WebhookPanel } from "../components/organiser/WebhookPanel";

// Routing, without a router.
//
// No router library is installed, and none is added. Which screen a visitor
// sees is first a property of API answers — signed in? set up? a member of
// anything? — and only then, once those say "yes", a property of the URL:
// `?view=tests&test=tst_8c21a4`, read on first paint and on `popstate` and
// written by every navigation (spec §5, `D5`; `lib/view-url.ts` is the one
// parser).
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
// The URL also carries `?returnTo=`, which survives the round trip through
// the identity provider and is validated by lib/api's safeReturnTo before it
// is ever put in a link. `readView` does not touch it and `writeView`
// preserves it.

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "signin"; providers: SetupStatus["providers"] }
  | { kind: "setup" }
  | { kind: "dashboard"; actor: Actor; workspace: Workspace }
  | { kind: "banks"; actor: Actor; workspace: Workspace }
  | { kind: "tests"; actor: Actor; workspace: Workspace }
  | { kind: "webhooks"; actor: Actor; workspace: Workspace }
  | { kind: "test"; actor: Actor; workspace: Workspace; testId: string }
  // Phase 8b Task 2 fix round 1 (`K15`, `AC-26`): the grading queue, reached
  // from the test builder's own "Grading queue" button (`test.tsx`), never
  // from the top nav — `D3` (`OrganiserShell.tsx:141-144`) keeps it off
  // `NAV` until a cross-test inbox is actually wanted.
  | { kind: "grading"; actor: Actor; workspace: Workspace; testId: string }
  // `bankName` is absent exactly when the browser was deep-linked rather
  // than opened from the list (`?view=bank&bank=bnk_1`), because a name is
  // not in `ViewParams` and no call in this component fetches one.
  | {
      kind: "bank";
      actor: Actor;
      workspace: Workspace;
      bankId: string;
      bankName?: string;
    }
  | {
      kind: "question";
      actor: Actor;
      workspace: Workspace;
      bankId: string;
      initial?: Question;
    }
  // `D18`: import is a page. `bankId` present is a bank import; absent is a
  // whole-test import, which names no bank because it creates its own
  // test — the same asymmetry `?view=import[&bank=…]` carries, and the
  // reason there is no second `kind` field here to fall out of step with
  // it.
  | {
      kind: "import";
      actor: Actor;
      workspace: Workspace;
      // `| undefined` spelled out, not just `?`: `exactOptionalPropertyTypes`
      // is on, and `fromUrl` assigns `readView`'s own `string | undefined`
      // straight through rather than branching on a value that is allowed
      // to be absent.
      bankId?: string | undefined;
    };

export function OrganiserApp({
  client,
  returnTo,
}: {
  client: ApiClient;
  returnTo?: string | null | undefined;
}) {
  const [view, setView] = useState<View>({ kind: "loading" });
  // `D4`: the membership count is free — `boot` already fetches this list to
  // pick `workspaces[0]`. Keeping it rather than discarding everything after
  // the first is the whole cost of the switcher.
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

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
      const memberships = await client.workspaces();
      setWorkspaces(memberships);
      const workspace = memberships[0];
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
      // `D5`: the first paint obeys the URL. `boot` is also what a sign-out
      // and a completed first run re-run, and in both of those the URL is
      // still whatever the last navigation left — which is the right answer
      // for a reload and a harmless one for the rest, since every view it
      // can name belongs to this actor's workspace or is refused by the
      // screen's own fetch.
      setView(fromUrl(actor, workspace));
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

  // Back and Forward. `D5`'s whole argument is that a persistent nav makes
  // the browser's own Back button a visible problem, so the history entry
  // every navigation pushes has to be honoured on the way back as well as
  // on the way in. The actor and the workspace come from whatever view is
  // current — a functional update rather than a dependency, so the listener
  // is registered once and can never read a stale pair.
  useEffect(() => {
    const onPopState = () =>
      setView((previous) =>
        "actor" in previous ? fromUrl(previous.actor, previous.workspace) : previous,
      );
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /** Navigate: the URL first, then the state it names. */
  const go = useCallback((next: View) => {
    const params = paramsOf(next);
    if (params !== null) writeView(params);
    setView(next);
  }, []);

  const signOut = useCallback(() => {
    void client.signOut().finally(() => void boot());
  }, [client, boot]);

  // The chrome, once (`D3`). Each `case` arm below decides WHAT renders; the
  // shell decides where, and carries the nav, the workspace, the person and
  // the way out that every screen used to render for itself.
  //
  // `loading`, `error`, `signin` and `setup` are deliberately outside it: a
  // sidebar offering Banks and Tests to a visitor who has not signed in — or
  // to an instance that has no workspace yet — is a nav with nothing behind
  // it, which is the lie `admin.css:99-101` refused.
  function shell(
    current: NavKey,
    actor: Actor,
    workspace: Workspace,
    page: { title?: string; crumb?: string; wide?: boolean },
    children: ReactNode,
  ) {
    return (
      <OrganiserShell
        current={current}
        actor={actor}
        workspace={workspace}
        onNavigate={(key) => {
          go(
            key === "home"
              ? { kind: "dashboard", actor, workspace }
              : { kind: key, actor, workspace },
          );
        }}
        workspaces={workspaces}
        // `D4a`: a switch lands on Home with every id-bearing parameter
        // gone. The URL first, then the state it names — the same order
        // `go` uses, and for the same reason: `?view=test&test=…` left in
        // place would ask the new workspace for the old one's test.
        onSwitchWorkspace={(next) => {
          resetViewForWorkspace();
          setView({ kind: "dashboard", actor, workspace: next });
        }}
        onSignOut={signOut}
        {...page}
      >
        {children}
      </OrganiserShell>
    );
  }

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
      // The second arm that passes no `title`/`crumb`, and for the same
      // reason as the builder: `D6` rebuilt this screen on the Signal
      // ground (`home.css`), and `.shell__head` writes its heading in
      // admin.css's cream-world ink. Home renders its own <h1> and its own
      // role crumb — UX-11's "the role you hold is stated on arrival" is
      // still on the screen, one element lower. 6.5e lifts both back into
      // the shell when the page itself moves.
      return shell(
        "home",
        view.actor,
        view.workspace,
        {},
        <Home
          client={client}
          workspace={view.workspace}
          actor={view.actor}
          onOpenTest={(testId) =>
            go({ kind: "test", actor: view.actor, workspace: view.workspace, testId })
          }
          onOpenTests={() => go({ kind: "tests", actor: view.actor, workspace: view.workspace })}
        />,
      );
    case "tests":
      return shell(
        "tests",
        view.actor,
        view.workspace,
        { title: "Tests", crumb: "Tests" },
        <TestList
          workspaceId={view.workspace.id}
          client={client}
          onOpenTest={(testId) => go({ kind: "test", actor: view.actor, workspace: view.workspace, testId })}
          // `D18`: no bank id, so `?view=import` with nothing after it —
          // which is what tells the page it is importing a whole test.
          onImport={() => go({ kind: "import", actor: view.actor, workspace: view.workspace })}
        />,
      );
    case "webhooks":
      return shell(
        "webhooks",
        view.actor,
        view.workspace,
        { title: "Webhooks", crumb: "Webhooks" },
        <WebhookPanel workspaceId={view.workspace.id} client={client} />,
      );
    case "test":
      // The builder fetches the test and renders `test?.name ?? "Test
      // builder"` as its own <h1> (test.tsx), so it is the one arm that
      // passes no `title` — a second heading above its own would be two
      // <h1>s on one screen. 6.5d lifts it into the shell when it rebuilds
      // that screen.
      return shell(
        "tests",
        view.actor,
        view.workspace,
        {},
        <TestBuilder
          workspaceId={view.workspace.id}
          testId={view.testId}
          client={client}
          // The whole actor, not just the address: T-23's workspace half
          // is readable by every member and writable only by an owner, so
          // the builder needs the membership to know which it is showing.
          actor={view.actor}
          onOpenGrading={(testId) =>
            go({ kind: "grading", actor: view.actor, workspace: view.workspace, testId })
          }
        />,
      );
    case "grading":
      // `current="tests"`, not a nav entry of its own (`D3`): this is a
      // destination reached from one test, not a place the rail offers.
      return shell(
        "tests",
        view.actor,
        view.workspace,
        { title: "Grading queue", crumb: "Grading" },
        <GradingRoute client={client} workspaceId={view.workspace.id} testId={view.testId} />,
      );
    case "banks":
      return shell(
        "banks",
        view.actor,
        view.workspace,
        { title: "Banks", crumb: "Question banks" },
        <BankList
          workspaceId={view.workspace.id}
          client={client}
          onOpenBank={(bankId, bankName) =>
            go({ kind: "bank", actor: view.actor, workspace: view.workspace, bankId, bankName })
          }
        />,
      );
    case "bank":
      // Fix round 1, finding 3: the browser renders no <h1> of its own — its
      // document outline used to start at the <h2> over the passage groups —
      // so the shell carries its title. `BankList` already holds the name and
      // hands it over on the way in; a deep link has no list behind it and no
      // name to hand over, so the heading names the surface instead. Either
      // way the page starts at <h1>.
      return shell(
        "banks",
        view.actor,
        view.workspace,
        // `wide`: `D18` — browsing is where the page wants width, so this arm
        // drops the 1080px clamp and opens with the rail collapsed. It is
        // the only arm that asks; every other organiser screen was already
        // inside `.organiser--wide` before the shell existed.
        { title: view.bankName ?? "Bank", crumb: "Question banks", wide: true },
        <BankBrowser
          bankId={view.bankId}
          workspaceId={view.workspace.id}
          client={client}
          onNewQuestion={() =>
            go({ kind: "question", actor: view.actor, workspace: view.workspace, bankId: view.bankId })
          }
          onEditQuestion={(question: QuestionSummary) =>
            go({
              kind: "question",
              actor: view.actor,
              workspace: view.workspace,
              bankId: view.bankId,
              initial: question.document,
            })
          }
          onImport={() =>
            go({ kind: "import", actor: view.actor, workspace: view.workspace, bankId: view.bankId })
          }
        />,
      );
    case "question":
      return shell(
        "banks",
        view.actor,
        view.workspace,
        {
          title: view.initial ? "Edit question" : "New question",
          crumb: view.initial ? "Edit question" : "New question",
        },
        <QuestionScreen
          workspaceId={view.workspace.id}
          bankId={view.bankId}
          initial={view.initial}
          client={client}
          // Branch review M3: `QuestionScreen` gates the regrade offer on
          // `attempts.grade`, which needs the actor's role in this
          // workspace — already in scope here, same as every other arm.
          actor={view.actor}
          // Stays on this screen after a save (`QuestionScreen`'s own
          // "Saved." status announces it) rather than navigating away —
          // the rail is the deliberate, explicit way out. A caller that
          // wanted to know a save happened would be given one here;
          // `BankBrowser` re-fetches its own list on mount, which going
          // back to the bank already triggers.
          onSaved={() => undefined}
        />,
      );
    case "import": {
      // One arm, both kinds (`D18` names one page, and `ImportDialog`
      // already proved one component serves both: "a second copy of the
      // error-summary pattern would be a second thing to keep in step").
      // The rail marks Banks or Tests by which import this is, because
      // that is the list the organiser came from and will go back to.
      const bankImport = view.bankId !== undefined;
      return shell(
        bankImport ? "banks" : "tests",
        view.actor,
        view.workspace,
        bankImport
          ? { title: "Import questions", crumb: "Question banks" }
          : { title: "Import a test", crumb: "Tests" },
        <ImportScreen
          workspaceId={view.workspace.id}
          bankId={view.bankId}
          kind={bankImport ? "bank" : "test"}
          client={client}
          // Where the dialog closed itself and asked its route to
          // re-fetch, a page navigates: back to the bank it filled, or to
          // the test list. Both screens fetch on mount, so arriving there
          // is the re-fetch.
          onImported={() =>
            go(
              view.bankId === undefined
                ? { kind: "tests", actor: view.actor, workspace: view.workspace }
                : { kind: "bank", actor: view.actor, workspace: view.workspace, bankId: view.bankId },
            )
          }
        />,
      );
    }
  }
}

/**
 * The view the current URL names (`D5`).
 *
 * An id in a query string is a claim anyone can type, so a view that needs
 * one and does not have it is **not** rendered: `?view=test` with no `test=`
 * lands on Home rather than mounting a builder around an empty id, which is
 * the "shell wrapped around nothing" this ruling exists to prevent. A view
 * naming an id this actor cannot reach is the screen's own fetch to refuse —
 * it is the only side that knows — and it refuses with an error in place of
 * the screen.
 *
 * `?view=question` restores the **bank**, not the editor. Fix round 1
 * (Important): every other screen behind a `?view=` fetches something and
 * can therefore refuse — `QuestionScreen` does not. It takes `bankId` as a
 * string and asks the server nothing, so a hand-typed or stale
 * `?view=question&bank=bnk_other_workspace` used to render a complete,
 * interactive editor around a bank nobody had checked, and the actor found
 * out at Save. The bank browser is one step back, fetches on mount, and
 * refuses there instead. `paramsOf` still writes `?view=question&bank=…`,
 * so the editor remains a Back stop you can return *from*; it is only not
 * a place a URL can put you.
 *
 * That also answers which question was open, which is not in `ViewParams`
 * and is not worth amending `D5`'s parameter list to add.
 */
function fromUrl(actor: Actor, workspace: Workspace): View {
  const params = readView(window.location.search);
  const home: View = { kind: "dashboard", actor, workspace };
  switch (params.view) {
    case "banks":
    case "tests":
    case "webhooks":
      return { kind: params.view, actor, workspace };
    case "test":
      return params.test === undefined
        ? home
        : { kind: "test", actor, workspace, testId: params.test };
    case "grading":
      return params.test === undefined
        ? home
        : { kind: "grading", actor, workspace, testId: params.test };
    case "bank":
      return params.bank === undefined
        ? home
        : { kind: "bank", actor, workspace, bankId: params.bank };
    case "question":
      // Deliberately the bank: see the note above.
      return params.bank === undefined
        ? home
        : { kind: "bank", actor, workspace, bankId: params.bank };
    case "import":
      // The one view with no "no id, no view" refusal to make, because
      // there is no missing id: `?view=import` without a bank is the test
      // import, not a bank import with its id lost. A bank id that is a
      // claim rather than a fact is still refused the way every other
      // screen's is — by the import itself, which the server answers.
      return { kind: "import", actor, workspace, bankId: params.bank };
    case "home":
      return home;
  }
}

/** …and back again. `null` for the four views that are not a place — the
 *  boot, an error, sign-in and the first-run wizard are states of the
 *  instance, not destinations, and none of them is navigated *to*. */
function paramsOf(view: View): ViewParams | null {
  switch (view.kind) {
    case "dashboard":
      return { view: "home" };
    case "banks":
    case "tests":
    case "webhooks":
      return { view: view.kind };
    case "test":
      return { view: "test", test: view.testId };
    case "grading":
      return { view: "grading", test: view.testId };
    case "bank":
      return { view: "bank", bank: view.bankId };
    case "question":
      return { view: "question", bank: view.bankId };
    case "import":
      // The key is omitted rather than set to `undefined`
      // (`exactOptionalPropertyTypes`), and `writeView` then deletes
      // `?bank=` because the new view carries no value for it — which is
      // exactly what a test import needs.
      return { view: "import", ...(view.bankId !== undefined && { bank: view.bankId }) };
    default:
      return null;
  }
}

