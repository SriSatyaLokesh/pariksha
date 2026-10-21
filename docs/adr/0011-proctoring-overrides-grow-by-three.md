# 0011. Proctoring overrides grow by three, with no format bump

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

Task 1 of Phase 7a ("the contract") landed `packages/core/src/proctoring.ts` —
`ProctoringOverrides`, the fifteen snake_case keys `resolveProctoring()` reads,
and `PROCTORING_DEFAULTS` for `off`, `standard` and `strict`. The type was
written to the phase's full design; `schemas/test-1.json`'s
`proctoring.overrides` was not updated alongside it and still names only
twelve. `P-10` needs the other three to be writable at all:
`camera_outage_seconds` and `multi_face_snapshots` are the two thresholds it
names, and `Q12` adds `require_microphone`. Separately, `Q11` asks for
`snapshot_interval_seconds: 0` to mean "camera on, one identity photo, then
stop" — a combination the schema's `minimum: 15` made inexpressible.

The question this record answers is not whether to add them — Task 1 already
committed to the fifteen keys — but whether doing so is a breaking change to
`pariksha/test@1`, the document format every exported test and every
candidate-authored file is stamped with.

## Decision

**It is not.** Three optional keys join an *override* object that already
validates under `additionalProperties: false`, and one `minimum` *widens*.
Neither needs a format bump:

- `camera_outage_seconds`, `multi_face_snapshots` and `require_microphone` are
  every one of them optional — `ProctoringOverrides` is a `Partial<{...}>`,
  and `resolveProctoring()`'s `overrideOr()` already falls through to the
  profile default for a key that is absent. A `pariksha/test@1` document
  written before this record still validates unchanged. A document written
  after it, read by a build that has not taken this change, still validates
  too: the unknown keys are simply absent from that reader's type, and
  nothing upstream of resolution inspects `overrides` by anything other than
  key lookup.
- `snapshot_interval_seconds`'s `minimum` moves from `15` to `0`. A widened
  `minimum` admits documents the old schema rejected (`0`) and rejects none
  it accepted — every value that validated at `minimum: 15` still validates
  at `minimum: 0`. That is a strict superset of what the format already
  promised to accept, not a new promise.

`face_check` ships in the schema already and is untouched here; it is named
only because the round-trip test this task adds carries it alongside the
three new keys, proving that a document authored for the phase `Q3` pre-cuts
it for still imports, round-trips and exports — `resolveProctoring()` refuses
to act on it, but refusing to act on a key is a resolver decision, not a
format one.

## Consequences

**Easier.** A fourth optional override can join the same way, under the same
reasoning, without this record being revisited: add the key to
`ProctoringOverrides`, add it to the schema's `properties` under the same
`additionalProperties: false`, give `resolveProctoring()` a default to fall
through to. No version bump, no migration, no dual-reading of old and new
documents.

**Harder.** Nothing new — the schema and the type were already required to
name the same keys; this record just restores that after Task 1 moved first.

**To watch.** The two moves this record generalises from are the only two
that are free:

- **A *required* key would need the bump this one does not** — a document
  missing it would stop validating, which is exactly the breaking change
  `additionalProperties: false` plus "every key optional" was built to avoid.
- **A *narrowed* constraint would need it too** — tightening a `minimum`,
  removing an enum value, or similar would reject documents the current
  schema accepts, the mirror image of the widening made here.
