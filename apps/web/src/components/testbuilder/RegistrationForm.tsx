import { useId } from "react";
import {
  assertSafeRegex,
  type FormField,
  type FormFieldType,
  type RegistrationFormSpec,
} from "@pariksha/core";

// T-16 - T-18 (Task 5, #57, P5.4). **The one registration renderer.** The
// same structure ADR 0004 gave Markdown: the builder's preview imports this
// today and Phase 6's candidate registration imports it next, so the preview
// cannot drift from what a candidate actually sees.
//
// It takes `values`/`errors` from its caller and owns no submission — the
// builder holds throwaway preview state, Phase 6 holds the real answer. The
// one thing it does own is `validateField` (below), because a preview that
// invented its own error messages would be exactly the drift this file
// exists to prevent.

/**
 * The input type, autocomplete token and `inputmode` each field type gets —
 * #57's own table, fixed here as data so a test can assert it rather than
 * read it back out of the JSX.
 *
 * `autocomplete: ""` means *no token at all*: a dropdown, radio group,
 * checkbox group or consent box has nothing in the HTML autofill vocabulary
 * to claim, and `autocomplete="off"` on a control a browser was never going
 * to fill is noise. `type: "textarea"` / `"select"` / `"radio"` name the
 * element rather than an `<input type>`, which is what those three render.
 */
export const FIELD_INPUT: Readonly<
  Record<FormFieldType, { type: string; autocomplete: string; inputMode?: string }>
> = {
  short_text: { type: "text", autocomplete: "name" },
  long_text: { type: "textarea", autocomplete: "off" },
  email: { type: "email", autocomplete: "email" },
  phone: { type: "tel", autocomplete: "tel", inputMode: "tel" },
  number: { type: "number", autocomplete: "off", inputMode: "decimal" },
  date: { type: "date", autocomplete: "off" },
  dropdown: { type: "select", autocomplete: "" },
  radio: { type: "radio", autocomplete: "" },
  checkbox: { type: "checkbox", autocomplete: "" },
  url: { type: "url", autocomplete: "url" },
  consent: { type: "checkbox", autocomplete: "" },
};

/** A `date` field asking for a birth date gets `bday`; any other date — an
 * availability date, a graduation date — gets no guess at all. The label is
 * the only signal the document carries. */
const BIRTH_DATE_LABEL = /\b(birth|birthday|dob|born)\b/i;

export function autocompleteFor(field: FormField): string {
  if (field.type === "date" && BIRTH_DATE_LABEL.test(field.label)) return "bday";
  return FIELD_INPUT[field.type].autocomplete;
}

const CHOICE_TYPES: readonly FormFieldType[] = ["dropdown", "radio", "checkbox"];

/** T-18's three starting points, verbatim. `examples/reasoning-aptitude/
 * test.json`'s own `registration_form` is the worked reference these field
 * shapes follow. */
export const FORM_TEMPLATES: Readonly<
  Record<"campus_hiring" | "course_exam" | "open_contest", RegistrationFormSpec>
> = {
  campus_hiring: {
    title: "Before you start",
    description: "All fields marked * are required.",
    fields: [
      { id: "full_name", type: "short_text", label: "Full name", required: true, validation: { min_length: 3, max_length: 80 } },
      { id: "email", type: "email", label: "College email address", required: true, unique: true },
      { id: "phone", type: "phone", label: "Mobile number", required: true, validation: { default_country: "IN" } },
      { id: "college", type: "short_text", label: "College", required: true },
      { id: "roll_number", type: "short_text", label: "Roll number", required: true, unique: true },
      { id: "degree", type: "dropdown", label: "Degree", required: true, options: ["B.Tech", "B.Sc", "B.Com", "BCA", "M.Tech", "MCA", "Other"] },
      { id: "graduation_year", type: "number", label: "Year of graduation", required: true, validation: { min: 2026, max: 2030, integer: true } },
      { id: "cgpa", type: "number", label: "CGPA so far", required: true, validation: { min: 0, max: 10, decimals: 2 } },
      { id: "resume_url", type: "url", label: "Link to your resume", required: true, validation: { check_reachable: true } },
      { id: "linkedin_url", type: "url", label: "LinkedIn profile" },
      { id: "github_url", type: "url", label: "GitHub profile" },
    ],
  },
  course_exam: {
    title: "Before you start",
    fields: [
      { id: "full_name", type: "short_text", label: "Full name", required: true },
      { id: "student_id", type: "short_text", label: "Student ID", required: true, unique: true },
      { id: "email", type: "email", label: "Email address", required: true, unique: true },
    ],
  },
  open_contest: {
    title: "Before you start",
    fields: [
      { id: "full_name", type: "short_text", label: "Full name", required: true },
      { id: "email", type: "email", label: "Email address", required: true, unique: true },
      { id: "country", type: "short_text", label: "Country" },
    ],
  },
};

/** `*.edu.in` / `drive.google.com` — the glob dialect `allowed_domains`
 * uses. One `*` stands for one or more label characters, nothing else; a
 * full regex here would be organiser-authored and unbounded. */
function domainAllowed(host: string, patterns: readonly string[]): boolean {
  const lower = host.toLowerCase();
  return patterns.some((pattern) => {
    const escaped = pattern
      .toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^.]+");
    return new RegExp(`^${escaped}$`).test(lower);
  });
}

function hostOf(value: string, kind: "email" | "url"): string | null {
  if (kind === "email") return value.includes("@") ? (value.split("@").pop() ?? null) : null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/** True for "the candidate has not answered this yet", for every control
 * shape: a blank box, an unticked consent, an empty checkbox group. */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * One field's error sentence, or `undefined`. The *same* function the
 * builder's preview and Phase 6's candidate registration both call — a
 * second copy beside the real one is the defect this phase keeps finding.
 *
 * The server re-checks every one of these at registration (Phase 6): this
 * is the courtesy half, not the gate.
 */
export function validateField(field: FormField, value: unknown): string | undefined {
  if (isBlank(value)) return field.required === true ? "This answer is required." : undefined;
  const v = field.validation;
  if (v === undefined) return undefined;

  if (typeof value === "string") {
    if (v.min_length !== undefined && value.length < v.min_length) {
      return `Use at least ${v.min_length} characters.`;
    }
    if (v.max_length !== undefined && value.length > v.max_length) {
      return `Use at most ${v.max_length} characters.`;
    }
    if (v.pattern !== undefined) {
      try {
        assertSafeRegex(v.pattern);
        if (!new RegExp(v.pattern).test(value)) {
          return v.pattern_message ?? "This is not in the format this field expects.";
        }
      } catch {
        // An unsafe or unparseable pattern is the *organiser's* defect, not
        // the candidate's, and the builder already shows it to them
        // (`FormBuilder`). Refusing a candidate's answer over it would be
        // the wrong party to punish.
      }
    }
    if (v.allowed_domains !== undefined && (field.type === "email" || field.type === "url")) {
      const host = hostOf(value, field.type);
      if (host === null || !domainAllowed(host, v.allowed_domains)) {
        return `Use an address at ${v.allowed_domains.join(", ")}.`;
      }
    }
  }

  if (field.type === "number") {
    const n = Number(value);
    if (Number.isNaN(n)) return "Enter a number.";
    if (v.integer === true && !Number.isInteger(n)) return "Enter a whole number.";
    if (typeof v.min === "number" && n < v.min) return `Enter ${v.min} or more.`;
    if (typeof v.max === "number" && n > v.max) return `Enter ${v.max} or less.`;
  }

  if (field.type === "date" && typeof value === "string") {
    if (typeof v.min === "string" && value < v.min) return `Choose ${v.min} or later.`;
    if (typeof v.max === "string" && value > v.max) return `Choose ${v.max} or earlier.`;
  }

  return undefined;
}

/** Every field's error at once — what a caller about to submit wants, and
 * what the builder's preview recomputes on each change. */
export function validateForm(
  form: RegistrationFormSpec,
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of form.fields) {
    const message = validateField(field, values[field.id]);
    if (message !== undefined) errors[field.id] = message;
  }
  return errors;
}

export function RegistrationForm({
  form,
  values,
  errors,
  onChange,
  disabled,
}: {
  form: RegistrationFormSpec;
  values: Readonly<Record<string, unknown>>;
  errors: Readonly<Record<string, string>>;
  onChange: (id: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const anyRequired = form.fields.some((field) => field.required === true);
  return (
    <div className="registration-form">
      {form.title !== undefined && form.title !== "" && <h3 className="registration-form__title">{form.title}</h3>}
      {form.description !== undefined && form.description !== "" && <p>{form.description}</p>}
      {anyRequired && <p className="registration-form__legend">Fields marked * are required.</p>}
      {form.fields.map((field) => (
        <Field
          key={field.id}
          field={field}
          value={values[field.id]}
          error={errors[field.id]}
          onChange={onChange}
          disabled={disabled === true}
        />
      ))}
    </div>
  );
}

/** The visible required marker. Inside the `<label>`/`<legend>` rather than
 * beside it, so WCAG 2.5.3 holds: the accessible name is a superset of what
 * is read, not a different string. */
function Marker({ required }: { required: boolean }) {
  return required ? <span className="registration-form__required"> *</span> : null;
}

function Field({
  field,
  value,
  error,
  onChange,
  disabled,
}: {
  field: FormField;
  value: unknown;
  error: string | undefined;
  onChange: (id: string, value: unknown) => void;
  disabled: boolean;
}) {
  const controlId = useId();
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;
  const spec = FIELD_INPUT[field.type];
  const required = field.required === true;
  const describedBy = [field.help !== undefined ? helpId : null, error !== undefined ? errorId : null]
    .filter((id): id is string => id !== null)
    .join(" ");

  // Built key-by-key rather than spread with `undefined`:
  // `exactOptionalPropertyTypes` holds "absent" and "explicitly undefined"
  // apart, and an `autocomplete=""` attribute is not the same as no
  // attribute to a browser.
  const shared = {
    id: controlId,
    disabled,
    "aria-required": required,
    ...(error !== undefined && { "aria-invalid": true as const }),
    ...(describedBy !== "" && { "aria-describedby": describedBy }),
    ...(autocompleteFor(field) !== "" && { autoComplete: autocompleteFor(field) }),
    ...(spec.inputMode !== undefined && { inputMode: spec.inputMode as "tel" | "decimal" }),
  };

  const help = field.help !== undefined && (
    <p className="registration-form__help" id={helpId}>
      {field.help}
    </p>
  );
  const errorText = error !== undefined && (
    <p className="registration-form__error" id={errorId}>
      <span aria-hidden="true">⚠</span> {error}
    </p>
  );

  // A radio group, a checkbox group and a consent box are not one labelled
  // control, so they carry their own grouping rather than a `<label for>`.
  if (CHOICE_TYPES.includes(field.type) && field.type !== "dropdown") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    // `shared` cannot be spread here: its `id`, `disabled` and autocomplete
    // token belong to a control, not to a group. The three ARIA states that
    // do belong to the group are placed one by one, because ARIA allows
    // them in different places (task 5/6 review, M1 — this branch carried
    // none of them, so a required radio group was not programmatically
    // required and its error text was referenced by nothing):
    //
    //   `aria-invalid`, `aria-describedby`  global — legal on any element.
    //   `aria-required`                     not allowed on `group`. The
    //     radio case takes `role="radiogroup"`, where it is allowed; the
    //     checkbox case has no group role that allows it, so each box
    //     carries it (`role="checkbox"` does).
    //
    // Every other arrangement is an axe `aria-allowed-attr` violation, and
    // the axe fixture now renders this branch so that stays true.
    const isRadio = field.type === "radio";
    return (
      <fieldset
        className="registration-form__field registration-form__group"
        {...(isRadio && { role: "radiogroup", "aria-required": required })}
        {...(error !== undefined && { "aria-invalid": true as const })}
        {...(describedBy !== "" && { "aria-describedby": describedBy })}
      >
        <legend>
          {field.label}
          <Marker required={required} />
        </legend>
        {help}
        {(field.options ?? []).map((option) => (
          <label className="registration-form__choice" key={option}>
            <input
              type={isRadio ? "radio" : "checkbox"}
              name={field.id}
              value={option}
              disabled={disabled}
              {...(!isRadio && required && { "aria-required": true as const })}
              checked={isRadio ? value === option : selected.includes(option)}
              onChange={() =>
                onChange(
                  field.id,
                  isRadio
                    ? option
                    : selected.includes(option)
                      ? selected.filter((o) => o !== option)
                      : [...selected, option],
                )
              }
            />
            {option}
          </label>
        ))}
        {errorText}
      </fieldset>
    );
  }

  if (field.type === "consent") {
    return (
      <div className="registration-form__field">
        <label className="registration-form__choice" htmlFor={controlId}>
          <input
            {...shared}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(field.id, event.target.checked)}
          />
          {field.label}
          <Marker required={required} />
        </label>
        {/* `link_target` is either `"consent"` — the test's own consent
            text, which lives on the candidate screen Phase 6 builds — or a
            URL. Only the URL form can be a link from here; the other is the
            words on their own until that screen exists.
            ponytail: an in-page link to the consent block, once Phase 6
            renders one above this form. */}
        {field.link_text !== undefined &&
          (field.link_target !== undefined && /^https?:\/\//.test(field.link_target) ? (
            <a href={field.link_target} target="_blank" rel="noreferrer noopener">
              {field.link_text}
            </a>
          ) : (
            <span className="registration-form__help">{field.link_text}</span>
          ))}
        {help}
        {errorText}
      </div>
    );
  }

  return (
    <div className="registration-form__field">
      <label className="field-label" htmlFor={controlId}>
        {field.label}
        <Marker required={required} />
      </label>
      {field.type === "long_text" ? (
        <textarea
          {...shared}
          className="text-input"
          value={typeof value === "string" ? value : ""}
          {...(field.validation?.max_length !== undefined && { maxLength: field.validation.max_length })}
          onChange={(event) => onChange(field.id, event.target.value)}
        />
      ) : field.type === "dropdown" ? (
        <select
          {...shared}
          className="text-input"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(field.id, event.target.value)}
        >
          <option value="">Choose…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          className="text-input"
          type={spec.type}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          {...(field.validation?.max_length !== undefined &&
            (field.type === "short_text" || field.type === "phone") && {
              maxLength: field.validation.max_length,
            })}
          {...(field.type === "number" &&
            typeof field.validation?.min === "number" && { min: field.validation.min })}
          {...(field.type === "number" &&
            typeof field.validation?.max === "number" && { max: field.validation.max })}
          {...(field.type === "date" && typeof field.validation?.min === "string" && { min: field.validation.min })}
          {...(field.type === "date" && typeof field.validation?.max === "string" && { max: field.validation.max })}
          onChange={(event) => onChange(field.id, event.target.value)}
        />
      )}
      {help}
      {errorText}
    </div>
  );
}
