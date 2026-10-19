# 0007. Review comments on a draft test

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

`docs/design.md`'s "Decisions that need an ADR" names this one (`UX-10`): review
comments on a draft test. The string "review comment" appears nowhere in
`docs/PRD.md` — `UX-10` is `docs/design.md`'s own addition, argued there from the
case study's one real gap — so this is not an implementation of a PRD requirement
but a decision to extend the PRD, recorded here the way the roadmap's other three
extensions are (`docs/ROADMAP.md` § "Decisions that extend the PRD").

[#148](https://github.com/SriSatyaLokesh/pariksha/issues/148) names four questions.
Phase 5 has eleven other task issues and none of them is this one, so without an
answer here, #54 (test CRUD) or #61/#62 (lifecycle) would end up inventing the data
model while building something else — exactly the drift an ADR exists to prevent.

Everything the authoring model stores today is content — banks, questions, tests,
versions — written by whoever holds `tests.edit` or `banks.edit` about their own
work. A comment is the first row that is **a person's words about a colleague's
work**, and that changes what retention, export and the permission matrix each
have to say about it.

## Decision

**Export.** Comments never leave with the test. `pariksha/test@1` gains no
`comments` key. `docs/test-format.md` § Shape lists the document's keys
(`timing`, `access`, `consent`, `registration_form`, `proctoring`, `scoring`,
`sections`, `release`, `retention`) and none of them is reviewer discussion; the
format is explicitly portable into another installation (#63 ships whole-test
export and import), and a workspace's internal review thread travelling into
another organisation's database on export is the kind of leak nobody asks for
until it has already happened. `docs/design.md:335` proposes the same answer.

**Anchoring.** A comment carries `anchor_kind` (`test` | `section` | `question`)
and a nullable `anchor_id`. This is #148's own suggestion, and it is far cheaper
to design into the first migration than to retrofit onto a table already holding
rows: `UX-10`'s "send for review" flow exists so a reviewer can point at
something specific, and a comment table with no anchor column would need a
backfill the day that is asked for.

**Who may comment.** A fourteenth permission action, `tests.comment`, held by
Owner, Admin, Author and Reviewer — **added by the task that builds commenting,
not by this ADR.** `packages/core/src/permissions.ts` gives the Reviewer role no
`tests.edit` (confirmed by `packages/core/test/permissions.test.ts`'s existing
`AC-23` assertion and the new pin this ADR adds alongside it), so the one role
`UX-10` exists for could not comment under any action the matrix already grants.
But an action nothing enforces yet is a row `apps/api/test/authorization.test.ts`
cannot check — `AC-23` requires every role-action pair to actually succeed or
403 — so adding `tests.comment` now would be a matrix entry with no route behind
it. It is added when the comment table and its routes are, in the same commit
that makes it checkable.

**Retention.** Comments are organiser data, not candidate data: deleted when
their test is deleted, untouched by the `S-13`/`S-14` retention and
candidate-deletion jobs (both written around candidate registrations, answers
and snapshots — `docs/PRD.md` S-13, S-14 — not around organiser discussion), and
left attributed to the user ID when a member is removed from the workspace, with
the display name resolved at read time rather than copied into the row. This
also settles #148's last question: **resolving a thread is a state on the
thread, never a deletion.** `S-18`'s audit log is append-only (sign-ins, role
changes, publishes, key changes, regrades, exports and deletions, kept 12
months), and a comment thread that a reviewer resolves is closer to that record
than to a candidate's expired snapshot — the discussion stays, marked settled,
rather than disappearing the way a retention sweep would make it disappear.

**What this costs**, named explicitly because an ADR that extends the PRD is
required to say so: a fourteenth permission action and a new `AC-23` matrix row
to enforce (deferred to the comment-building task, above, but owed there); one
new table, `test_comment` (or equivalent), scoped by workspace like every other
tenant table; and retention and export obligations that a content row never
carried — a comment is the first row Phase 8's retention job and #63's export
both have to know to leave alone rather than sweep or ship, which is a new
exception each of those systems has to carry correctly rather than a case that
falls out of their existing rules for free.

## Consequences

**Phase 5 ships only `review_requested` on a test** — a boolean flag Task 2
adds to the `test` table, and the "In review" badge on the test list (Screen 6).
That is the half of `UX-10` this phase builds. The reviewers panel (Screen 10),
the comment table itself, anchoring UI, and approvals are **not built in Phase
5** — see Known deferrals.

**Known deferrals.**

- The `test_comment` table, its routes, and the `tests.comment` permission
  action — built together, by whichever later task implements commenting, per
  the Decision above.
- The reviewers panel and the anchoring UI (`UX-10`, `UX-11`, Screen 10 in
  `docs/design.md`'s screen inventory).
- Approvals — `UX-10`'s flow describes a reviewer commenting, not signing off;
  whether approval is itself a tracked state is a question this ADR does not
  answer because #148 does not ask it.
- The `AC-23` matrix row for `tests.comment` — it cannot exist before the action
  does, and the action does not exist until there is a route to check it
  against.

**To watch.** If a future phase wants comments to survive a test clone (Task 2's
clone copies the draft, not its discussion) or wants an organiser-facing export
of review history for compliance reasons, both are reversals of the Export
decision above and need their own record, not a quiet change to the export
mapper.
