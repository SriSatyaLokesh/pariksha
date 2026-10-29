# Task 2 Review: Web Client API & Navigation Shell Wiring

**Commits:**
- `02e618751015cf4fd04eb1b9323212bc9ec11508`: Initial Task 2 implementation
- `27e15426a7468e40f45fe469d412aec43f7e87e0`: Disambiguation of `rowFor` in `settings-rows.test.tsx` and `url-check.test.tsx`

**Verdict:** **APPROVED**

---

## Executive Summary

Commit `02e618751015cf4fd04eb1b9323212bc9ec11508` together with follow-up fix commit `27e1542` completely satisfies all requirements of Task 2 of the Results Hub and Candidate Review feature.
All backend interfaces are accurately reflected in TypeScript, client API methods are implemented with clean standard-library tools, `fakeClient` fixture stubs prevent fixture breakage, shell navigation and deep-link routing are wired cleanly, and all web tests and typechecks pass with zero errors.

---

## Checklist Verification

| Item | Status | Notes |
| :--- | :---: | :--- |
| **1. Ponytail style** | **PASS** | Minimal diff, standard Web API `URLSearchParams`, existing `ICONS.results` reuse, no extraneous dependencies or abstractions. |
| **2. Interface fidelity** | **PASS** | `TestResultsOverviewItem`, `TestResultAttempt`, `TestResultsSummary`, `TestResultsPayload`, and `ResultsQueryOptions` strictly match the backend schemas in `apps/api/src/routes/results.ts`. |
| **3. Zero fixture breakage** | **PASS** | `fakeClient` in `apps/web/test/fixtures/api-client.ts` has `resultsOverview` and `testResults` stubbed with `notStubbed(...)`. |
| **4. Shell and URL wiring** | **PASS** | `NavKey` and `NAV` updated in `OrganiserShell.tsx`; `VIEWS` updated in `view-url.ts`; `OrganiserView`, `fromUrl`, `paramsOf`, and `OrganiserApp` placeholder switch branch wired in `organiser.tsx`. |
| **5. Test and typecheck verification** | **PASS** | All targeted and collateral test suites pass cleanly: <br>• `test/testbuilder/settings-rows.test.tsx` & `test/testbuilder/url-check.test.tsx` (32 passed)<br>• `test/organiser-url.test.tsx` & `test/organiser/results-nav.test.tsx` (23 passed)<br>• `test/organiser.test.tsx` (82 passed)<br>• `pnpm --filter @pariksha/web typecheck` (0 errors) |

---

## Resolution of Pre-existing Test Disambiguation

In commit `27e1542`, the accessible name collision for `"Results"` was resolved by scoping `rowFor` in `settings-rows.test.tsx` and `url-check.test.tsx` to `within(screen.getByRole("region", { name: "Settings" }))`.
Both test files now execute cleanly without interfering with the shell rail's new "Results" navigation item.

---

## Verification Evidence

1. **URL & Navigation Shell Tests:**
   ```bash
   pnpm --filter @pariksha/web exec vitest run test/organiser-url.test.tsx test/organiser/results-nav.test.tsx
   # Output: 2 passed, 23 passed (23)
   ```

2. **Disambiguated Testbuilder Setting Row Tests:**
   ```bash
   pnpm --filter @pariksha/web exec vitest run test/testbuilder/settings-rows.test.tsx test/testbuilder/url-check.test.tsx
   # Output: 2 passed, 32 passed (32)
   ```

3. **Organiser Shell & App Tests:**
   ```bash
   pnpm --filter @pariksha/web exec vitest run test/organiser.test.tsx
   # Output: 1 passed, 82 passed (82)
   ```

4. **TypeScript Typecheck:**
   ```bash
   pnpm --filter @pariksha/web typecheck
   # Output: tsc -p tsconfig.json --noEmit exited 0
   ```
