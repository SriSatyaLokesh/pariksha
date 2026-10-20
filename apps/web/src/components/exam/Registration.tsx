import { useEffect, useRef, useState, type FormEvent } from "react";
import { CONSENT_KEY, CONSENT_REQUIRED_MESSAGE } from "@pariksha/core";
import { RegistrationForm, validateForm } from "../testbuilder/RegistrationForm";
import { RenderedHtml } from "../authoring/RenderedHtml";
import { TextField } from "../TextField";
import {
  BOT_CHECK_MESSAGE,
  REGISTER_PENDING_MESSAGE,
  RegistrationInvalid,
  RunError,
  slugPairFromPath,
  type AccessRequest,
  type LandingPayload,
  type RegistrationPayload,
  type RunClient,
} from "../../lib/run";

// C-02 and the registration half of C-03: the screen between the landing
// page's Start and `/start`. Access gate, consent, form, register, hand the
// token back.
//
// **Nothing here is a second implementation of anything.** The form is
// `components/testbuilder/RegistrationForm` — the one registration renderer
// (ADR 0004's shape), the same component the builder's preview mounts — the
// rules are `@pariksha/core`'s `validateRegistration` through its
// `validateForm` adapter, and every refusal sentence on this screen was
// written by the server. The browser's copy of a rule is a courtesy
// (`docs/test-format.md:110`): it saves a candidate a round trip and a
// proof of work on a form that is visibly incomplete, and the server's
// answer wins wherever the two disagree.

/** A token the URL carries: `?invite=` on an invite link (`T-20`), and
 *  `?entry=` where the SSO callback redirects back to. Read rather than
 *  typed — a candidate should never be asked to copy a token. */
export function tokenFromUrl(name: string, search: string = window.location.search): string | null {
  return new URLSearchParams(search).get(name);
}

/** The gate's own copy, for the one state no request can answer: an
 *  `invite_only` test opened without the link. */
const NO_INVITE = "Open the invite link your organiser sent you.";

/** The courtesy copy of `listEntry`'s own rule. The server still decides;
 *  this saves a candidate a round trip that would come back as
 *  `code_wrong` — the same bytes a wrong access code gets, so without it
 *  the refusal says their correct code is the thing that is wrong. */
const IDENTIFIER_REQUIRED = "Enter the roll number or ID your organiser listed you under.";

/** Which legs the gate shows. The server decides whether what was sent was
 *  enough (`S-10` keeps a refusal from saying which half was wrong); this
 *  only decides what to put in front of the candidate. */
const GATE_HELP: Readonly<Record<LandingPayload["accessMode"], string>> = {
  link_code: "The access code your organiser sent you.",
  invite_only: "This test is opened from a personal invite link.",
  email_code: "We email a single-use code to this address.",
  sso: "This test uses your organisation's sign-in.",
};

export function ExamRegistration({
  test,
  client,
  entry,
  onRegistered,
}: {
  test: LandingPayload;
  client: RunClient;
  /** An entry token the URL already carries — the SSO callback's. When it
   *  is set the gate has already been passed and is skipped. */
  entry: string | null;
  onRegistered: (registrationToken: string) => void;
}) {
  const mode = test.accessMode;

  // --- the gate ---------------------------------------------------------
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);

  /**
   * `T-21`: a test whose organiser uploaded a candidate list admits only
   * identities on it, and the identifier is typed at the gate because the
   * gate runs before the form is shown. Required when the test says so,
   * absent when it does not — never the optional middle, which is what
   * locked a listed candidate out of their own exam: the UI called the
   * field optional and `listEntry` refused the blank with `code_wrong`.
   */
  const needsIdentifier = test.candidateList && (mode === "link_code" || mode === "email_code");

  // --- the screen -------------------------------------------------------
  const [stage, setStage] = useState<
    | { kind: "gate" }
    | { kind: "opening" }
    | { kind: "form"; entryToken: string; payload: RegistrationPayload }
  >(entry === null && mode !== "invite_only" ? { kind: "gate" } : { kind: "opening" });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * Bumped only by a refused submit, never by an edit.
   *
   * WCAG 3.3.1 wants the first invalid field focused when a submit fails,
   * and keying that off `errors` instead would move the caret out of the
   * field a candidate is still typing in the moment their edit clears an
   * error — the opposite of help, on a screen with a clock behind it.
   */
  const [refusedAt, setRefusedAt] = useState(0);

  useEffect(() => {
    if (refusedAt === 0) return;
    // The renderer puts `aria-invalid` on the control it rejected (and on
    // the <fieldset> of a radio or checkbox group, which is not focusable —
    // hence the descent). Document order, so the consent box above the form
    // comes first, which is also the order a candidate reads.
    const invalid = panelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const control =
      invalid?.matches("input, select, textarea") === true
        ? invalid
        : (invalid?.querySelector<HTMLElement>("input, select, textarea") ?? null);
    control?.focus();
  }, [refusedAt]);

  const sentenceOf = (error: unknown): string =>
    error instanceof Error ? error.message : "This test could not be opened.";

  /** Spend an entry token: fetch consent and the form, or skip both when
   *  the gate recognised somebody who has already registered (`T-14`). */
  async function openForm(entryToken: string): Promise<void> {
    setStage({ kind: "opening" });
    try {
      const payload = await client.form(entryToken);
      // A second allowed attempt, a lost cookie, another device. The token
      // `/start` spends arrives in this same payload, and a candidate who
      // has already consented is not asked to consent again.
      if (payload.registered === true && payload.registrationToken !== undefined) {
        onRegistered(payload.registrationToken);
        return;
      }
      setNotice(null);
      setValues({});
      setErrors({});
      setStage({ kind: "form", entryToken, payload });
    } catch (error) {
      // 410 `entry_expired` among others: the token is single-use and
      // short-lived, so the way out is the gate, with the server's own
      // sentence above it.
      setNotice(sentenceOf(error));
      setStage({ kind: "gate" });
    }
  }

  async function passGate(input: AccessRequest): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const { entryToken } = await client.access(input);
      await openForm(entryToken);
    } catch (error) {
      setNotice(sentenceOf(error));
      setStage({ kind: "gate" });
    } finally {
      setBusy(false);
    }
  }

  /**
   * The two entries that need no typing, run once.
   *
   * The ref is not ceremony: `StrictMode` invokes an effect twice in
   * development and both the invite and the entry token are single-use, so
   * the second pass would spend the candidate's link and refuse them with
   * `invite_used` on a screen they had not touched.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (entry !== null) {
      void openForm(entry);
      return;
    }
    if (mode !== "invite_only") return;
    const invite = tokenFromUrl("invite");
    if (invite === null) {
      setNotice(NO_INVITE);
      setStage({ kind: "gate" });
      return;
    }
    void passGate({ invite });
    // Mount only, and deliberately: both tokens are spent here, and
    // nothing re-reads them.
  }, []);

  function change(id: string, value: unknown): void {
    setValues((previous) => ({ ...previous, [id]: value }));
    setErrors((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }

  function submitGate(event: FormEvent): void {
    event.preventDefault();
    // The one thing this screen may decide for itself, because the test
    // told it: an identifier this test requires and the candidate left
    // blank. Everything below is still the server's call.
    if (needsIdentifier && identifier.trim() === "") {
      setIdentifierError(IDENTIFIER_REQUIRED);
      // Same effect the form's refusal uses, so WCAG 3.3.1's "focus the
      // first invalid field" holds on the gate too.
      setRefusedAt((seq) => seq + 1);
      return;
    }
    // Only what the candidate filled in. Which of these was needed is the
    // server's decision, not this file's.
    const input: AccessRequest = {};
    if (code.trim() !== "") input.code = code;
    if (email.trim() !== "") input.email = email;
    if (otp.trim() !== "") input.otp = otp;
    if (identifier.trim() !== "") input.identifier = identifier;
    void passGate(input);
  }

  function sendEmailCode(): void {
    setBusy(true);
    setNotice(null);
    client
      .requestEmailCode(email)
      .then(() => {
        setEmailed(true);
      })
      .catch((error: unknown) => {
        setNotice(sentenceOf(error));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function submitForm(event: FormEvent): void {
    event.preventDefault();
    if (stage.kind !== "form") return;
    const { entryToken, payload } = stage;

    // The courtesy copy of the rules — one round trip and one proof of work
    // that a blank required field does not have to cost.
    const found = validateForm(payload.form, values);
    if (payload.consent !== null && values[CONSENT_KEY] !== true) {
      found[CONSENT_KEY] = CONSENT_REQUIRED_MESSAGE;
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setRefusedAt((seq) => seq + 1);
      return;
    }

    setErrors({});
    setNotice(null);
    setPending(true);
    client
      .register(entryToken, values)
      .then(({ registrationToken }) => {
        onRegistered(registrationToken);
      })
      .catch((error: unknown) => {
        if (error instanceof RegistrationInvalid) {
          // The same `FieldIssue[]` shape `validateRegistration` produces
          // here, so the server's answer goes back on the fields through
          // the one renderer's own `errors` prop.
          setErrors(Object.fromEntries(error.issues.map((issue) => [issue.field, issue.message])));
          setNotice(error.message);
          setRefusedAt((seq) => seq + 1);
          return;
        }
        if (error instanceof RunError && error.code === "bot_check_failed") {
          setNotice(BOT_CHECK_MESSAGE);
          return;
        }
        if (error instanceof RunError && error.status === 410) {
          setNotice(error.message);
          setStage({ kind: "gate" });
          return;
        }
        setNotice(sentenceOf(error));
      })
      .finally(() => {
        setPending(false);
      });
  }

  const ssoUrl = (): string => {
    const slugs = slugPairFromPath(window.location.pathname);
    if (!slugs) return "#";
    return `/api/v1/run/${encodeURIComponent(slugs.workspaceSlug)}/${encodeURIComponent(slugs.testSlug)}/sso/start`;
  };

  return (
    <main className="exam-register">
      <h1>Register for {test.name}</h1>

      {/* Present from first render rather than inserted with its content: a
          live region a screen reader has never seen is a live region it
          does not announce. Every sentence in it is the server's own. */}
      <p className="exam-register-notice" role="alert">
        {notice ?? ""}
      </p>

      <div className="exam-register-panel" ref={panelRef}>
        {stage.kind === "opening" && (
          <p className="exam-register-status" role="status">
            Checking…
          </p>
        )}

        {stage.kind === "gate" && (
          <form className="exam-register-form" onSubmit={submitGate} noValidate>
            <h2>{GATE_HELP[mode]}</h2>

            {mode === "link_code" && (
              <TextField
                id="exam-access-code"
                label="Access code"
                help="The code is on your invitation. Spaces at either end do not matter."
                value={code}
                onChange={setCode}
                autoComplete="off"
              />
            )}

            {mode === "email_code" && (
              <>
                <TextField
                  id="exam-access-email"
                  label="Email address"
                  help="We send a single-use code to this address."
                  type="email"
                  value={email}
                  onChange={setEmail}
                  autoComplete="email"
                />
                <button
                  type="button"
                  className="exam-register-secondary"
                  onClick={sendEmailCode}
                  disabled={busy || email.trim() === ""}
                >
                  Email me a code
                </button>
                {/* Two steps, one screen: the code box is here from the
                    start, so a candidate who already has a code from an
                    earlier try is not made to ask for a second one. */}
                <TextField
                  id="exam-access-otp"
                  label="Code from your email"
                  help="Six characters. It can be used once."
                  value={otp}
                  onChange={setOtp}
                  autoComplete="one-time-code"
                />
                <p className="exam-register-status" role="status">
                  {emailed ? `If ${email} is expected on this test, a code is on its way to it.` : ""}
                </p>
              </>
            )}

            {needsIdentifier && (
              <TextField
                id="exam-access-identifier"
                label="Roll number or ID"
                required
                help="This test admits only the candidates its organiser listed. Use the identifier they listed you under."
                value={identifier}
                error={identifierError ?? undefined}
                onChange={(next) => {
                  setIdentifier(next);
                  setIdentifierError(null);
                }}
                autoComplete="off"
              />
            )}

            {mode === "sso" ? (
              <a className="exam-register-submit" href={ssoUrl()}>
                Sign in to continue
              </a>
            ) : mode === "invite_only" ? null : (
              <button type="submit" className="exam-register-submit" disabled={busy}>
                Continue
              </button>
            )}
          </form>
        )}

        {stage.kind === "form" && (
          <>
            {stage.payload.consent !== null && (
              <section className="exam-consent" aria-labelledby="exam-consent-heading">
                <h2 id="exam-consent-heading">Before you register</h2>
                {/* `TestConsent.text` is Markdown, through the one
                    `dangerouslySetInnerHTML` site in the application. */}
                <RenderedHtml markdown={stage.payload.consent.text} />
                <label className="registration-form__choice" htmlFor="exam-consent-accept">
                  <input
                    id="exam-consent-accept"
                    type="checkbox"
                    checked={values[CONSENT_KEY] === true}
                    disabled={pending}
                    aria-required={true}
                    {...(errors[CONSENT_KEY] !== undefined && {
                      "aria-invalid": true as const,
                      "aria-describedby": "exam-consent-error",
                    })}
                    onChange={(event) => {
                      change(CONSENT_KEY, event.target.checked);
                    }}
                  />
                  I have read and accept this.
                  <span className="registration-form__required"> *</span>
                </label>
                {errors[CONSENT_KEY] !== undefined && (
                  <p className="registration-form__error" id="exam-consent-error">
                    <span aria-hidden="true">⚠</span> {errors[CONSENT_KEY]}
                  </p>
                )}
              </section>
            )}

            <form className="exam-register-form" onSubmit={submitForm} noValidate>
              <RegistrationForm
                form={stage.payload.form}
                values={values}
                errors={errors}
                onChange={change}
                disabled={pending}
              />
              {/* WCAG 2.5.3: the accessible name is a superset of the
                  visible label. "Register and start" is what the eye wants;
                  a screen-reader user who arrives out of context hears what
                  they are starting. */}
              <button
                type="submit"
                className="exam-register-submit"
                aria-label={`Register and start ${test.name}`}
                disabled={pending}
              >
                Register and start
              </button>
              {/* Mandatory, and the reason it is: submitting is a round
                  trip, then a proof of work, then a second round trip —
                  desktop p90 is a second and a phone has never been
                  measured. A control that looks dead for that long before a
                  timed exam is pressed again. */}
              <p className="exam-register-status" role="status">
                {pending ? REGISTER_PENDING_MESSAGE : ""}
              </p>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
