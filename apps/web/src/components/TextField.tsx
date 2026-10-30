import type { Ref } from "react";
import { Icon } from "./OrganiserShell";

// DESIGN.md's registration form, as one component: `field-label`,
// `text-input`, `field-help` and `field-error`.
//
// The only genuinely new component Phase 3 Task 9 needed. Everything else
// on the organiser screens is a button, a card or a caption that
// src/components already had — but nothing in apps/web had ever taken a
// typed character, so there was no input, no label and no error line to
// reuse.
//
// Three rules it exists to make unskippable:
//   - the label is a real <label>, always visible. "No placeholder-as-label:
//     the label must survive the field being filled."
//   - the help text is there before anything is wrong, and stays.
//   - the error carries a ⚠ glyph, so it never depends on colour, and
//     `role="alert"` so a screen reader hears it when it appears.
//
// `required` carries the same marker `RegistrationForm`'s `Marker` does —
// the `*` inside the <label>, so the accessible name is a superset of the
// visible one (WCAG 2.5.3) — plus `aria-required`, so it is announced as
// required rather than merely drawn that way.
export function TextField({
  id,
  label,
  help,
  error,
  required = false,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputRef,
}: {
  id: string;
  label: string;
  help: string;
  error?: string | undefined;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
}) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="registration-form__required"> *</span>}
      </label>
      <input
        className="text-input"
        id={id}
        ref={inputRef}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId}
        aria-invalid={error ? "true" : undefined}
        {...(required && { "aria-required": true as const })}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="field-help" id={helpId}>
        {help}
      </p>
      {error !== undefined && (
        <p className="field-error" id={errorId} role="alert">
          <Icon name="warn" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
