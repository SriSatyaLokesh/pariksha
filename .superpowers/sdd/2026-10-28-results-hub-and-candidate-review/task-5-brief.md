# Task 5 Brief: End-to-End Verification & Documentation

## Files
- Modify: `docs/superpowers/specs/2026-10-28-results-hub-and-candidate-review-design.md`
- Modify: `docs/superpowers/plans/2026-10-28-results-hub-and-candidate-review.md`
- Progress Ledger: `.superpowers/sdd/2026-10-28-results-hub-and-candidate-review/progress.md`

## Global Constraints & Style
- **Git Author:** Every git commit MUST use `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.
- **Zero Regressions:** All linting, typechecking, and test suites across all packages in the monorepo must pass with 0 errors.

## Requirements

### 1. Monorepo Typecheck & Lint
Run:
```bash
pnpm typecheck
pnpm lint
```
Ensure all workspaces (`@pariksha/core`, `@pariksha/db`, `@pariksha/api`, `@pariksha/web`, `@pariksha/storage`) pass cleanly.

### 2. Monorepo Tests
Run:
```bash
pnpm test
```
Verify all packages pass.

### 3. Update Documentation
- In `docs/superpowers/specs/2026-10-28-results-hub-and-candidate-review-design.md`:
  - Update `Status: Approved / Implemented`.
- In `docs/superpowers/plans/2026-10-28-results-hub-and-candidate-review.md`:
  - Check all remaining task checkboxes.
- In `.superpowers/sdd/2026-10-28-results-hub-and-candidate-review/progress.md`:
  - Mark all tasks completed.

### 4. Commit
```bash
git add docs/superpowers/specs/2026-10-28-results-hub-and-candidate-review-design.md docs/superpowers/plans/2026-10-28-results-hub-and-candidate-review.md
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "docs: complete implementation plan for results hub and candidate review"
```
