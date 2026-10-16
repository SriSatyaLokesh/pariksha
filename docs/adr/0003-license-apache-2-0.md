# 0003. License: Apache-2.0

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Pariksha must be free for anyone to run: a college placement cell, a training institute, a community meetup, a company's hiring team. Two licence families were considered.

A strong copyleft licence (AGPL-3.0) would force anyone offering a modified Pariksha as a hosted service to publish their changes. A permissive licence (Apache-2.0, MIT) lets anyone adopt, embed and host it with no obligation to share changes back.

Three facts decided it:

- The people we want to adopt Pariksha first — schools, colleges, small companies — are exactly the ones whose legal or IT policies most often ban AGPL dependencies outright.
- The project's value is the open **formats** (question, bank, test JSON) and the community of question banks around them. Adoption of the format matters more than control of forks.
- Apache-2.0 carries an explicit patent grant and a trademark clause, which AGPL and MIT do not. For a platform that will carry proctoring and scoring logic, that explicit grant is worth having.

## Decision

- Code is licensed under **Apache-2.0**.
- Documentation, JSON Schemas and the sample question banks and tests in `examples/` are licensed under **CC BY 4.0**, so they can be reused in any tool, including non-Pariksha ones.
- Contributions are accepted under the same terms, inbound = outbound (Apache-2.0 §5). No separate CLA is required; each commit is signed off under the [Developer Certificate of Origin](https://developercertificate.org/).

## Consequences

- Anyone may self-host, modify, embed or offer Pariksha commercially, including as a closed hosted service. We accept that.
- Contributors keep copyright in their own work; the patent grant protects every user of the project.
- "Pariksha" as a name is not licensed with the code. A fork may use the code, not the project's name, to describe itself (Apache-2.0 §6).
- Every source file carries no licence header; the top-level `LICENSE` covers the repository.

## Alternatives considered

| Licence | Why not |
| --- | --- |
| AGPL-3.0 | Blocked by the policies of many of our target adopters; network-copyleft brings little benefit when the project's goal is format adoption |
| MIT | Equivalent in practice to Apache-2.0 here, but with no explicit patent or trademark terms |
| BSL / source-available | Not open source; contradicts the project's purpose |
