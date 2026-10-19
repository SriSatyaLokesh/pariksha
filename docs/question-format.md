# Pariksha question format (`pariksha/question@1`)

Pariksha stores and exchanges questions as JSON. The test that uses them is a separate file, described in [test-format.md](test-format.md). The format is versioned, documented here, and checked by the JSON Schemas in [`schemas/`](../schemas/). A file made for one Pariksha installation imports into any other.

## Bank file

A bank is a named list of questions, plus optional passage groups.

```json
{
  "$schema": "../schemas/bank-1.json",
  "format": "pariksha/bank@1",
  "name": "SQL basics",
  "license": "CC-BY-4.0",
  "groups": [{ "id": "orders-table", "title": "Orders table", "passage": "Markdown shown above each question in the group" }],
  "questions": [ ]
}
```

## Fields shared by every question

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Unique within the bank; letters, digits, `_`, `.` and `-`, up to 64 characters |
| `type` | Yes | One of the 12 types below |
| `prompt` | Yes | Markdown. Code blocks and LaTeX (`$…$`) allowed |
| `media` | No | Images: `{ "kind": "image", "src": "…", "alt": "…" }` (alt text required) |
| `group` | No | ID of a passage group in the bank |
| `difficulty` | No | `easy`, `medium` or `hard` |
| `tags` | No | Strings used by random pools, for example `["sql", "joins"]` |
| `scoring` | No | `{ "mode": "…", "points": 2, "negative_fraction": 0.25 }`; defaults come from the test |
| `explanation` | No | Markdown shown only in review, never during the test |
| `shuffle_options` | No | Default `true`; options marked `"pinned": true` never move |

## The 12 types

| `type` | Extra fields | Key |
| --- | --- | --- |
| `single` | `options: [{id, text, pinned?}]` | `key`: one option ID |
| `multiple` | `options` | `key`: array of option IDs (select all that apply) |
| `select_k` | `options`, `k` | `key`: array of exactly `k` option IDs |
| `true_false` | — | `key`: `true` or `false` |
| `assertion_reason` | `assertion`, `reason` | `key`: `both_true_explains`, `both_true_not_explains`, `a_true_r_false` or `a_false_r_true` |
| `matching` | `left`, `right` (string lists) | `key`: object mapping each left item to one right item; each right item used once |
| `multi_matching` | `left`, `right` | `key`: object mapping each left item to an array of right items |
| `ordering` | `items` | `items` are written in the correct order; Pariksha shuffles them for candidates |
| `fill_blank` | `blanks: [{id, accepted, match}]`; prompt contains `{{id}}` placeholders | `accepted`: list of answers; `match`: `exact`, `case_insensitive` (default) or `regex` |
| `numeric` | `unit?` | `key: {value, tolerance, tolerance_type}`; `tolerance_type` is `absolute` or `percent` |
| `short_answer` | `max_length` (≤ 500), `model_answer?`, `rubric?: [{level, points, description}]` | Graded manually, with the rubric if one is given |
| `long_answer` | `max_length` (≤ 5,000), `rubric?: [{level, points, description}]` | Graded manually, with the rubric if one is given |

## Scoring modes

| `scoring.mode` | Applies to | Rule |
| --- | --- | --- |
| `all_or_nothing` | All auto-graded types | Full points only for an exact match |
| `partial` | `multiple`, `select_k`, `matching`, `multi_matching`, `fill_blank` | points × (correct parts − wrong parts) ÷ total parts, never below 0 |
| `negative` | All auto-graded types | A wrong answer loses `negative_fraction` × points; a blank loses nothing |
| `position` | `ordering` | points × items in the correct position ÷ items |
| `rubric` | `short_answer`, `long_answer` | Sum of the rubric levels a reviewer picks; a question with no `rubric` scores 0 |

## Rules checked on import

The schemas check structure. The importer also checks:

- every option ID in a `key` exists in `options`
- no two options in one question share the same `text` — CSV and GIFT use an option's own text as its id, so a collision would silently rebind the answer key on export; this is checked for every format, including Pariksha JSON
- a `select_k` key has exactly `k` entries and `k` is less than the number of options
- every `matching` / `multi_matching` key uses only items from `left` and `right`, and every `matching` right item is used at most once
- every `fill_blank` blank has a matching `{{id}}` in the prompt, and every placeholder has a blank
- a `fill_blank` blank with `match: "regex"` has a pattern safe against catastrophic backtracking
- question IDs are unique within the bank, and every `group` exists

Import is all-or-nothing. A file with any error imports nothing and returns a list of errors with their positions.

## CSV and Moodle GIFT import

`POST .../import?format=csv` or `?format=gift` accepts a text file covering the five most common types — `single`, `multiple`, `true_false`, `numeric`, `fill_blank` — instead of a full `pariksha/bank@1` JSON document. Either format is converted into that same document first, so it is checked by exactly the rules above: a CSV or GIFT file with a bad key, a duplicate ID, or any other defect listed under "Rules checked on import" gets the same message a JSON import of the same mistake would, and fails the whole import the same way. A file over 2 MB is refused outright, before either converter reads it.

A cell that does not fit its own grammar — a `true_false` key that isn't exactly `true`/`false` (including `TRUE`, which spreadsheet software autocapitalizes), a `numeric` value or tolerance that doesn't parse as a number, a non-numeric `points` — is reported at its row, never silently turned into a plausible-looking wrong answer.

**Note:** an option's own text is its id (neither format has a separate id column). The importer refuses two options sharing identical text within a question, for every format including Pariksha JSON (see "Rules checked on import" above) — keep option text distinct within a question.

### CSV

The first row must be exactly the header below, in this order — a reordered or missing header is refused with one error naming the whole file, rather than silently binding every cell to the wrong column. Row 2 of the file (the first data row) is `bank.questions[0]`; a blank line anywhere is skipped, not treated as a malformed row.

| Column | Holds |
| --- | --- |
| `id` | The question ID |
| `type` | One of `single`, `multiple`, `true_false`, `numeric`, `fill_blank` |
| `prompt` | Markdown, as in JSON. A `fill_blank` prompt must contain a `{{id}}` placeholder for each blank named in `key` |
| `options` | `single`/`multiple` only: option texts, `\|`-separated. An option's own text is its id — `key` names an option by that same text |
| `key` | By `type`: `single` — the correct option's text. `multiple` — correct option texts, `+`-separated. `true_false` — exactly `true` or `false`. `numeric` — `value`, `value:tolerance`, or `value:tolerance:type` (`type` is `absolute` or `percent`), `value`/`tolerance` each a plain number. `fill_blank` — blanks, `\|`-separated, each `id:answer+answer`, `id` matching a `{{id}}` in `prompt` |
| `points`, `mode` | Optional; fill `scoring.points` / `scoring.mode` when given |
| `difficulty` | Optional: `easy`, `medium` or `hard` |
| `tags` | Optional, `\|`-separated |
| `explanation` | Optional Markdown |

A row naming a `type` outside the five, or with the wrong number of columns, is reported at its line and the import fails whole — it is never silently skipped or shifted into the wrong columns. A quoted field may contain an embedded newline (and so span more than one physical line); a later row's reported line still counts the real lines in the file, not the row's position in the list.

### Moodle GIFT

Only the forms that map onto the five types above are supported; `::title::` is optional and becomes the question's `id`. A `$CATEGORY` line, an essay (`{}`), a matching question (`->`), or a numeric range (`{#min..max}`) is reported at its line and fails the whole import — GIFT can write constructs this format cannot express, and an import that silently dropped them would tell an author they imported a bank that in fact lost questions.

```gift
// A comment, and a true/false question.
::Q1:: The sky is blue. {T}

::Q2:: 2 + 2 is {#4}

::Q3:: Pick the primes. {~%50%2 ~%50%3 ~%-100%4}
```

An answer block with only `=` entries (no `~`) is a fill-in-the-blank with one or more accepted answers; one with any `~` entry is multiple-choice — `single` when exactly one option has positive weight, `multiple` when more than one does (as in `Q3` above, where `2` and `3` both carry positive weight and `4` does not). An answer block with no `=` entry and no positively-weighted `~%weight%` entry has no correct answer at all, and is reported rather than guessed at. Per-answer feedback (`=Paris#Correct!`) is recognised and dropped — Pariksha has no field for it — rather than glued onto the option's own text.

## Example

[`examples/reasoning-aptitude/questions.json`](../examples/reasoning-aptitude/questions.json) contains one question of every type, with its answer key and explanation. The folder around it shows the same questions inside a complete test: [examples/reasoning-aptitude/](../examples/reasoning-aptitude/).

## Versioning

Format IDs carry a major version (`@1`). Fields may be added within a major version, and importers ignore fields they do not know. Renaming or removing a field, or changing a field's meaning, requires `@2`, a new schema file and a converter.
