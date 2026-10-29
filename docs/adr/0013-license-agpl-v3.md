# 0013. License: GNU Affero General Public License v3.0 (AGPL-3.0)

- **Status:** Accepted
- **Date:** 2026-10-29
- **Supersedes:** [ADR 0003](0003-license-apache-2-0.md)

## Context

In [ADR 0003](0003-license-apache-2-0.md), Pariksha initially adopted Apache-2.0 to maximize early institutional adoption and avoid legal friction in conservative enterprise and academic IT environments.

However, as Pariksha evolved into a comprehensive end-to-end examination platform—incorporating a candidate runtime, multi-modal proctoring engines (visual presence, microphone monitoring, tab/window enforcement), automated grading ledgers, and exportable JSON format ecosystems—the risk profile changed substantially:

1. **Free-riding and SaaS enclosure:** Under Apache-2.0, proprietary cloud vendors and commercial exam platforms can fork Pariksha, host it as a closed commercial SaaS service, add proprietary proctoring and scoring enhancements, and charge per-candidate fees without contributing a single line of code back to the community.
2. **Asymmetric competition against self-hosters:** The core mission of Pariksha is to permanently eliminate the per-candidate/per-month tax on education and recruitment. A permissive license allows commercial providers to monetize the platform's proctoring investments while locking user data inside proprietary walled gardens.
3. **The network-use copyleft safeguard:** GNU Affero General Public License v3.0 (AGPL-3.0) specifically closes the "application service provider (ASP) loophole" through Section 13 (Remote Network Interaction). Any entity modifying Pariksha and serving candidates or organisers over a network must make the corresponding source code available under AGPL-3.0 to everyone interacting with that service.
4. **Precedent in modern infrastructure:** Industry peers with mission-critical self-hosted workflows (e.g. Grafana, Plausible, Formbricks, Cal.com) have demonstrated that AGPL-3.0 strikes the optimal balance: complete freedom for self-hosters, universities, and teams to inspect, modify, and run the software privately, combined with structural defense against predatory closed-source re-hosting.

## Decision

- **Code:** All platform application code (`apps/api`, `apps/web`) and internal library packages (`packages/core`, `packages/db`, `packages/storage`) are licensed under **GNU Affero General Public License v3.0** (`AGPL-3.0-only`).
- **Content & Standards:** Documentation, JSON Schemas (`schemas/`), and sample test banks in `examples/` remain under **Creative Commons Attribution 4.0 International (CC BY 4.0)**, preserving open portability and cross-tool interoperability for examination content.
- **Contributions:** Accepted inbound = outbound under the terms of AGPL-3.0 (and CC BY 4.0 for content). Each commit continues to be signed off under the [Developer Certificate of Origin](https://developercertificate.org/); no CLA is required.
- **Trademark:** The "Pariksha" name, brand assets, and logos remain protected marks of the project and are not licensed for derivative commercial branding under AGPL-3.0 §7(c).

## Consequences

- **Positive:**
  - Anyone hosting modified versions of Pariksha over a network must provide source code to their users (§13), ensuring community improvements (such as custom proctoring safeguards or grading plugins) flow back to the open ecosystem.
  - Self-hosters retain 100% unrestricted freedom to deploy, scale, and use Pariksha internally for universities, colleges, bootcamps, and enterprise hiring at zero license cost.
  - Transparent integrity: candidates taking an exam have the legal right to know and verify the scoring and proctoring algorithms being run against them.
- **Trade-offs:**
  - Companies seeking to build closed-source commercial SaaS products on top of Pariksha cannot do so under AGPL-3.0 without releasing their source code.
  - Commercial entities desiring proprietary, non-reciprocal exemptions or SLA guarantees would require commercial dual-licensing agreements.

## Alternatives considered

| License | Evaluation |
| --- | --- |
| **Apache-2.0 (retained)** | Rejected. Permissive terms leave the platform vulnerable to proprietary SaaS enclosure and asymmetrical exploitation by commercial testing services. |
| **GPL-3.0** | Rejected. Standard GPL copyleft only triggers on object-code distribution, failing to protect cloud-hosted web platforms and remote testing software where no binary is distributed. |
| **BSL / SSPL / Non-Compete** | Rejected. These are not OSI-approved open source licenses and impose arbitrary commercial restrictions that degrade trust for legitimate educational institutions and self-hosters. |
