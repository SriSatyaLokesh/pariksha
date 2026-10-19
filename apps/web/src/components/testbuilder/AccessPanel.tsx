import { useId, useState } from "react";
import {
  describeAllowlists,
  invalidCidr,
  invalidDomainGlob,
  type AccessMode,
  type TestAccess,
} from "@pariksha/core";
import { useDialogKeys } from "./useDialogKeys";

// T-20, T-21 (Task 8, #60, P5.7): how a candidate gets in, and who is let
// through once they are.
//
// Two things make this panel more than a form. **Only the chosen mode's
// own fields exist** — switching mode emits an `access` object built from
// scratch rather than merged, because `access_code` is a legal property
// under every mode, so a stale one would survive a merge, pass the schema,
// pass `validateTest` (whose rule fires only *when* the mode is
// `link_code`), publish, and leave the workspace inside an exported file.
// And **the allowlist parsers are `@pariksha/core`'s** — the same
// `invalidCidr`/`invalidDomainGlob` the save path runs, so the browser
// refuses exactly what the server refuses rather than a weaker guess one
// package over.

const MODE_LABEL: Readonly<Record<AccessMode, string>> = {
  link_code: "Link and code",
  invite_only: "Invite only",
  email_code: "Email code",
  sso: "Single sign-on",
};

export const ACCESS_CONSEQUENCE: Readonly<Record<AccessMode, { candidate: string; organiser: string }>> = {
  link_code: {
    candidate: "Opens the public link and types the code.",
    organiser: "The link and the access code.",
  },
  invite_only: {
    candidate: "Opens their own single-use link.",
    organiser: "One personal link per candidate, from the uploaded list.",
  },
  email_code: {
    candidate: "Types their email and then the 6-digit code it receives.",
    organiser: "The link only.",
  },
  sso: {
    candidate: "Signs in with their own school or company account.",
    organiser: "The link only.",
  },
};

/** Unambiguous in a noisy room read aloud from the front: no O/0, no I/l/1.
 * Four and four, because a code people retype is read in chunks. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A code spelled out of `CODE_ALPHABET`, shown when one is too short —
 * an example an organiser can copy the shape of, which is what #60 asks
 * for and what every other refusal in this panel already offers. */
const EXAMPLE_CODE = "MATH-2847";

function freshCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length] ?? "X");
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** One entry per line, blank lines dropped — a list an organiser pastes
 * out of a spreadsheet, not a comma-separated string they have to get the
 * punctuation right in. */
function parseList(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function AccessPanel({
  access,
  onChange,
}: {
  access: TestAccess;
  onChange: (next: TestAccess) => void;
}) {
  const ids = useId();
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  // The two allowlists are edited as text and only parsed into the
  // document when every line is one the server would accept — a half-typed
  // "10.0.0.0/2" on the way to "/24" must not be stored and must not be
  // reported as a mistake either.
  const [drafts, setDrafts] = useState<{ domains?: string; ranges?: string }>({});
  const [touched, setTouched] = useState<{ domains?: true; ranges?: true; code?: true }>({});

  // #60: "a malformed … access code is caught on blur with an example of a
  // correct one" (task 7/8/10 review, M5). A nag, never a refusal — the
  // standing ruling keeps a half-typed code savable, and `validateTest`
  // owns the block at publish. Without this the organiser types "AP",
  // moves on, and meets the refusal at the end of the whole build.
  const code = access.access_code ?? "";
  const shortCode =
    touched.code === true && access.mode === "link_code" && code.trim().length < 4
      ? `An access code is at least four characters — for example ${EXAMPLE_CODE}. This one will not publish.`
      : undefined;

  const dialog = useDialogKeys<HTMLDivElement>(rotating, () => setRotating(false));

  function setMode(mode: AccessMode): void {
    // Built from scratch, never merged: every key the old mode owned is
    // gone by construction rather than by remembering to delete it.
    const next: TestAccess = { mode };
    if (access.allow_email_domains !== undefined) next.allow_email_domains = access.allow_email_domains;
    if (access.allow_ip_ranges !== undefined) next.allow_ip_ranges = access.allow_ip_ranges;
    if (access.captcha !== undefined) next.captcha = access.captcha;
    onChange(next);
  }

  function setCode(access_code: string): void {
    onChange(access_code === "" ? omit(access, "access_code") : { ...access, access_code });
  }

  function allowlist(
    which: "domains" | "ranges",
    label: string,
    key: "allow_email_domains" | "allow_ip_ranges",
    invalid: (entry: string) => string | null,
  ) {
    const stored = access[key] ?? [];
    const raw = drafts[which] ?? stored.join("\n");
    const bad = touched[which] === true ? parseList(raw).map(invalid).filter((why) => why !== null) : [];

    return (
      <div className="field">
        <label className="field-label" htmlFor={`${ids}-${which}`}>
          {label}
        </label>
        <textarea
          className="text-input"
          id={`${ids}-${which}`}
          rows={3}
          value={raw}
          onChange={(event) => {
            const value = event.target.value;
            setDrafts((prev) => ({ ...prev, [which]: value }));
            const entries = parseList(value);
            // Written through only when every line parses. A list with a
            // typo in it stays in the box, where it can be fixed, rather
            // than bouncing off the save as a 422.
            if (entries.every((entry) => invalid(entry) === null)) {
              onChange(entries.length === 0 ? omit(access, key) : { ...access, [key]: entries });
            }
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, [which]: true }))}
        />
        <p className="access-panel__fact">One per line. Leave empty to let anyone through.</p>
        {bad.map((why) => (
          <p className="access-panel__risk" role="alert" key={why}>
            <span aria-hidden="true">⚠ </span>
            {why}
          </p>
        ))}
      </div>
    );
  }

  return (
    <section className="access-panel" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Who can take this test</h2>

      <fieldset className="access-panel__group">
        <legend>How a candidate gets in</legend>
        {(Object.keys(MODE_LABEL) as AccessMode[]).map((mode) => (
          <div className="access-panel__choice" key={mode}>
            <input
              type="radio"
              id={`${ids}-mode-${mode}`}
              name={`${ids}-mode`}
              value={mode}
              checked={access.mode === mode}
              onChange={() => setMode(mode)}
            />
            <label htmlFor={`${ids}-mode-${mode}`}>{MODE_LABEL[mode]}</label>
            <p className="access-panel__fact">{ACCESS_CONSEQUENCE[mode].candidate}</p>
            <p className="access-panel__fact">
              <span className="access-panel__legend">You send: </span>
              <span>{ACCESS_CONSEQUENCE[mode].organiser}</span>
            </p>
          </div>
        ))}
      </fieldset>

      {access.mode === "link_code" && (
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-code`}>
            Access code
          </label>
          {/* Plain text, never a password field: it is read aloud to a room,
              and an organiser who cannot see it cannot check it. */}
          <input
            className="text-input"
            id={`${ids}-code`}
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, code: true }))}
          />
          {shortCode !== undefined && (
            <p className="access-panel__risk" role="alert">
              <span aria-hidden="true">⚠ </span>
              {shortCode}
            </p>
          )}
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(code).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            Copy the access code
          </button>
          <button type="button" className="button-secondary" onClick={() => setRotating(true)}>
            Rotate the access code
          </button>
          <p role="status" className="access-panel__fact">
            {copied ? "Access code copied." : ""}
          </p>
        </div>
      )}

      {access.mode === "invite_only" && (
        <p className="access-panel__fact">
          Each candidate on the list gets their own single-use link. The list itself is uploaded on the candidates
          screen.
        </p>
      )}

      {allowlist("domains", "Email domains", "allow_email_domains", invalidDomainGlob)}
      {allowlist("ranges", "IP ranges", "allow_ip_ranges", invalidCidr)}

      <div className="access-panel__choice">
        <input
          type="checkbox"
          id={`${ids}-captcha`}
          checked={access.captcha ?? true}
          onChange={(event) => onChange({ ...access, captcha: event.target.checked })}
        />
        <label htmlFor={`${ids}-captcha`}>Ask for a captcha before registration</label>
      </div>

      <p className="access-panel__summary">{describeAllowlists(access)}</p>

      {rotating && (
        <div
          role="dialog"
          aria-label="Rotate the access code"
          ref={dialog.dialogRef}
          tabIndex={-1}
          onKeyDown={dialog.onKeyDown}
        >
          <p>
            The existing code stops working the moment this is saved. The link itself keeps working — everyone who has
            it needs the new code before they can start.
          </p>
          <button type="button" className="button-secondary" onClick={() => setRotating(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              setCode(freshCode());
              setRotating(false);
            }}
          >
            Rotate it
          </button>
        </div>
      )}
    </section>
  );
}

/** Drops one optional key. `exactOptionalPropertyTypes` holds "absent" and
 * "explicitly undefined" apart, so a spread with `undefined` would store
 * the key and defeat the whole point of dropping it. */
function omit(access: TestAccess, key: keyof TestAccess): TestAccess {
  const next: Record<string, unknown> = { ...access };
  delete next[key];
  return next as unknown as TestAccess;
}
