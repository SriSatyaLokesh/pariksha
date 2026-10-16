# Example: technical screening questions

A question file only — no test definition. Twelve questions covering SQL, Python, AI basics and reasoning, one of **each** Pariksha question type. Use it to try an import, or as a template when writing your own.

| File | Contents |
| --- | --- |
| [`questions.json`](questions.json) | 12 questions, one per type, with keys and explanations |

For a complete test — registration form, sections, proctoring, scoring and results — see [`../reasoning-aptitude/`](../reasoning-aptitude/).

```bash
npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/technical-screening/questions.json"
```

Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
