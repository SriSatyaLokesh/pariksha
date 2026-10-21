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
//
// docs/design.md is silent here — its twelve-screen inventory is Phases 4
// and 5, authoring only — so the visual brief is the paragraph under that
// inventory ("cream and ink surfaces, hairline rules... voltage reserved
// for the primary action and the focus ring") plus DESIGN.md's registration
// form. No full-bleed voltage block, by that paragraph's own instruction.

// The error names the shape a real address has. Never "Invalid format".
const EMAIL_HELP =
  "We send a single-use link that signs you in on this device.";
const EMAIL_ERROR =
  "An email address looks like name@college.edu — one @, then a domain.";

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
  const [error, setError] = useState<string | undefined>(undefined);
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const redirecting = providers.filter((p) => p.kind !== "magic_link");
  const magicLink = providers.find((p) => p.kind === "magic_link");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSentTo(undefined);
    // One @ with something either side of it, and a dot in the domain. A
    // stricter client-side test than this rejects addresses that work.
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

  return (
    // `D18`: the split screen. The brand half is the same on both arrival
    // screens; the headline is this moment and nothing else.
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

        {redirecting.length > 0 && (
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

        {redirecting.length > 0 && magicLink !== undefined && (
          <hr className="organiser-divider" />
        )}

        {magicLink !== undefined && (
          <form
            className="organiser-form"
            onSubmit={(event) => void onSubmit(event)}
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
            {sentTo !== undefined && (
              <p className="organiser__status" role="status">
                A sign-in link is on its way to {sentTo}. It can be used once.
              </p>
            )}
          </form>
        )}
      </CardHairline>
    </ScreenSplit>
  );
}
