# 0005. Organiser auth, workspaces and roles before the candidate runtime

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

The PRD's roadmap ships a pilot in v0.1 — a test behind an access code, taken by
candidates — and defers workspaces, roles and organiser sign-in to v0.2. Build order
followed the PRD until the build roadmap was written, at which point the ordering was
inverted: auth became Phase 3 and the candidate runtime Phase 6.

This record is written after the fact. Phase 3 has shipped its permission matrix,
sessions and organiser screens, and [`docs/ROADMAP.md`](../ROADMAP.md#auth-moved-ahead-of-the-candidate-runtime)
already carries the reasoning. That file names three decisions extending the PRD and
says each needs its own ADR before its phase starts; the other two have issues
([#103](https://github.com/SriSatyaLokesh/pariksha/issues/103),
[#109](https://github.com/SriSatyaLokesh/pariksha/issues/109)) and this one had neither
an ADR nor an issue. The decision is not in question — it is already built on — but a
decision that lives only in a roadmap table is not discoverable from the code it shaped.

Three forces drove the inversion.

**Tenant scoping cannot be retrofitted cheaply.** `workspace_id` is on every table that
holds tenant data, and every repository function takes it as its first argument
(`S-09`). Adding that to a schema written without it means a migration over every table,
a rewrite of every query, and an audit with no way to prove completeness. Writing it
first costs a column; writing it later costs the data model.

**Two later phases need a workspace with an owner before they can exist at all.** The
public demo (Phase 10) provisions a workspace per visitor, and BYOK key storage (Phase 9)
encrypts a key *per workspace* and refuses a request whose key does not belong to the
calling workspace. Neither is expressible without memberships and a server-enforced
permission check.

**The landing page is the only part of Phase 3 that is independent of the API**, which is
why its tasks could and did ship ahead of Phase 2.

## Decision

Organiser authentication, workspaces, memberships, the permission matrix and the audit
log are built in Phase 3, before the candidate runtime in Phase 6. The PRD's v0.1/v0.2
split describes *product* milestones and is not the build order; where the two disagree,
the PRD decides *what* and the build roadmap decides *when*.

Two consequences of the Cloudflare reference stack ([ADR 0002](0002-cloudflare-reference-stack-with-adapters.md))
constrain what "auth" can mean in this phase, and are part of this decision:

- **No password sign-in on Workers.** The free plan allows 10 ms of CPU per invocation,
  which does not stretch to Argon2id (`S-01`). Phase 3 ships OIDC (authorization code
  with PKCE, any discovery-capable provider) and email magic link only. Email and
  password with optional TOTP is a Docker-only feature and belongs to Phase 11.
- **Candidate access is not organiser auth.** The four candidate access modes (`T-20`)
  are per-test configuration, not accounts, and are built in Phases 5 and 6. Nothing in
  this decision gives a candidate a user row.

## Consequences

**Easier.** Every phase after this one is written inside a workspace, with `can()` and a
`requires(action)` guard already available, so no feature has to invent its own
authorization. The demo and BYOK phases become possible rather than blocked. The
tenant-isolation test suite (`AC-23`) exists before there is data to leak.

**Harder.** The first externally visible value — a candidate finishing a test and getting
a score — moves three phases later than the PRD proposed. Phases 1 to 5 deliver nothing
an end user can use, which is a real cost in feedback: the first time a real candidate
touches Pariksha is after five phases of unvalidated assumptions about what they need.

**To watch.** Password sign-in is deferred to Phase 11 on a CPU-budget argument that is
specific to the Workers free plan. If the reference stack changes, revisit `S-01` rather
than inheriting the restriction. And because candidate access deliberately has no user
row, any later request to let a candidate "log in and see their history" is a new
decision, not an extension of this one.
