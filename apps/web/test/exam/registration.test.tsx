import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { CONSENT_REQUIRED_MESSAGE, type RegistrationFormSpec } from "@pariksha/core";
import { ExamApp, REGISTRATION_TOKEN_KEY } from "../../src/routes/exam";
import {
  BOT_CHECK_MESSAGE,
  type AccessRequest,
  REGISTER_PENDING_MESSAGE,
  RegistrationInvalid,
  RunError,
  type AttemptPaper,
  type LandingPayload,
  type RegistrationPayload,
  type RunClient,
} from "../../src/lib/run";

// C-02 and C-03, over the candidate app's own root.
//
// **Every test here starts at `ExamApp` and clicks its way in** — Start,
// then the gate, then the form. Nothing renders `ExamRegistration`
// directly: a screen nobody can reach is a screen nobody sees, and that has
// been the top review finding three phases running.

const NOW = 1_760_000_000_000;

const form: RegistrationFormSpec = {
  title: "Before you start",
  fields: [
    { id: "full_name", type: "short_text", label: "Full name", required: true },
    { id: "roll_number", type: "short_text", label: "Roll number", required: true, unique: true },
  ],
};

const landingFixture: LandingPayload = {
  name: "Aptitude",
  description: null,
  durationMinutes: 45,
  questionCount: 1,
  sections: [{ id: "logic", title: "Logic", questionCount: 1, timeLimitMinutes: null }],
  rules: null,
  proctoring: "off",
  accessMode: "link_code",
  state: "open",
  opensAt: null,
  closesAt: null,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: { logo: null, logoAlt: null, primaryColour: null, footerText: null, startMessage: null },
  serverNow: NOW,
};

const paper: AttemptPaper = {
  attemptId: "att_1",
  sections: [
    {
      id: "logic",
      title: "Logic",
      instructions: null,
      timeLimitMinutes: null,
      questions: [
        { id: "q1", type: "short_answer", prompt: "Name the capital.", points: 1, maxLength: 200 },
      ],
    },
  ],
  responses: {},
  clientSeq: 0,
  navigation: "free",
  maxIndex: 0,
  remainingMs: 45 * 60_000,
  sectionRemainingMs: null,
  warnAtMinutes: [10, 2],
  lateSyncGraceSeconds: 30,
  allowCalculator: false,
  serverNow: NOW,
  submittedAt: null,
};

const formPayload: RegistrationPayload = { consent: null, form };

/**
 * A client whose every leg is a spy that **rejects** unless this test gave
 * it an answer. A screen that started calling something it should not reach
 * fails here rather than passing quietly.
 */
function clientFor(answers: Partial<RunClient> = {}, landing: LandingPayload = landingFixture) {
  const refuse = (what: string) => vi.fn(() => Promise.reject(new Error(`unexpected ${what}`)));
  const client: RunClient = {
    landing: vi.fn(() => Promise.resolve(landing)),
    resume: vi.fn(() => Promise.resolve(null)),
    access: refuse("access"),
    requestEmailCode: refuse("email code"),
    form: refuse("form"),
    register: refuse("register"),
    start: refuse("start"),
    putAnswer: refuse("save"),
    ...answers,
  } as RunClient;
  return client;
}

/** The app root, settled on the landing page. */
async function mount(client: RunClient) {
  const view = render(<ExamApp client={client} />);
  await screen.findByRole("heading", { level: 1 });
  return view;
}

/** Landing → Start → the registration screen. The one way in. */
async function reachRegistration(client: RunClient) {
  const view = await mount(client);
  fireEvent.click(screen.getByRole("button", { name: /^start/i }));
  await screen.findByRole("heading", { level: 1, name: /register for aptitude/i });
  return view;
}

const type = (label: RegExp, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, "", "/alpha/aptitude");
});

afterEach(() => {
  document.documentElement.style.fontSize = "";
});

// --- the walk ------------------------------------------------------------

it("C-03: gate, consent, form, register, start — the whole walk from the landing page", async () => {
  const access = vi.fn(() => Promise.resolve({ entryToken: "ent_1" }));
  const register = vi.fn(() => Promise.resolve({ registrationToken: "reg_1" }));
  const start = vi.fn(() => Promise.resolve(paper));
  const client = clientFor({
    access,
    form: vi.fn(() =>
      Promise.resolve({ consent: { version: "v2", text: "Your answers are recorded." }, form }),
    ),
    register,
    start,
  });

  await reachRegistration(client);

  type(/access code/i, "OPENSESAME");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));

  // The consent text is rendered above the form, and the form is the one
  // registration renderer — these are its fields, by their own labels.
  expect(await screen.findByText(/your answers are recorded/i)).toBeVisible();
  type(/full name/i, "Ravi Kumar");
  type(/roll number/i, "21CS0147");
  fireEvent.click(screen.getByLabelText(/i have read and accept this/i));
  fireEvent.click(screen.getByRole("button", { name: /register and start/i }));

  // The paper, which is only reachable through `/start` with the token
  // `/register` minted.
  expect(await screen.findByText("Name the capital.")).toBeVisible();
  expect(register).toHaveBeenCalledWith("ent_1", {
    full_name: "Ravi Kumar",
    roll_number: "21CS0147",
    consent: true,
  });
  expect(start).toHaveBeenCalledWith("reg_1");
  // Stored, so a reload between registering and the paper does not cost a
  // candidate their place.
  expect(sessionStorage.getItem(REGISTRATION_TOKEN_KEY)).toBe("reg_1");
});

it("the gate sends what the candidate filled in and nothing else", async () => {
  let sent: AccessRequest | null = null;
  const access = vi.fn((input: AccessRequest) => {
    sent = input;
    return Promise.resolve({ entryToken: "ent_1" });
  });
  const client = clientFor({ access, form: vi.fn(() => Promise.resolve(formPayload)) });
  await reachRegistration(client);

  type(/access code/i, "OPENSESAME");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByLabelText(/full name/i);

  // Keys, not a `toEqual`: `toHaveBeenCalledWith` and `toEqual` both treat
  // `{ identifier: undefined }` as equal to `{}`, so a gate that posted an
  // empty identifier would pass either of them.
  expect(Object.keys(sent ?? {})).toEqual(["code"]);
});

it("T-21: a candidate list identity is typed at the gate and travels with the code", async () => {
  const access = vi.fn(() => Promise.resolve({ entryToken: "ent_1" }));
  const client = clientFor({ access, form: vi.fn(() => Promise.resolve(formPayload)) });
  await reachRegistration(client);

  type(/access code/i, "OPENSESAME");
  type(/roll number or ID/i, "21CS0147");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByLabelText(/full name/i);

  expect(access).toHaveBeenCalledWith({ code: "OPENSESAME", identifier: "21CS0147" });
});

// --- the four modes ------------------------------------------------------

it("email_code: asking for the code and spending it are two steps on one screen", async () => {
  const requestEmailCode = vi.fn(() => Promise.resolve());
  const access = vi.fn(() => Promise.resolve({ entryToken: "ent_1" }));
  const client = clientFor(
    { requestEmailCode, access, form: vi.fn(() => Promise.resolve(formPayload)) },
    { ...landingFixture, accessMode: "email_code" },
  );
  await reachRegistration(client);

  expect(screen.queryByLabelText(/access code/i)).toBeNull();
  type(/email address/i, "ravi@college.ac.in");
  fireEvent.click(screen.getByRole("button", { name: /email me a code/i }));
  expect(requestEmailCode).toHaveBeenCalledWith("ravi@college.ac.in");
  // Announced, not merely drawn: a candidate waiting on an inbox is told
  // the request went.
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent(/on its way/i);
  });

  type(/code from your email/i, "483920");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByLabelText(/full name/i);
  expect(access).toHaveBeenCalledWith({ email: "ravi@college.ac.in", otp: "483920" });
});

it("invite_only: the invite is read out of the link, never typed", async () => {
  window.history.replaceState({}, "", "/alpha/aptitude?invite=inv_abc");
  const access = vi.fn(() => Promise.resolve({ entryToken: "ent_1" }));
  const client = clientFor(
    { access, form: vi.fn(() => Promise.resolve(formPayload)) },
    { ...landingFixture, accessMode: "invite_only" },
  );
  await reachRegistration(client);

  await screen.findByLabelText(/full name/i);
  expect(access).toHaveBeenCalledWith({ invite: "inv_abc" });
  // Exactly once: the token is single-use, and a second redemption answers
  // `invite_used` to a candidate who pressed nothing.
  expect(access).toHaveBeenCalledTimes(1);
});

it("invite_only without the link says what to do instead of refusing silently", async () => {
  const access = vi.fn(() => Promise.resolve({ entryToken: "ent_1" }));
  const client = clientFor({ access }, { ...landingFixture, accessMode: "invite_only" });
  await reachRegistration(client);

  expect(await screen.findByRole("alert")).toHaveTextContent(/invite link your organiser sent you/i);
  expect(access).not.toHaveBeenCalled();
});

it("sso: continuing is a real navigation to the candidate's own callback", async () => {
  const client = clientFor({}, { ...landingFixture, accessMode: "sso" });
  await reachRegistration(client);

  const link = screen.getByRole("link", { name: /sign in to continue/i });
  expect(link).toHaveAttribute("href", "/api/v1/run/alpha/aptitude/sso/start");
  // No form to submit: the gate for this mode is the provider's.
  expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
});

it("sso's return carries the entry token in the URL, and the gate is skipped", async () => {
  window.history.replaceState({}, "", "/alpha/aptitude?entry=ent_sso");
  const form = vi.fn(() => Promise.resolve(formPayload));
  const access = vi.fn(() => Promise.resolve({ entryToken: "never" }));
  const client = clientFor({ form, access }, { ...landingFixture, accessMode: "sso" });

  // No Start press: a candidate who has just signed in is already past the
  // gate, so the app opens registration on its own.
  render(<ExamApp client={client} />);
  expect(await screen.findByLabelText(/full name/i)).toBeVisible();
  expect(form).toHaveBeenCalledWith("ent_sso");
  expect(access).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
});

// --- T-14 re-entry -------------------------------------------------------

it("T-14: a candidate who has already registered is not asked to consent again", async () => {
  const start = vi.fn(() => Promise.resolve(paper));
  const register = vi.fn(() => Promise.resolve({ registrationToken: "never" }));
  const client = clientFor({
    access: vi.fn(() => Promise.resolve({ entryToken: "ent_1" })),
    form: vi.fn(() =>
      Promise.resolve({
        consent: { version: "v2", text: "Your answers are recorded." },
        form,
        registered: true,
        registrationToken: "reg_again",
      }),
    ),
    register,
    start,
  });
  await reachRegistration(client);

  type(/access code/i, "OPENSESAME");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));

  expect(await screen.findByText("Name the capital.")).toBeVisible();
  expect(start).toHaveBeenCalledWith("reg_again");
  expect(register).not.toHaveBeenCalled();
  expect(screen.queryByText(/your answers are recorded/i)).toBeNull();
});

// --- refusals ------------------------------------------------------------

it("a refused code shows the server's own sentence and keeps the gate", async () => {
  const client = clientFor({
    access: vi.fn(() =>
      Promise.reject(new RunError(403, "code_wrong", "Check the code on your invitation.")),
    ),
  });
  await reachRegistration(client);

  type(/access code/i, "OPENSESAME");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Check the code on your invitation.");
  expect(screen.getByLabelText(/access code/i)).toBeVisible();
  // Never a status code, and never a sentence this screen wrote.
  expect(screen.queryByText(/403/)).toBeNull();
});

it("a spent entry token sends the candidate back to the gate with the reason", async () => {
  const client = clientFor({
    access: vi.fn(() => Promise.resolve({ entryToken: "ent_1" })),
    form: vi.fn(() =>
      Promise.reject(
        new RunError(410, "entry_expired", "This registration link is no longer valid."),
      ),
    ),
  });
  await reachRegistration(client);

  type(/access code/i, "OPENSESAME");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/no longer valid/i);
  expect(screen.getByLabelText(/access code/i)).toBeVisible();
});

it("a proof of work that could not run says so in the one sentence written for it", async () => {
  const client = clientFor({
    access: vi.fn(() => Promise.resolve({ entryToken: "ent_1" })),
    form: vi.fn(() => Promise.resolve(formPayload)),
    // A different sentence from the constant, so a screen that showed
    // `error.message` instead would fail here.
    register: vi.fn(() => Promise.reject(new RunError(403, "bot_check_failed", "nope"))),
  });
  await reachRegistration(client);

  type(/access code/i, "OPENSESAME");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByLabelText(/full name/i);
  type(/full name/i, "Ravi Kumar");
  type(/^Roll number/, "21CS0147");
  fireEvent.click(screen.getByRole("button", { name: /register and start/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(BOT_CHECK_MESSAGE);
});

// --- validation ----------------------------------------------------------

/** Gate passed, form on screen. */
async function reachForm(overrides: Partial<RunClient> = {}, payload = formPayload) {
  const client = clientFor({
    access: vi.fn(() => Promise.resolve({ entryToken: "ent_1" })),
    form: vi.fn(() => Promise.resolve(payload)),
    ...overrides,
  });
  const view = await reachRegistration(client);
  type(/access code/i, "OPENSESAME");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByLabelText(/full name/i);
  return view;
}

it("a blank required field costs no round trip, and the first one takes focus", async () => {
  const register = vi.fn(() => Promise.resolve({ registrationToken: "never" }));
  await reachForm({ register });

  fireEvent.click(screen.getByRole("button", { name: /register and start/i }));

  // `@pariksha/core`'s own sentence, from the same `validateRegistration`
  // the server runs, and beside the field it belongs to.
  expect(
    await within(screen.getByLabelText(/full name/i).closest("div") as HTMLElement).findByText(
      /this answer is required/i,
    ),
  ).toBeVisible();
  expect(register).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(screen.getByLabelText(/full name/i)).toHaveFocus();
  });
});

it("S-12: consent is required before submit, and the box says why", async () => {
  const register = vi.fn(() => Promise.resolve({ registrationToken: "never" }));
  await reachForm(
    { register },
    { consent: { version: "v2", text: "Your answers are recorded." }, form },
  );

  type(/full name/i, "Ravi Kumar");
  type(/^Roll number/, "21CS0147");
  fireEvent.click(screen.getByRole("button", { name: /register and start/i }));

  expect(await screen.findByText(CONSENT_REQUIRED_MESSAGE)).toBeVisible();
  expect(register).not.toHaveBeenCalled();
  // The first invalid control, which is the consent box above the form.
  await waitFor(() => {
    expect(screen.getByLabelText(/i have read and accept this/i)).toHaveFocus();
  });
});

it("AC-12: the server's 422 goes back on the fields it named", async () => {
  const register = vi.fn(() =>
    Promise.reject(
      new RegistrationInvalid("Some answers need another look.", [
        {
          field: "roll_number",
          code: "already_registered",
          message: "Someone has already registered with that.",
        },
      ]),
    ),
  );
  await reachForm({ register });

  type(/full name/i, "Ravi Kumar");
  type(/^Roll number/, "21CS0147");
  fireEvent.click(screen.getByRole("button", { name: /register and start/i }));

  // Positioned on its own field — found through the input's own accessible
  // description, not by searching the page for the text.
  await waitFor(() => {
    expect(screen.getByLabelText(/^Roll number/)).toHaveAccessibleDescription(
      /someone has already registered/i,
    );
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Some answers need another look.");
  expect(screen.getByLabelText(/^Roll number/)).toHaveFocus();
  // The local pass let this through, so the refusal is the server's.
  expect(register).toHaveBeenCalledTimes(1);
});

it("correcting a field clears its error without stealing the caret", async () => {
  await reachForm({ register: vi.fn(() => Promise.resolve({ registrationToken: "never" })) });

  fireEvent.click(screen.getByRole("button", { name: /register and start/i }));
  // `@pariksha/core`'s own sentence, beside the field it belongs to.
  expect(
    await within(screen.getByLabelText(/full name/i).closest("div") as HTMLElement).findByText(
      /this answer is required/i,
    ),
  ).toBeVisible();

  const roll = screen.getByLabelText(/^Roll number/);
  roll.focus();
  fireEvent.change(roll, { target: { value: "21CS0147" } });
  expect(screen.getAllByText(/this answer is required/i)).toHaveLength(1);
  // The focus effect is keyed on refusals, not on `errors` — typing here
  // must not throw the caret back to the full-name box.
  expect(roll).toHaveFocus();
});

// --- the pending state ---------------------------------------------------

it("the submit is disabled and the wait is announced for the whole round trip", async () => {
  let settle: (answer: { registrationToken: string }) => void = () => undefined;
  const register = vi.fn(
    () =>
      new Promise<{ registrationToken: string }>((resolve) => {
        settle = resolve;
      }),
  );
  const start = vi.fn(() => Promise.resolve(paper));
  await reachForm({ register, start });

  type(/full name/i, "Ravi Kumar");
  type(/^Roll number/, "21CS0147");
  const submit = screen.getByRole("button", { name: /register and start/i });
  fireEvent.click(submit);

  await waitFor(() => {
    expect(submit).toBeDisabled();
  });
  expect(screen.getByRole("status")).toHaveTextContent(REGISTER_PENDING_MESSAGE);
  // The fields go with it: a value changed mid-solve is not in the
  // submission the server is already checking.
  expect(screen.getByLabelText(/full name/i)).toBeDisabled();

  settle({ registrationToken: "reg_1" });
  expect(await screen.findByText("Name the capital.")).toBeVisible();
  expect(start).toHaveBeenCalledWith("reg_1");
});

// --- accessibility -------------------------------------------------------

it("the gate has no axe violations, at 100% and at 200% zoom", async () => {
  const { container } = await reachRegistration(clientFor({}));
  // Not vacuous: axe over an empty container passes, so the thing being
  // audited is asserted present first.
  expect(within(container).getByLabelText(/access code/i)).toBeVisible();
  expect(await axe(container)).toHaveNoViolations();
  document.documentElement.style.fontSize = "32px";
  expect(await axe(container)).toHaveNoViolations();
});

it("the consent block and the form have no axe violations, at 100% and at 200% zoom", async () => {
  const { container } = await reachForm(
    {},
    { consent: { version: "v2", text: "Your answers are recorded." }, form },
  );
  expect(within(container).getByLabelText(/i have read and accept this/i)).toBeVisible();
  expect(within(container).getByLabelText(/^Roll number/)).toBeVisible();
  expect(await axe(container)).toHaveNoViolations();
  document.documentElement.style.fontSize = "32px";
  expect(await axe(container)).toHaveNoViolations();
});

it("WCAG 2.5.3: the submit's accessible name is a superset of its visible label", async () => {
  await reachForm();
  const submit = screen.getByRole("button", { name: "Register and start Aptitude" });
  expect(submit.textContent?.trim()).toBe("Register and start");
  expect(submit).toHaveAccessibleName(/register and start/i);
});

it("every control on the gate is a focusable native control in reading order", async () => {
  await reachRegistration(clientFor({}));
  const gate = screen.getByRole("button", { name: /continue/i }).closest("form");
  const controls = within(gate as HTMLElement).getAllByRole("textbox");
  expect(controls.map((control) => control.tagName)).toEqual(["INPUT", "INPUT"]);
  for (const control of controls) expect(control).not.toHaveAttribute("tabindex");
  controls[0]?.focus();
  expect(controls[0]).toHaveFocus();
});
