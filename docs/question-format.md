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
- a `select_k` key has exactly `k` entries and `k` is less than the number of options
- every `matching` / `multi_matching` key uses only items from `left` and `right`, and every `matching` right item is used at most once
- every `fill_blank` blank has a matching `{{id}}` in the prompt, and every placeholder has a blank
- question IDs are unique within the bank, and every `group` exists

Import is all-or-nothing. A file with any error imports nothing and returns a list of errors with their positions.

## Example

[`examples/reasoning-aptitude/questions.json`](../examples/reasoning-aptitude/questions.json) contains one question of every type, with its answer key and explanation. The folder around it shows the same questions inside a complete test: [examples/reasoning-aptitude/](../examples/reasoning-aptitude/).

## Versioning

Format IDs carry a major version (`@1`). Fields may be added within a major version, and importers ignore fields they do not know. Renaming or removing a field, or changing a field's meaning, requires `@2`, a new schema file and a converter.
