# Scientific calculator — design

Date: 2026-11-06. Status: draft for owner approval.

## Intent

Today a paper's settings have one checkbox, **"Allow the calculator"**
(`proctoring.overrides.allow_calculator`). Ticking it gives the candidate
a hand-written four-function calculator (`apps/web/src/components/exam/Calculator.tsx`).
That is useless for papers with trigonometry, logs, powers and roots.

The owner wants the admin to choose, per paper, **Off / Basic / Scientific**.
"Scientific" gives a GATE-style virtual calculator — the on-screen one
Indian engineering-exam candidates already know.

## Goals

- The admin picks one of three calculator modes per paper.
- Scientific mode gives the candidate a GATE-style calculator (key set below).
- Papers already published keep behaving exactly as they do today.

## Non-goals

- Per-section calculator settings. The owner said explicitly: one setting
  for the whole paper.
- Graphing, equation solving, matrices, statistics modes, unit conversion.
- Changing the Basic calculator. It stays as it is today.
- Logging calculator use as a proctoring event.

## Anti-goals (would make this a failure even if it works)

- A published paper with `allow_calculator: true` loses its calculator or
  changes calculator type.
- The candidate bundle grows by a maths library (the 300 KB gzipped budget
  in the PRD's non-functional table — see the comment at the top of
  `Calculator.tsx`).
- A calculator that can wedge: any input state must recover on the next
  key press, as Basic already does (`state.shown === "Error"` handling).
- Wrong answers from floating-point noise, e.g. `sin(180°)` showing
  `1.2246e-16` instead of `0`.

## Decided by the owner

- Three modes: **Off / Basic / Scientific**, set once per paper in the
  admin's paper settings, replacing the "Allow the calculator" checkbox.
- Scientific calculator looks and behaves like the GATE virtual
  calculator. The owner approved this mockup (kept in the gitignored
  `.superpowers/brainstorm/268-1793974691/content/calculator-v1.html`):

  - Title bar used as the drag handle (as Basic has today).
  - Display with two lines: the expression as typed (small, above) and
    the result (large, below).
  - A **Deg / Rad** switch and memory keys **MC MR MS M+ M−**.
  - An 8-column key grid:

    | | | | | | | | |
    |---|---|---|---|---|---|---|---|
    | sin | cos | tan | ( | ) | ⌫ | C | ± |
    | sin⁻¹ | cos⁻¹ | tan⁻¹ | 7 | 8 | 9 | ÷ | % |
    | sinh | cosh | tanh | 4 | 5 | 6 | × | 1/x |
    | log | ln | logᵧx | 1 | 2 | 3 | − | x² |
    | eˣ | 10ˣ | xʸ | 0 | . | π | + | √ |
    | n! | mod | ∛ | EXP | e | \|x\| | = (2 wide) | |

  - "Close calculator" text control at the bottom, like Basic.

## Decided by Claude (owner may override)

These were stated in conversation and not objected to, or are settled here.

1. **Basic is unchanged.** Same component, same behaviour, same tests.
2. **Legacy mapping, no DB migration.** A new override
   `calculator: "off" | "basic" | "scientific"` replaces
   `allow_calculator` in the schema, the editor and the resolver.
   `resolveProctoring` still *reads* the old key so published versions
   (their settings are frozen JSON) keep working: if `calculator` is
   present it wins; otherwise `allow_calculator: true` resolves to
   `"basic"` and `false` to `"off"`; otherwise the profile default.
   All three profiles default to `"off"`, as `allowCalculator: false`
   does today. The JSON schema (`schemas/test-1.json`) keeps accepting
   `allow_calculator` (so old documents still validate) and adds
   `calculator` as an enum. The editor writes only `calculator`, and
   drops `allow_calculator` from overrides when it does. No SQL
   migration is needed, so the CLAUDE.md migration-ordering trap does
   not apply.
3. **Resolved shape.** `ResolvedProctoring.allowCalculator: boolean`
   becomes `calculator: "off" | "basic" | "scientific"`. The attempt
   payload (`AttemptPaper` in `apps/api/src/run/attempt.ts` and its
   mirror in `apps/web/src/lib/paper.ts`) carries `calculator` in place
   of `allowCalculator`, both at the top level and inside its
   `proctoring` object. The Runner shows the "Calculator" button when
   it is not `"off"` and opens the matching component.
4. **Hand-written maths, no dependency.** The scientific evaluator is a
   small expression parser (recursive descent or shunting-yard) over
   `Math.*`. No new npm package.
5. **Input model follows GATE: binary operators build an expression,
   unary keys act on the current entry at once.**
   - The bottom line is the *current entry*: the number being typed, a
     constant, the last result, or the value of a just-closed `( … )`.
     The top line is the expression built so far.
   - **Binary keys** `+ − × ÷ xʸ mod` append the current entry and the
     operator to the expression. `=` evaluates the whole expression,
     closing any open brackets.
   - **Unary keys** replace the current entry with the function of it
     straight away, and the top line records it (`sin(30)`, `√(16)`).
     These are sin, cos, tan and their inverses and hyperbolic versions,
     log, ln, eˣ, 10ˣ, x², √, ∛, n!, |x|, 1/x, ± and %. So `30 sin`
     shows `0.5`, and `2 + 9 √ =` gives 5.
   - **logᵧx** is binary: type x, press logᵧx, type y, press `=`.
     `8 logᵧx 2 =` gives 3. The top line shows it as `log₂(8)`.
   - **π, e and MR** replace the current entry.
   - **After a result:** a digit starts a new expression, while a binary
     or unary key works on the result.
   - **No implicit multiplication.** `2π` is not a thing you can type;
     π replaces the 2, as on GATE. This keeps the parser free of the
     `6÷2(1+2)` ambiguity.
6. **Operator precedence inside the built expression:** brackets, then
   `xʸ` (right-associative), then `× ÷ mod`, then `+ −`, left to right
   within a level. `EXP` enters scientific notation (`2 EXP 3` = 2000).
7. **Degrees by default**, as on GATE. The Deg/Rad switch affects the
   trig functions and their inverses only, not hyperbolic ones.
8. **Precision and noise.** Results show up to 12 significant digits, as
   Basic's `show()` does. Trig in degree mode snaps exact multiples
   (`sin 180`, `cos 90`, `tan 45`) to their exact values. In either mode,
   a result of sin, cos or tan whose size is below 1e-12 shows as `0`,
   so `sin(π)` in Rad mode is 0. This snap applies **only** to trig
   outputs. Other results are never rounded to zero, because a genuinely
   tiny answer must survive. Very large or small results use `e`
   notation.
9. **Errors.** Malformed input, division by zero, `tan 90°`, `log` of a
   non-positive number, `n!` of a non-integer or a negative number, and
   overflow all show **"Error"**. The next key press recovers, and `C`
   always does.
10. **Memory, Deg/Rad and the last expression survive closing and
    reopening the calculator** within the same page. The calculator is
    modal (`aria-modal`, focus-trapped), so candidates close it to read
    the question, and losing their working each time would hurt. A page
    reload clears them.
10a. **Memory keys act on the current entry**, as on GATE. MS stores
    it, M+ and M− add it to or subtract it from memory, MC clears
    memory, and MR replaces the current entry with the stored value.
    While the display shows "Error" they do nothing. A small "M" marker
    in the display shows when memory holds a non-zero value.
11. **Keyboard.** Digits, `. + - * / ( ) ^ %`, Enter/`=`, Backspace,
    Escape (close) and `c`/`C` (clear) work from the keyboard, as in
    Basic. Function keys are click-only. Every key has an accessible name
    the same way Basic's `KEYS` table does (glyph plus word).
12. **Size.** About 440px wide, against Basic's 240px. It must stay
    inside the viewport and keep Basic's drag and arrow-key nudge
    behaviour. Same visual tokens as Basic (`exam.css`), with the royal
    accent on `=` only.
13. **Admin control.** A three-option control in the existing
    "Gating" group of `ProctoringPanel.tsx`, where the checkbox is now.
    The approved mockup shows a segmented control; a native `<select>`
    like the panel's Profile control is also acceptable. The panel's
    "differs from profile" marker and the profile-change confirmation
    must count it like every other override.

## Constraints

- Stack as it is: React 19 in `apps/web`, shared types in
  `packages/core`, JSON schema in `schemas/test-1.json`.
- Candidate bundle budget: 300 KB gzipped.
- Accessibility at the level Basic already meets: dialog semantics,
  focus trap and return, accessible names, 44px targets where the grid
  allows (the 8-column grid may need smaller keys; at least 24px per
  WCAG 2.5.8).
- CLAUDE.md: no worktrees, no Cloudflare commands; full suite only with
  `npx turbo run test --concurrency=1 -- --no-file-parallelism`.

## Places to update

- `packages/core/src/proctoring.ts`: overrides type, defaults, resolver.
- `schemas/test-1.json`, `docs/test-format.md`: the new override.
- `apps/api/src/run/attempt.ts`, `apps/web/src/lib/paper.ts`: payload field.
- `apps/web/src/components/testbuilder/ProctoringPanel.tsx`: admin control.
- `apps/web/src/components/exam/Runner.tsx`: choose the component.
- New `apps/web/src/components/exam/ScientificCalculator.tsx`, its CSS
  in `exam.css`, and its evaluator (its own module, so it can be tested
  without rendering).
- `apps/web/src/lib/demo-test.ts`: the public demo should use
  `"scientific"` so visitors can try it.
- Docs that describe the calculator: `README.md`, `docs/PRD.md`,
  `docs/candidate-faq.md`, `apps/web/src/seo/files.ts`, `CHANGELOG.md`.
- Tests touching `allowCalculator` / `allow_calculator`, including the
  API start test, the Runner tests and the proctoring-controls tests.

## Left to the builder

- Parser technique and module layout.
- Exact CSS, key sizes and spacing within the constraints above.
- Segmented control vs `<select>` for the admin control.
- How the evaluator's tests are organised. It needs real coverage:
  precedence, each function, deg/rad, the error cases, legacy-key
  resolution.
