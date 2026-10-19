// Phase 3's gate, AC-01 (partial): a fresh deployment reaches a signed-in,
// empty dashboard through a real browser — landing page, sign in, wizard,
// dashboard — with no manual database work.
//
// Everything runs on localhost: a built `dist/` behind `vite preview`, the
// Node API behind that same origin's `/api` proxy, and an OpenID provider
// that exists only in `e2e/stub-idp.mjs`. No test here reaches the network.
//
// The four tests share one API process and therefore one database, and the
// first one is what completes setup — so `playwright.config.ts` pins
// `workers: 1` and leaves `fullyParallel` off. Each test still gets its own
// browser context, so nothing carries a session cookie into the next.
//
// Three selectors in the Phase 3 plan's sketch do not exist on the shipped
// screens; each is noted where it is replaced. The screens are the truth.

import { expect, test, type Page } from "@playwright/test";

/** The organiser app. The plan writes `/setup` and `/dashboard`; see below. */
const ORGANISER = "/admin.html";

/**
 * `e2e/stub-idp.mjs` needs no credentials and asks no questions: its
 * `/authorize` redirects straight back to the callback with a code. So
 * "sign in" is one click on the one provider the instance configures, and
 * the assertion that matters is where the browser ends up.
 */
async function signInWithStubProvider(page: Page): Promise<void> {
  await page.getByRole("link", { name: /continue with/i }).click();
}

test("AC-01 (partial): a fresh deployment goes landing → sign in → wizard → dashboard", async ({
  page,
}) => {
  await page.goto("/");
  // The plan clicks `link, name: /get started/i` here. The landing page has
  // no such link — its CTAs are in-page anchors and a GitHub link, and
  // nothing on it points at the organiser app at all. So
  // the landing page is asserted, then the organiser app is opened the way
  // an organiser reaches it today: by its URL.
  await expect(
    page.getByRole("heading", { level: 1, name: /run real exams on infrastructure/i }),
  ).toBeVisible();

  await page.goto(ORGANISER);
  await signInWithStubProvider(page);

  await page.getByLabel("Workspace name").fill("Placement cell");
  await page.getByRole("button", { name: /create workspace/i }).click();

  await expect(page.getByRole("heading", { name: "Placement cell" })).toBeVisible();
  // Phase 5 replaced the dashboard's "no tests yet" line with a Tests card
  // whose call to action opens the real test list. Asserting the control
  // rather than the prose: it is what makes this an empty state a new
  // organiser can act on, and it survives the next copy edit.
  await expect(
    page.getByRole("button", { name: /create your first test/i }),
  ).toBeVisible();
});

test("the wizard cannot be re-opened once the instance has an owner", async ({
  page,
}) => {
  // The plan calls this "visiting /setup after setup is complete redirects
  // to sign-in, not to the wizard". There is no `/setup` URL: the organiser
  // app routes on two API answers, not on the path (see routes/organiser.tsx),
  // and the static host serves a 404 page rather than a SPA fallback, so
  // `/setup` would never reach React. What the plan describes is that table
  // — which is what is asserted here, from both of its signed-out and
  // signed-in rows.
  await page.goto(ORGANISER);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/name your first workspace/i)).toHaveCount(0);

  await signInWithStubProvider(page);
  await expect(page.getByRole("heading", { name: "Placement cell" })).toBeVisible();
  await expect(page.getByText(/name your first workspace/i)).toHaveCount(0);
});

test("a signed-out visitor sent to a dashboard URL lands on sign-in and returns there after signing in", async ({
  page,
  baseURL,
}) => {
  await page.goto(`${ORGANISER}?returnTo=${encodeURIComponent(ORGANISER)}`);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await signInWithStubProvider(page);

  await expect(page).toHaveURL(new RegExp(`${ORGANISER}$`));
  await expect(page.getByRole("heading", { name: "Placement cell" })).toBeVisible();

  // "same-origin only" — Review Focus 2 of the Phase 3 plan, through a
  // browser rather than the unit tests. Both halves validate it (the link
  // the app builds, and the target the callback honours), so an off-origin
  // target survives neither the round trip nor the redirect.
  await page.context().clearCookies();
  await page.goto(`${ORGANISER}?returnTo=https://evil.example/steal`);
  await signInWithStubProvider(page);
  await expect(page).toHaveURL(new RegExp(`^${baseURL}`));
});

test("the sign-in page shows only the providers the instance has configured", async ({
  page,
}) => {
  await page.goto(ORGANISER);

  // The instance configures one OIDC provider and no email sender, so
  // `identityProviders` offers exactly that one and no magic-link form.
  await expect(page.getByRole("link", { name: /continue with/i })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Continue with Stub IdP" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /send me a sign-in link/i })).toHaveCount(0);
});
