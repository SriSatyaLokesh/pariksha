import { useRef, useState, type FormEvent } from "react";
import { CardHairline } from "../components/CardHairline";
import { ButtonSecondary } from "../components/ButtonSecondary";
import { ScreenSplit } from "../components/organiser/ScreenSplit";
import { TextField } from "../components/TextField";
import {
  ApiError,
  signInUrl,
  type ApiClient,
  type IdentityProvider,
} from "../lib/api";

// Screen 1 of 3. The providers come from GET /api/v1/setup/status and are
// rendered verbatim: an instance that configures only Google shows only
// Google, and one that configures nothing says so rather than offering a
// form that cannot work.

const EMAIL_HELP =
  "We send a single-use link that signs you in on this device.";
const EMAIL_ERROR =
  "An email address looks like name@college.edu — one @, then a domain.";
const PASSWORD_ERROR =
  "Please enter your password.";

export function SignIn({
  client,
  providers,
  returnTo,
}: {
  client: ApiClient;
  providers: IdentityProvider[];
  returnTo: string | null | undefined;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [useMagicLink, setUseMagicLink] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);

  const redirecting = providers.filter((p) => p.kind !== "magic_link" && p.kind !== "password");
  const magicLink = providers.find((p) => p.kind === "magic_link");
  const passwordProvider = providers.find((p) => p.kind === "password");

  async function onMagicLinkSubmit(event: FormEvent) {
    event.preventDefault();
    setSentTo(undefined);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(EMAIL_ERROR);
      emailRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await client.requestMagicLink(email);
      setSentTo(email);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "The sign-in link could not be sent. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(EMAIL_ERROR);
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setError(PASSWORD_ERROR);
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (client.signInWithPassword) {
        const res = await client.signInWithPassword(email, password, undefined, returnTo ?? undefined);
        if (res.status === "totp_required") {
          setTotpRequired(true);
          setBusy(false);
          return;
        }
        window.location.assign(res.returnTo ?? returnTo ?? "/");
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Invalid email or password. Please try again.",
      );
      setBusy(false);
    }
  }

  async function onTotpSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError("Please enter the 6-digit verification code.");
      totpRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (client.signInWithPassword) {
        const res = await client.signInWithPassword(email, password, totpCode.trim(), returnTo ?? undefined);
        window.location.assign(res.returnTo ?? returnTo ?? "/");
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Invalid two-factor authentication code. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <ScreenSplit headline="Exams your institution runs, on infrastructure your institution owns.">
      <h1 className="organiser__title">Sign in</h1>
      <p className="organiser__lead">
        Organisers sign in here. Candidates do not need an account — their
        invitation carries everything they need.
      </p>

      <CardHairline className="organiser__panel">
        {providers.length === 0 && (
          <p className="organiser__notice">
            No sign-in method is configured on this instance. Someone with
            access to the server has to configure an identity provider before
            anyone can sign in.
          </p>
        )}

        {redirecting.length > 0 && !totpRequired && (
          <div className="organiser-providers">
            {redirecting.map((provider) => (
              <ButtonSecondary
                key={provider.id}
                href={signInUrl(provider.id, returnTo)}
              >
                Continue with {provider.label}
              </ButtonSecondary>
            ))}
          </div>
        )}

        {redirecting.length > 0 && (passwordProvider || magicLink) && !totpRequired && (
          <hr className="organiser-divider" />
        )}

        {totpRequired ? (
          <form
            className="organiser-form"
            onSubmit={(event) => void onTotpSubmit(event)}
            noValidate
          >
            <p className="field-help">
              Two-factor authentication is enabled for your account. Enter the 6-digit code from your authenticator app.
            </p>
            <TextField
              id="signin-totp"
              type="text"
              label="Two-factor verification code"
              help="Enter the 6-digit code from your authenticator app"
              error={error}
              value={totpCode}
              onChange={setTotpCode}
              autoComplete="one-time-code"
              inputRef={totpRef}
            />
            <button
              type="submit"
              className="button-primary button-primary--surface"
              disabled={busy}
            >
              Verify & sign in
            </button>
            <button
              type="button"
              className="button-secondary button-secondary--surface"
              onClick={() => {
                setTotpRequired(false);
                setTotpCode("");
                setError(undefined);
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : passwordProvider && !useMagicLink ? (
          <form
            className="organiser-form"
            onSubmit={(event) => void onPasswordSubmit(event)}
            noValidate
          >
            <TextField
              id="signin-email"
              type="email"
              label="Email address"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              inputRef={emailRef}
            />
            <TextField
              id="signin-password"
              type="password"
              label="Password"
              error={error}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              inputRef={passwordRef}
            />
            <button
              type="submit"
              className="button-primary button-primary--surface"
              disabled={busy}
            >
              Sign in
            </button>
            {magicLink && (
              <button
                type="button"
                className="button-secondary button-secondary--surface"
                onClick={() => {
                  setUseMagicLink(true);
                  setError(undefined);
                }}
              >
                Email me a sign-in link instead
              </button>
            )}
          </form>
        ) : magicLink !== undefined ? (
          <form
            className="organiser-form"
            onSubmit={(event) => void onMagicLinkSubmit(event)}
            noValidate
          >
            <TextField
              id="signin-email"
              type="email"
              label="Email address"
              help={EMAIL_HELP}
              error={error}
              value={email}
              onChange={setEmail}
              autoComplete="email"
              inputRef={emailRef}
            />
            <button
              type="submit"
              className="button-primary button-primary--surface"
              disabled={busy}
            >
              Send me a sign-in link
            </button>
            {passwordProvider && (
              <button
                type="button"
                className="button-secondary button-secondary--surface"
                onClick={() => {
                  setUseMagicLink(false);
                  setError(undefined);
                }}
              >
                Sign in with password instead
              </button>
            )}
            {sentTo !== undefined && (
              <p className="organiser__status" role="status">
                A sign-in link is on its way to {sentTo}. It can be used once.
              </p>
            )}
          </form>
        ) : null}
      </CardHairline>
    </ScreenSplit>
  );
}
