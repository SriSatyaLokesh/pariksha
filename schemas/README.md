# Schemas

JSON Schemas (draft 2020-12) for Pariksha's open formats. Licensed under CC BY 4.0, so other tools can read and write these files too.

| Schema | Format ID | Describes |
| --- | --- | --- |
| [`question-1.json`](question-1.json) | `pariksha/question@1` | One question of any of the 12 types |
| [`bank-1.json`](bank-1.json) | `pariksha/bank@1` | A named collection of questions plus passage groups |
| [`test-1.json`](test-1.json) | `pariksha/test@1` | A whole test: timing, access, registration form, proctoring, scoring, sections, release |

The schemas check structure. Pariksha's importer also checks rules a schema cannot express — that every key refers to an existing option, that a `select_k` key has exactly `k` entries, that every question a section names exists in a bank. Those rules are listed in [docs/question-format.md](../docs/question-format.md) and [docs/test-format.md](../docs/test-format.md).

Validate a file:

```bash
npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/test-1.json -d "examples/*/test.json"
```
