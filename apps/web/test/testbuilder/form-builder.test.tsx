// The registration form builder (#57, P5.4) — T-16, T-17, T-18 — and the
// one renderer its preview and Phase 6's candidate registration share.
//
// The builder is driven, never poked: every assertion below comes after a
// real change or click on a control an organiser can see, and the preview is
// read through `within(preview())` so a selector can never accidentally
// match the editor's own copy of the same words.
//
// No @testing-library/user-event in this workspace (apps/web's package.json
// carries @testing-library/react and jest-dom only — see
// apps/web/test/authoring/reorder.test.tsx for the same note).
// `fireEvent.change` is the real `change` a `<select>` or `<input>` fires,
// and a focused native <button>'s Enter/Space activation is a `click` in
// every browser.

import { useState } from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { FORM_FIELD_TYPES, type FormFieldType, type RegistrationFormSpec } from "@pariksha/core";

import { FormBuilder } from "../../src/components/testbuilder/FormBuilder";
import {
  FIELD_INPUT,
  FORM_TEMPLATES,
  autocompleteFor,
  validateField,
} from "../../src/components/testbuilder/RegistrationForm";

const FIELD_LABEL: Readonly<Record<FormFieldType, string>> = {
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

/** The builder is controlled: a test that passed a static `form` prop would
 * assert on a component that can never change, which is the "test that
 * cannot fail" this phase keeps finding. This holds the state the real
 * shell (`apps/web/src/routes/test.tsx`) holds. */
function Harness({ initial }: { initial?: RegistrationFormSpec }) {
  const [form, setForm] = useState<RegistrationFormSpec | undefined>(initial);
  // Task 6's affordance has its own file (url-check.test.tsx); nothing here
  // ticks `check_reachable`, so nothing here calls it.
  return <FormBuilder form={form} onChange={setForm} checkUrl={neverChecked} />;
}

const neverChecked = (): Promise<never> => Promise.reject(new Error("not used by this test file"));

function preview(): HTMLElement {
  return screen.getByRole("region", { name: /preview/i });
}

function addField(type: FormFieldType): void {
  fireEvent.change(screen.getByLabelText(/field type/i), { target: { value: type } });
  fireEvent.click(screen.getByRole("button", { name: /add field/i }));
}

function typeInto(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } });
}

const ROLL_NUMBER: RegistrationFormSpec = {
  fields: [
    {
      id: "roll_number",
      type: "short_text",
      label: "Roll number",
      required: true,
      validation: {
        pattern: "^[0-9]{2}[A-Z]{2}[0-9]{4}$",
        pattern_message: "Format: 21CS0147 — two digits, two letters, four digits.",
      },
    },
  ],
};

describe("FormBuilder (T-16 - T-18)", () => {
  it("all eleven field types can be added", () => {
    render(<Harness />);
    for (const type of FORM_FIELD_TYPES) addField(type);

    expect(screen.getAllByRole("group", { name: /field/i })).toHaveLength(11);
    // And each one is the type that was asked for, not eleven of the first.
    for (const type of FORM_FIELD_TYPES) {
      expect(screen.getByRole("group", { name: new RegExp(`\\(${FIELD_LABEL[type]}\\)`, "i") })).toBeVisible();
    }
  });

  it("a second field of one type gets its own column name, so the results CSV has two columns", () => {
    render(<Harness />);
    addField("email");
    addField("email");

    const names = screen.getAllByLabelText(/column name/i).map((input) => (input as HTMLInputElement).value);
    expect(names).toEqual(["email", "email_2"]);
  });

  it("the preview is the candidate renderer, including its validation messages", () => {
    render(<Harness initial={ROLL_NUMBER} />);

    typeInto(within(preview()).getByLabelText(/roll number/i), "nope");

    expect(
      within(preview()).getByText("Format: 21CS0147 — two digits, two letters, four digits."),
    ).toBeVisible();
  });

  it("the builder cannot produce a placeholder-only field", () => {
    render(<Harness />);
    addField("short_text");

    expect(screen.getByLabelText(/visible label/i)).toBeRequired();
    // And the label is what the candidate reads, above the control rather
    // than inside it: a placeholder vanishes the moment they type.
    expect(within(preview()).getByText(/^Short text/)).toBeVisible();
    expect(within(preview()).getByLabelText(/^Short text/)).not.toHaveAttribute("placeholder");
  });

  it("every field type sets the right input type and autocomplete token in the preview", () => {
    render(<Harness />);
    for (const type of FORM_FIELD_TYPES) addField(type);

    for (const type of FORM_FIELD_TYPES) {
      const spec = FIELD_INPUT[type];
      const label = FIELD_LABEL[type];
      const control =
        type === "dropdown"
          ? within(preview()).getByRole("combobox", { name: new RegExp(label, "i") })
          : type === "radio" || type === "checkbox"
            ? within(preview()).getByRole("group", { name: new RegExp(`^${label}`, "i") })
            : within(preview()).getByLabelText(new RegExp(`^${label}`, "i"));

      if (type === "dropdown") {
        expect(control.tagName, type).toBe("SELECT");
      } else if (type === "long_text") {
        expect(control.tagName, type).toBe("TEXTAREA");
      } else if (type === "radio" || type === "checkbox") {
        // A group of options is not one control: the type lands on each
        // input inside it, and there is no token for the group.
        expect(control.tagName, type).toBe("FIELDSET");
        continue;
      } else {
        expect((control as HTMLInputElement).type, type).toBe(spec.type);
      }
      expect(control.getAttribute("autocomplete") ?? "", type).toBe(spec.autocomplete);
      expect(control.getAttribute("inputmode") ?? undefined, type).toBe(spec.inputMode);
    }
  });

  it("a date field asking for a birth date gets bday, and any other date gets no guess", () => {
    expect(autocompleteFor({ id: "dob", type: "date", label: "Date of birth" })).toBe("bday");
    expect(autocompleteFor({ id: "start", type: "date", label: "Available from" })).toBe("off");
  });

  it("required is marked in the preview, not only in the editor", () => {
    render(<Harness />);
    addField("short_text");
    fireEvent.click(screen.getByRole("checkbox", { name: /^required$/i }));

    expect(within(preview()).getByLabelText(/^Short text/)).toHaveAttribute("aria-required", "true");
    // The visible marker is inside the label, so the accessible name is a
    // superset of what is read on screen (WCAG 2.5.3) rather than a
    // different string.
    expect(within(preview()).getByLabelText(/^Short text/)).toHaveAccessibleName("Short text*");
    expect(within(preview()).getByText(/Fields marked \* are required/i)).toBeVisible();
  });

  it("the unique flag states its effect in one line", () => {
    render(<Harness />);
    addField("email");
    expect(screen.getByText("A second registration with the same value is refused.")).toBeVisible();
  });

  it("validation that cannot be satisfied is caught in the builder with cause and fix", () => {
    render(<Harness />);
    addField("number");

    typeInto(screen.getByLabelText(/^minimum$/i), "10");
    typeInto(screen.getByLabelText(/^maximum$/i), "5");

    expect(screen.getByRole("alert")).toHaveTextContent(/minimum 10 is above maximum 5 — lower the minimum/i);
  });

  it("activating a focused move button reorders a field and announces the new position", () => {
    render(<Harness initial={FORM_TEMPLATES.course_exam} />);

    const down = screen.getByRole("button", { name: /move field Full name down/i });
    down.focus();
    fireEvent.click(down);

    expect(screen.getByRole("status")).toHaveTextContent(/moved to position 2 of 3/i);
    expect(screen.getAllByRole("group", { name: /^Field \d/ })[1]).toHaveAccessibleName(/Full name/);
  });

  it("applying a template over existing fields confirms first, and names what is replaced", () => {
    render(<Harness initial={FORM_TEMPLATES.course_exam} />);

    fireEvent.click(screen.getByRole("button", { name: /campus hiring/i }));

    expect(screen.getByRole("dialog")).toHaveTextContent(/replace the 3 fields you have/i);
    expect(screen.getAllByRole("group", { name: /^Field \d/ })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /replace them/i }));
    expect(screen.getAllByRole("group", { name: /^Field \d/ })).toHaveLength(
      FORM_TEMPLATES.campus_hiring.fields.length,
    );
  });

  it("applying a template to an empty form needs no confirmation", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /open contest/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("group", { name: /^Field \d/ })).toHaveLength(3);
  });

  it("the template dialog takes Escape, initial focus and returns focus on close", () => {
    render(<Harness initial={FORM_TEMPLATES.course_exam} />);
    const opener = screen.getByRole("button", { name: /campus hiring/i });

    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    // And nothing was replaced on the way out.
    expect(screen.getAllByRole("group", { name: /^Field \d/ })).toHaveLength(3);
  });

  it("a new choice field is born with an empty options list, not without the key", () => {
    // The draft gate keeps `$defs/formField`'s "a dropdown requires
    // options" (a shape rule, not an emptiness one — see `draftSchema`,
    // apps/api/src/routes/tests.ts), so a field born without the key is a
    // 422 on the very next debounced save.
    const saved: RegistrationFormSpec[] = [];
    function Spy() {
      const [form, setForm] = useState<RegistrationFormSpec | undefined>(undefined);
      return (
        <FormBuilder
          form={form}
          onChange={(next) => {
            saved.push(next);
            setForm(next);
          }}
          checkUrl={neverChecked}
        />
      );
    }
    render(<Spy />);
    addField("dropdown");
    expect(saved.at(-1)?.fields).toEqual([{ id: "dropdown", type: "dropdown", label: "Dropdown", options: [] }]);

    addField("short_text");
    expect(saved.at(-1)?.fields[1]).toEqual({ id: "short_text", type: "short_text", label: "Short text" });
  });

  it("a choice field's options commit on blur, not on every keystroke", () => {
    render(<Harness />);
    addField("dropdown");

    const options = screen.getByLabelText(/options, one per line/i);
    typeInto(options, "B.Tech\nB.Sc");
    // Still nothing in the preview: a half-typed line is not an option yet,
    // and the shell saves the draft 250 ms after the last keystroke.
    expect(within(preview()).queryByRole("option", { name: "B.Tech" })).toBeNull();

    fireEvent.blur(options);
    expect(within(preview()).getByRole("option", { name: "B.Tech" })).toBeInTheDocument();
    expect(within(preview()).getByRole("option", { name: "B.Sc" })).toBeInTheDocument();
  });

  it("the builder and the preview have no axe violations", async () => {
    const { container } = render(<Harness initial={FORM_TEMPLATES.campus_hiring} />);
    expect(await axe(container)).toHaveNoViolations();
    expect(await axe(preview())).toHaveNoViolations();
  });
});

describe("validateField — the one copy both halves call", () => {
  it("refuses an email outside allowed_domains and accepts one inside", () => {
    const field = {
      id: "email",
      type: "email" as const,
      label: "College email",
      validation: { allowed_domains: ["*.edu.in", "*.ac.in"] },
    };
    expect(validateField(field, "rao@nitk.ac.in")).toBeUndefined();
    expect(validateField(field, "rao@gmail.com")).toMatch(/\*\.edu\.in/);
    // The glob is one label, not "anything": a subdomain of a subdomain
    // does not quietly pass.
    expect(validateField(field, "rao@a.b.ac.in")).toMatch(/\*\.edu\.in/);
  });

  it("a blank answer is required-or-nothing, never a format complaint", () => {
    const field = {
      id: "roll",
      type: "short_text" as const,
      label: "Roll",
      validation: { pattern: "^[0-9]{2}$" },
    };
    expect(validateField(field, "")).toBeUndefined();
    expect(validateField({ ...field, required: true }, "")).toMatch(/required/i);
  });

  it("an organiser's unsafe pattern never becomes the candidate's error", () => {
    // `assertSafeRegex` (@pariksha/core) refuses this; refusing the
    // candidate's answer over the organiser's defect is the wrong party to
    // punish, and the builder shows it to the organiser instead.
    const field = {
      id: "x",
      type: "short_text" as const,
      label: "X",
      validation: { pattern: "(a+)+$", pattern_message: "nope" },
    };
    expect(validateField(field, "aaaa")).toBeUndefined();
  });

  it("number bounds and date bounds are each compared in their own type", () => {
    expect(validateField({ id: "n", type: "number", label: "N", validation: { min: 0, max: 10 } }, "11")).toMatch(
      /10 or less/,
    );
    expect(
      validateField({ id: "d", type: "date", label: "D", validation: { max: "2010-12-31" } }, "2011-01-01"),
    ).toMatch(/2010-12-31 or earlier/);
    expect(
      validateField({ id: "d", type: "date", label: "D", validation: { max: "2010-12-31" } }, "2009-01-01"),
    ).toBeUndefined();
  });
});
