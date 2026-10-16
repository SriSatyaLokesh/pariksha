# Contributing to Pariksha

Thank you for helping build an exam platform anyone can run for free. This guide covers how to propose a change, what we look for, and how you get credited.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Where to start

Pariksha is pre-alpha: the requirements, formats and schemas exist; the application code lands with v0.1. That makes the next few months the best time to join — the shape is decided, the implementation is not.

**No TypeScript required.** Pick whichever of these fits you:

| | What it involves | Where |
| --- | --- | --- |
| 📝 **Add a question set** | A subject folder with questions, answer keys and explanations. School science, engineering, nursing, comprehension, civil-service reasoning, anything | [`examples/`](examples/) |
| 🌐 **Translate** | Candidate-facing text and interface strings, especially Indian languages | from v0.1 |
| 🔍 **Review the design** | Read the [PRD](docs/PRD.md) and disagree with it in an issue. The [open questions](docs/PRD.md#risks-and-open-questions) most of all | an issue |
| 🧪 **Stress the formats** | Write a real test in [`pariksha/test@1`](docs/test-format.md) and report what you could not express | an issue |
| 📚 **Improve the docs** | The PRD, the format specs, the worked example, future guides | [`docs/`](docs/) |
| 💻 **Write code** | `packages/core` (scoring), `apps/api` (Hono), `apps/web` (React) | from v0.1 |

Issues labelled **`good first issue`** are scoped so you can finish them in an evening. Comment on one to claim it; if it goes quiet for a week it is free again.

For anything large — a new question type, a new storage or identity adapter, a change to the data model — open an issue or a discussion **before** writing code, so nobody's evening is wasted. If the change affects architecture, add an [architecture decision record](docs/adr/) to the same pull request.

## Contributing a question set

This is the single most useful thing an outside contributor can do right now.

1. Create `examples/<subject>/` — named after the subject, not after a format.
2. Write `questions.json` against [`schemas/bank-1.json`](schemas/bank-1.json). Give every question a key **and an explanation**; the explanation is what a candidate learns from in review.
3. Add `test.json` if you are contributing a whole test, and a short `README.md` saying who it is for, how long it takes and how it is scored.
4. **Original content only.** Do not copy questions from textbooks, past papers or other platforms. By contributing you license the content under CC BY 4.0.
5. Validate before opening the pull request:

```bash
npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/test-1.json -d "examples/*/test.json"
```

[`examples/reasoning-aptitude/`](examples/reasoning-aptitude/) is the model to copy.

## Development setup

The code base arrives with v0.1. It will be:

- Node.js 22 and pnpm 9
- `pnpm install`, then `pnpm dev` to run the web app and API locally against SQLite
- `pnpm test` (unit), `pnpm test:e2e` (Playwright), `pnpm lint`, `pnpm typecheck`

Until then, the validation commands above are the whole toolchain.

## Pull requests

1. Fork the repository and branch from `main`: `feat/…`, `fix/…`, `docs/…`, `examples/…`.
2. Keep each pull request to one change. Two unrelated fixes are two pull requests.
3. Add or update tests. **Scoring changes must include fixtures for correct, partly correct, wrong and blank answers**, for every mode that applies.
4. Update the docs and `CHANGELOG.md` (under *Unreleased*) when behaviour changes.
5. Write [Conventional Commits](https://www.conventionalcommits.org/): `feat(core): add numeric tolerance scoring`, `fix(api): reject answers after the deadline`, `docs(examples): add nursing question set`.
6. **Sign off every commit** to certify the [Developer Certificate of Origin](https://developercertificate.org/):

   ```bash
   git commit -s -m "feat(core): add numeric tolerance scoring"
   ```

   Sign-off means *you wrote this, or you have the right to contribute it*. If a tool helped you write it, you are still the author and still responsible for it; review it as if you had typed every line.
7. CI must pass, and one maintainer must approve, before merge.

There is **no CLA**. Contributions are inbound = outbound under [Apache-2.0](LICENSE) (and CC BY 4.0 for content), which is how the licence itself says it works.

## Principles we hold each other to

- **Zero cost by default.** A feature must fit inside the Cloudflare free tier, or be optional.
- **Privacy first.** No telemetry, no third-party scripts, no fonts or models loaded from somebody else's CDN. Collect only what a test asks for; keep it only as long as the organiser set.
- **The server is the only source of truth.** Answer keys never reach a browser. Client time is never trusted. The interface hides what a role cannot do; the server *enforces* it.
- **Flag, never judge.** Proctoring signals are evidence for a person to weigh, not a verdict. Nothing auto-disqualifies a candidate unless the organiser explicitly configured it.
- **Accessible.** WCAG 2.1 AA on every screen: keyboard-only use, screen-reader labels, contrast, 200% zoom. A candidate's disability must never cost them marks.
- **Write for a nervous 21-year-old.** Every error message should say what went wrong *and what to do next*.

## How you get credited

Every contributor is listed in [CONTRIBUTORS.md](CONTRIBUTORS.md) — for code, questions, docs, translations, design review, bug reports, anything. Add yourself in the same pull request as your contribution, or ask a maintainer to add you.

Security reporters are credited in the release notes, unless they ask not to be.

Steady contributors are invited to become maintainers; see [MAINTAINERS.md](MAINTAINERS.md).

## Reporting security issues

Never in a public issue. Follow [SECURITY.md](SECURITY.md).
