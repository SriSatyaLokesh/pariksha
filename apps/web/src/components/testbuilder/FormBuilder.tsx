import { useId, useMemo, useState } from "react";
import {
  FORM_FIELD_TYPES,
  unsatisfiableValidation,
  type FieldValidation,
  type FormField,
  type FormFieldType,
  type RegistrationFormSpec,
} from "@pariksha/core";
import type { ReachResult } from "../../lib/api";
import { ReorderableList } from "../authoring/ReorderableList";
import { FORM_TEMPLATES, RegistrationForm, dialCodeFor, validateForm } from "./RegistrationForm";
import { useDialogKeys } from "../useDialogKeys";

// T-16 - T-18 (Task 5, #57, P5.4): the registration form builder. The
// preview beside it is `RegistrationForm` itself — the component Phase 6's
// candidate registration mounts — so what an organiser approves here is
// literally what a candidate meets, validation messages included.

const FIELD_TYPE_LABEL: Readonly<Record<FormFieldType, string>> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email",
  phone: "Phone",
  number: "Number",
  date: "Date",
  dropdown: "Dropdown",
  radio: "Radio",
  checkbox: "Checkbox",
  url: "URL",
  consent: "Consent",
};

const TEMPLATE_LABEL: Readonly<Record<keyof typeof FORM_TEMPLATES, string>> = {
  campus_hiring: "Campus hiring",
  course_exam: "Course exam",
  open_contest: "Open contest",
};

const CHOICE_TYPES: readonly FormFieldType[] = ["dropdown", "radio", "checkbox"];

const EMPTY_FORM: RegistrationFormSpec = { fields: [] };

/** `^[a-z0-9_]{1,40}$` — schemas/test-1.json's `$defs/formField`, and the
 * column name this field gets in the results CSV. Derived from the type so
 * a new field is never born invalid, and suffixed so adding a second
 * `Email` does not collide with the first. */
function freshFieldId(type: FormFieldType, existing: readonly FormField[]): string {
  const taken = new Set(existing.map((f) => f.id));
  if (!taken.has(type)) return type;
  for (let n = 2; ; n += 1) {
    const candidate = `${type}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Keeps a hand-typed column name inside the schema's pattern on every
 * keystroke rather than letting an invalid one reach the save and come
 * back a 422: the pattern is one of the few floors the draft gate keeps
 * (unlike the emptiness floors — see `draftSchema` in
 * apps/api/src/routes/tests.ts). */
function sanitiseId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
}

function newField(type: FormFieldType, existing: readonly FormField[]): FormField {
  const base: FormField = {
    id: freshFieldId(type, existing),
    type,
    label: FIELD_TYPE_LABEL[type],
  };
  // `options` is present from birth for a choice field, empty: the schema's
  // `if`/`then` wants the *key*, and `draftSchema` drops only the "at least
  // two" floor, so a field being built saves and a field being published
  // still has to carry two (`validateTest`, @pariksha/core).
  return CHOICE_TYPES.includes(type) ? { ...base, options: [] } : base;
}

/** The keys a field may legitimately not have — `id`, `type` and `label`
 * are required by the schema and are never cleared, which is also what
 * keeps `Omit<FormField, K>` below still a `FormField`. */
type OptionalFieldKey = "help" | "required" | "unique" | "options" | "link_text" | "link_target" | "validation";

/**
 * Sets or clears one optional key, never spreading an `undefined` —
 * `exactOptionalPropertyTypes` holds "absent" and "explicitly undefined"
 * apart, which is why a `Partial<FormField>` patch cannot say "remove this".
 *
 * Not generic in `K`: `Omit<FormField, K>` is not provably a `FormField`
 * while `K` is still a type variable, and the three ways round that
 * (a double assertion, overloads, a mapped patch type) are all longer than
 * the one assertion below for six call sites over a closed key list.
 */
function withKey(
  field: FormField,
  key: OptionalFieldKey,
  value: string | boolean | string[] | FieldValidation | undefined,
): FormField {
  const next: Record<string, unknown> = { ...field };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next as unknown as FormField;
}

function withValidation<K extends keyof FieldValidation>(
  field: FormField,
  key: K,
  value: NonNullable<FieldValidation[K]> | undefined,
): FormField {
  const { [key]: _drop, ...rest } = field.validation ?? {};
  const next: FieldValidation = value === undefined ? rest : { ...rest, [key]: value };
  return Object.keys(next).length > 0 ? { ...field, validation: next } : withKey(field, "validation", undefined);
}

/** The one sentence the "Default country" row says about the code typed
 * into it — what it does, or that it does nothing. */
function dialFact(dial: string | undefined, country: string | undefined): string {
  if (dial !== undefined) return `A candidate's number starts with ${dial}.`;
  if (country === undefined || country === "") {
    return "A two-letter country code — IN, US, GB — puts that country's dialling code in front of the number.";
  }
  return `No dialling code is known for "${country}", so the number is asked for without one. Use a two-letter code — IN, US, GB.`;
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function FormBuilder({
  form,
  onChange,
  checkUrl,
}: {
  form: RegistrationFormSpec | undefined;
  onChange: (next: RegistrationFormSpec) => void;
  /** Task 6 (#58, P5.5): T-19's reachability check, already bound to the
   * workspace and the test. One closure rather than `client` +
   * `workspaceId` + `testId` (SectionList's three props): this component
   * makes exactly one call, and three props to reach one method is three
   * things a later task has to keep threaded. */
  checkUrl: (url: string) => Promise<ReachResult>;
}) {
  const spec = form ?? EMPTY_FORM;
  const [addType, setAddType] = useState<FormFieldType>("short_text");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [touched, setTouched] = useState<Record<string, true>>({});
  const [pendingTemplate, setPendingTemplate] = useState<keyof typeof FORM_TEMPLATES | null>(null);
  const addTypeId = useId();
  const titleId = useId();
  const descriptionId = useId();

  const templateDialog = useDialogKeys<HTMLDivElement>(pendingTemplate !== null, () => setPendingTemplate(null));

  // The preview shows an error only once the candidate has actually touched
  // the control — a form that opens with eleven errors already showing is
  // not what Phase 6 ships, and the preview must not lie about that either.
  const errors = useMemo(() => {
    const all = validateForm(spec, values);
    return Object.fromEntries(Object.entries(all).filter(([id]) => touched[id] === true));
  }, [spec, values, touched]);

  function setFields(fields: FormField[]): void {
    onChange({ ...spec, fields });
  }

  function updateField(id: string, updater: (field: FormField) => FormField): void {
    const fields = spec.fields.map((f) => (f.id === id ? updater(f) : f));
    // A rename onto an id another field already holds is refused (task 5/6
    // review, M2). This function keys on `field.id`, so two fields sharing
    // one would be edited together from then on; `ReorderableList`'s
    // `keyOf`, the preview's `key` and `values[field.id]` all assume the id
    // is unique; and `validateTest` would not report it until publish, by
    // which point the author has silently lost a field's configuration.
    // The guard sits here rather than at the Column name box because this
    // is the one funnel every field edit passes through.
    if (new Set(fields.map((f) => f.id)).size !== fields.length) return;
    setFields(fields);
  }

  function addField(): void {
    setFields([...spec.fields, newField(addType, spec.fields)]);
  }

  function applyTemplate(key: keyof typeof FORM_TEMPLATES): void {
    if (spec.fields.length > 0) {
      setPendingTemplate(key);
      return;
    }
    onChange(FORM_TEMPLATES[key]);
  }

  return (
    <section className="form-builder" aria-labelledby={`${titleId}-heading`}>
      <h2 id={`${titleId}-heading`}>Registration form</h2>
      <p>What a candidate is asked before the test starts. Every field becomes a column in the results CSV.</p>

      <div className="form-builder__templates">
        <h3>Start from a template</h3>
        {(Object.keys(TEMPLATE_LABEL) as (keyof typeof FORM_TEMPLATES)[]).map((key) => (
          <button key={key} type="button" className="button-secondary" onClick={() => applyTemplate(key)}>
            {TEMPLATE_LABEL[key]}
          </button>
        ))}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={titleId}>
          Form title
        </label>
        <input
          className="text-input"
          id={titleId}
          value={spec.title ?? ""}
          onChange={(event) => {
            const title = event.target.value;
            onChange(title === "" ? { fields: spec.fields, ...(spec.description !== undefined && { description: spec.description }) } : { ...spec, title });
          }}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={descriptionId}>
          Form description
        </label>
        <textarea
          className="text-input"
          id={descriptionId}
          value={spec.description ?? ""}
          onChange={(event) => {
            const description = event.target.value;
            onChange(
              description === ""
                ? { fields: spec.fields, ...(spec.title !== undefined && { title: spec.title }) }
                : { ...spec, description },
            );
          }}
        />
      </div>

      <ReorderableList
        items={spec.fields}
        keyOf={(f) => f.id}
        labelOf={(f) => `field ${f.label || "Untitled"}`}
        onReorder={(from, to) => setFields(moveItem(spec.fields, from, to))}
        legend="Registration form"
        renderItem={(field, index) => (
          <FieldEditor
            field={field}
            index={index}
            onChange={(updater) => updateField(field.id, updater)}
            onDelete={() => setFields(spec.fields.filter((f) => f.id !== field.id))}
            checkUrl={checkUrl}
          />
        )}
      />

      <div className="form-builder__add">
        <label className="field-label" htmlFor={addTypeId}>
          Field type
        </label>
        <select
          id={addTypeId}
          className="text-input"
          value={addType}
          onChange={(event) => setAddType(event.target.value as FormFieldType)}
        >
          {FORM_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {FIELD_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
        <button type="button" className="button-secondary" onClick={addField}>
          Add field
        </button>
      </div>

      <section className="form-builder__preview" aria-label="Preview">
        <h3>Preview</h3>
        {spec.fields.length === 0 ? (
          <p>No fields yet. A candidate goes straight into the test.</p>
        ) : (
          <RegistrationForm
            form={spec}
            values={values}
            errors={errors}
            onChange={(id, value) => {
              setValues((prev) => ({ ...prev, [id]: value }));
              setTouched((prev) => ({ ...prev, [id]: true }));
            }}
          />
        )}
      </section>

      {pendingTemplate !== null && (
        <div
          role="dialog"
          aria-label="Apply a template"
          ref={templateDialog.dialogRef}
          tabIndex={-1}
          onKeyDown={templateDialog.onKeyDown}
        >
          <p>
            Applying <strong>{TEMPLATE_LABEL[pendingTemplate]}</strong> will replace the {spec.fields.length} field
            {spec.fields.length === 1 ? "" : "s"} you have, and everything configured on them.
          </p>
          <button type="button" className="button-secondary" onClick={() => setPendingTemplate(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              onChange(FORM_TEMPLATES[pendingTemplate]);
              setPendingTemplate(null);
            }}
          >
            Replace them
          </button>
        </div>
      )}
    </section>
  );
}

function FieldEditor({
  field,
  index,
  onChange,
  onDelete,
  checkUrl,
}: {
  field: FormField;
  index: number;
  onChange: (updater: (field: FormField) => FormField) => void;
  onDelete: () => void;
  checkUrl: (url: string) => Promise<ReachResult>;
}) {
  const ids = useId();
  const unsatisfiable = unsatisfiableValidation(field);
  const v = field.validation;

  const text = (
    label: string,
    key: string,
    value: string,
    onCommit: (next: string) => void,
    type = "text",
  ) => (
    <div className="field" key={key}>
      <label className="field-label" htmlFor={`${ids}-${key}`}>
        {label}
      </label>
      <input
        className="text-input"
        id={`${ids}-${key}`}
        type={type}
        value={value}
        onChange={(event) => onCommit(event.target.value)}
      />
    </div>
  );

  const number = (label: string, key: keyof FieldValidation, value: number | undefined) =>
    text(label, String(key), value === undefined ? "" : String(value), (next) =>
      onChange((f) => withValidation(f, key, next === "" ? undefined : (Number(next) as never))),
      "number",
    );

  return (
    <fieldset className="form-builder__field">
      <legend>{`Field ${index + 1}: ${field.label || "Untitled"} (${FIELD_TYPE_LABEL[field.type]})`}</legend>

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-label`}>
          Visible label
        </label>
        <input
          className="text-input"
          id={`${ids}-label`}
          required
          value={field.label}
          onChange={(event) => onChange((f) => ({ ...f, label: event.target.value }))}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-id`}>
          Column name
        </label>
        <input
          className="text-input"
          id={`${ids}-id`}
          value={field.id}
          onChange={(event) => {
            const id = sanitiseId(event.target.value);
            if (id !== "") onChange((f) => ({ ...f, id }));
          }}
        />
      </div>

      {text("Help text", "help", field.help ?? "", (next) =>
        onChange((f) => withKey(f, "help", next === "" ? undefined : next)),
      )}

      <label className="form-builder__flag">
        <input
          type="checkbox"
          checked={field.required === true}
          onChange={(event) => onChange((f) => withKey(f, "required", event.target.checked || undefined))}
        />
        Required
      </label>

      <label className="form-builder__flag">
        <input
          type="checkbox"
          checked={field.unique === true}
          onChange={(event) => onChange((f) => withKey(f, "unique", event.target.checked || undefined))}
        />
        Unique
      </label>
      <p className="form-builder__fact">A second registration with the same value is refused.</p>

      {CHOICE_TYPES.includes(field.type) && (
        <OptionsEditor
          id={`${ids}-options`}
          options={field.options ?? []}
          onCommit={(options) => onChange((f) => ({ ...f, options }))}
        />
      )}

      {field.type === "consent" && (
        <>
          {text("Link text", "link_text", field.link_text ?? "", (next) =>
            onChange((f) => withKey(f, "link_text", next === "" ? undefined : next)),
          )}
          {text("Link target", "link_target", field.link_target ?? "", (next) =>
            onChange((f) => withKey(f, "link_target", next === "" ? undefined : next)),
          )}
        </>
      )}

      {(field.type === "short_text" || field.type === "long_text") && (
        <>
          {number("Minimum length", "min_length", v?.min_length)}
          {number("Maximum length", "max_length", v?.max_length)}
        </>
      )}

      {field.type === "short_text" && (
        <>
          {text("Pattern", "pattern", v?.pattern ?? "", (next) =>
            onChange((f) => withValidation(f, "pattern", next === "" ? undefined : next)),
          )}
          {text("Pattern message", "pattern_message", v?.pattern_message ?? "", (next) =>
            onChange((f) => withValidation(f, "pattern_message", next === "" ? undefined : next)),
          )}
        </>
      )}

      {field.type === "number" && (
        <>
          {number("Minimum", "min", typeof v?.min === "number" ? v.min : undefined)}
          {number("Maximum", "max", typeof v?.max === "number" ? v.max : undefined)}
          {number("Decimal places", "decimals", v?.decimals)}
          <label className="form-builder__flag">
            <input
              type="checkbox"
              checked={v?.integer === true}
              onChange={(event) => onChange((f) => withValidation(f, "integer", event.target.checked || undefined))}
            />
            Whole numbers only
          </label>
        </>
      )}

      {field.type === "date" && (
        <>
          {text("Minimum", "min", typeof v?.min === "string" ? v.min : "", (next) =>
            onChange((f) => withValidation(f, "min", next === "" ? undefined : next)), "date",
          )}
          {text("Maximum", "max", typeof v?.max === "string" ? v.max : "", (next) =>
            onChange((f) => withValidation(f, "max", next === "" ? undefined : next)), "date",
          )}
        </>
      )}

      {field.type === "phone" && (
        <>
          {text("Default country", "default_country", v?.default_country ?? "", (next) =>
            onChange((f) => withValidation(f, "default_country", next === "" ? undefined : next.toUpperCase())),
          )}
          {/* What the code the organiser typed actually does, said here
              rather than left to be discovered in the preview. The schema
              puts no pattern on `default_country`, so "INDIA" is a legal
              value that no dialling code answers to — saying so is the
              difference between a field that is consumed and one that is
              only collected (task 5/6 review, M5). */}
          <p className="form-builder__fact">{dialFact(dialCodeFor(field), v?.default_country)}</p>
        </>
      )}

      {(field.type === "email" || field.type === "url") &&
        text("Allowed domains (comma-separated)", "allowed_domains", (v?.allowed_domains ?? []).join(", "), (next) => {
          const domains = next
            .split(",")
            .map((d) => d.trim())
            .filter((d) => d !== "");
          onChange((f) => withValidation(f, "allowed_domains", domains.length > 0 ? domains : undefined));
        })}

      {/* T-19 (Task 6, #58, P5.5). The flag is the mechanism; the row under
          it is the builder affordance — an organiser can see what the
          check will actually say about a link of the kind they are asking
          for, before a candidate meets it. The candidate-side check is
          Phase 6's. */}
      {field.type === "url" && (
        <>
          <label className="form-builder__flag">
            <input
              type="checkbox"
              checked={v?.check_reachable === true}
              onChange={(event) =>
                onChange((f) => withValidation(f, "check_reachable", event.target.checked || undefined))
              }
            />
            Check the link is reachable
          </label>
          <p className="form-builder__fact">
            The link a candidate gives is fetched once, at registration. One that does not answer 200 is flagged as
            unverified for you to look at — it is never refused, and nothing is blocked.
          </p>
          {v?.check_reachable === true && <UrlCheck id={`${ids}-try`} check={checkUrl} />}
        </>
      )}

      {unsatisfiable !== null && (
        <p className="form-builder__risk" role="alert">
          <span aria-hidden="true">⚠</span> {unsatisfiable}
        </p>
      )}

      <button type="button" className="button-secondary" onClick={onDelete}>
        Delete field
      </button>
    </fieldset>
  );
}

/** The sentence for each outcome — text plus glyph, never colour alone, and
 * never the word "invalid": an unverified link is one the server could not
 * confirm, which is not the same as one the organiser got wrong. */
function reachLine(result: ReachResult): { glyph: string; text: string } {
  switch (result.state) {
    case "reachable":
      return { glyph: "✓", text: "Reachable — the link returned 200." };
    case "unverified":
      return {
        glyph: "⚠",
        text:
          result.status === null
            ? "Unverified — the link did not return 200."
            : `Unverified — the link did not return 200 (${result.status}).`,
      };
    case "timeout":
      return { glyph: "⚠", text: "The check timed out. The link may still be fine." };
    case "refused":
      return { glyph: "⚠", text: `Not checked — ${result.reason ?? "this link cannot be checked"}.` };
  }
}

/** Epoch milliseconds as a fixed, locale-independent stamp — the organiser
 * needs to know whether a result is from a minute ago or last week, not
 * what their browser calls Tuesday. */
function stampOf(checkedAt: number): string {
  return `${new Date(checkedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * T-19's builder affordance: try one link and see what the candidate's own
 * check would say about it. Nothing here is stored on the field, and no
 * outcome disables anything — an unverified or timed-out result leaves the
 * form exactly as editable and as saveable as it was.
 */
function UrlCheck({ id, check }: { id: string; check: (url: string) => Promise<ReachResult> }) {
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ReachResult | null>(null);
  const [failed, setFailed] = useState(false);

  async function run(): Promise<void> {
    setChecking(true);
    setFailed(false);
    try {
      setResult(await check(url));
    } catch {
      // The *request* failed, which is not a statement about the link —
      // reporting it as "unreachable" would be the wrong fact.
      setResult(null);
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }

  const line = result === null ? null : reachLine(result);

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Try a link
      </label>
      <input
        className="text-input"
        id={id}
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <button
        type="button"
        className="button-secondary"
        disabled={checking || url === ""}
        onClick={() => void run()}
      >
        {result === null && !failed ? "Check" : "Check again"}
      </button>
      {/* Named, because `ReorderableList` already has an unnamed
          `role="status"` on this screen and a test (and a screen reader
          user moving between live regions) must be able to tell them
          apart — the same `aria-label` SectionList's own undo row uses. */}
      <p className="form-builder__fact" role="status" aria-label="Link check">
        {checking ? (
          "Checking…"
        ) : failed ? (
          "The check could not be run. Try again."
        ) : line === null ? (
          "Not checked"
        ) : (
          <>
            <span aria-hidden="true">{line.glyph}</span> {line.text} Checked at {stampOf(result!.checkedAt)}.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * One option per line, committed on blur rather than on every keystroke —
 * the `PositionInput` (ReorderableList.tsx) precedent, and for the same
 * reason: a half-typed line is not an option yet, and the shell saves the
 * draft 250 ms after the last keystroke.
 */
function OptionsEditor({
  id,
  options,
  onCommit,
}: {
  id: string;
  options: readonly string[];
  onCommit: (options: string[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Options, one per line
      </label>
      <textarea
        className="text-input"
        id={id}
        value={draft ?? options.join("\n")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === null) return;
          onCommit(
            draft
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== ""),
          );
          setDraft(null);
        }}
      />
    </div>
  );
}
