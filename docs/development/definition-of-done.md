# Definition of Done

A phase is complete only when its stated acceptance criteria are met and the repository remains healthy.

## Required for every implementation phase

### Scope

- The implementation satisfies the active phase prompt.
- Explicit non-goals were not implemented speculatively.
- Unrelated files were not rewritten without justification.

### Architecture

- Dependency direction remains valid.
- The simulation package remains independent of web, rendering, persistence, and networking libraries.
- Authoritative state is not moved into React, Zustand, R3F, Dexie, or transport adapters.
- New durable decisions are documented.

### Type safety and code quality

- Strict TypeScript checks pass.
- No broad `any`, ignored type errors, or unsafe casts were introduced without an explicit documented reason.
- Linting passes.
- Formatting validation passes.
- Public package APIs are deliberate and use package exports where appropriate.

### Tests

- Unit/integration tests cover introduced behaviour.
- Browser smoke tests cover user-visible foundation behaviour when relevant.
- Tests are deterministic and do not depend on arbitrary sleeps when an observable condition can be awaited.
- Existing tests continue to pass.

### Build and runtime

- Dependency installation succeeds from the committed lockfile.
- Every affected package builds.
- The web application production build succeeds when the web app is affected.
- Development startup is documented and works.
- No required runtime error appears in the browser smoke path.

### Documentation

- README instructions match actual commands.
- Architecture or decision documents are updated for durable changes.
- The phase report lists commands executed and their outcomes.

## Minimum validation command categories

The exact script names will be established in Phase 1, but the root workspace must provide equivalents of:

```text
install with immutable/frozen lockfile semantics
format check
lint
typecheck
unit/integration test
workspace build
Cypress browser test
```

A phase prompt may add package-specific or PWA-specific validation.

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

Acceptance criteria
- criteria satisfied
- criteria not satisfied, if any

Follow-up
- unresolved issues only
```
