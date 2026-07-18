# Definition of Done

A phase is complete only when its stated acceptance criteria are met and the repository remains healthy.

## Required for every implementation phase

### Scope

- The implementation satisfies the active phase prompt.
- Explicit non-goals were not implemented speculatively.
- Unrelated files were not rewritten without justification.

### Architecture

- Dependency direction remains valid.
- The simulation package remains independent of web, rendering, persistence, platform, and networking libraries.
- Authoritative state is not moved into React, Zustand, R3F, Dexie, or transport adapters.
- New durable decisions are documented.

### Type safety and code quality

- Strict TypeScript checks pass.
- No broad `any`, ignored type errors, or unsafe casts were introduced without an explicit documented reason.
- Linting passes.
- Formatting validation passes.
- Public package APIs are deliberate and use package exports where appropriate.

### Tests and TDD

- Observable simulation behaviour was introduced test-first unless the completion report documents why the task was not behavioural.
- A defect fix includes a regression test that failed before the fix.
- Unit and integration tests cover introduced behaviour.
- Tests cover relevant invariants, error cases, and boundary conditions rather than only happy paths.
- Deterministic systems control time, randomness, and command ordering.
- Browser smoke tests cover user-visible foundation behaviour when relevant.
- Tests do not depend on arbitrary sleeps when an observable condition can be awaited.
- Existing tests continue to pass.
- Required package coverage thresholds pass once established by the roadmap.
- Coverage exclusions were not broadened to hide untested logic.

### Build and runtime

- Dependency installation succeeds from the committed lockfile.
- Every affected package builds.
- The web application production build succeeds when the web app is affected.
- Development startup is documented and works.
- No required runtime error appears in the browser smoke path.

### Documentation

- README instructions match actual commands.
- Architecture, decision, testing, or development documents are updated for durable changes.
- The phase report lists commands executed and their outcomes.

## Minimum validation command categories

The root workspace must provide equivalents of:

```text
install with immutable/frozen lockfile semantics
format check
lint
typecheck
unit/integration test
workspace build
Cypress browser test
```

Before Phase 4 behaviour begins, validation and CI must additionally include simulation package coverage with the thresholds defined in `testing-strategy.md`.

A phase prompt may add package-specific, PWA-specific, determinism, serialization, or coverage validation.

## Failure handling

If a required command cannot run because of the execution environment:

1. do not report it as passed;
2. report the exact limitation and any evidence gathered;
3. run the closest meaningful validation that is possible;
4. leave clear reproduction instructions.

## Completion report format

At the end of each Codex implementation task, report:

```text
Summary
- concise description of the implemented result

Changed
- important files/packages and why

Validation
- exact commands run
- pass/fail result for each
- runtime version used

Acceptance criteria
- criteria satisfied
- criteria not satisfied, if any

Follow-up
- unresolved issues and intentionally deferred work only
```
