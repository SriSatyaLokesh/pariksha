# Examples

Complete, runnable examples of Pariksha content. Everything here is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — copy it, change it, ship it with your own tests.

| Example | What it shows |
| --- | --- |
| [**reasoning-aptitude/**](reasoning-aptitude/) | **Start here.** A whole test, end to end: the question file, the test definition, the registration form, what the candidate sees on screen, how it is scored, and the results CSV that comes out |
| [technical-screening/](technical-screening/) | A question file only — SQL, Python and AI basics, one question of each of the twelve types |

Validate every example against the schemas, the same way CI does:

```bash
npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/test-1.json -d "examples/*/test.json"
```

## Contributing an example

Question sets in other subjects and languages are very welcome — school science, GATE-style engineering, nursing, language comprehension, civil-service reasoning, anything.

1. Make a folder named after the subject, not after a format: `examples/<subject>/`.
2. Put the questions in `questions.json`, and a `test.json` beside it if the example is a whole test.
3. Add a short `README.md` saying who the test is for, how long it is and how it is scored.
4. **Original content only.** Do not copy questions from a textbook, a past paper or another platform. By contributing you license the content under CC BY 4.0.
5. Run the validation commands above before opening the pull request.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the rest.
