# Definition of Done

**Document status:** Current completion contract

A task or milestone is complete only when its stated acceptance criteria are met
and the repository remains healthy.

## Required for every implementation task

### Scope

- The implementation satisfies the active request.
- Explicit non-goals were not implemented speculatively.
- Unrelated files were not rewritten without justification.
- Pre-existing working-tree changes were preserved and distinguished.

### Architecture

- Dependency direction remains valid.
- Simulation remains independent of web, rendering, persistence, platform, and
  networking libraries.
- Authoritative state is not moved into React, Zustand, R3F, Dexie, pacing, or
  transport adapters.
- Determinism, ordering, conservation, clone parity, and restore safety are
  preserved where relevant.
- New durable decisions update current contracts or ADR metadata without
  rewriting historical decision bodies.

### Type safety and code quality

- Strict TypeScript checks pass.
- No broad `any`, ignored type errors, unsafe casts, disabled rules, or coverage
  suppression were introduced without an explicit reviewed reason.
- Lint and formatting validation pass.
- Public package APIs and exports are deliberate.

### Tests and TDD

- New observable simulation behavior was introduced test-first unless the report
  documents why the task was non-behavioral.
- A defect fix includes a public regression test when the defect is expressible
  through the supported boundary.
- Tests cover relevant invariants, corruption, errors, ordering, conservation,
  split/batch behavior, and execution-boundary parity.
- Tests control time, randomness, messages, promises, and command order.
- Browser tests cover user-visible integration when relevant.
- Tests avoid arbitrary sleeps when an observable condition can be awaited.
- Existing tests and required coverage pass.
- Coverage exclusions/thresholds were not weakened to hide logic.

### Build and runtime

- Immutable installation succeeds when installation is part of the task.
- Every affected package builds.
- Web production build and budget audits pass when web output is affected.
- Root/subpath/PWA behavior passes when deployment assets or browser composition
  are affected.
- No required runtime error appears in the accepted smoke paths.

### Documentation

- README and current-state instructions match executable scripts and source.
- Durable current changes update current contracts.
- Historical phase records remain historical and receive supersession/applicability
  metadata rather than silent rewriting.
- All relative Markdown links resolve.
- The task report lists exact commands and outcomes.

## Validation tiers

Use the scripts present in root `package.json`.

```text
yarn validate             normal development gate
yarn validate:portable    complete portable audits/tests/coverage/build/browser/PWA gate
yarn validate:repository  tracked-output and clean-tree repository gate
```

Run focused package tests first. An active task may intentionally reserve
browser or Git validation for the project owner; this must be stated explicitly.
A phase prompt may add stricter package, determinism, serialization, scenario,
coverage, or budget gates.

## Failure handling

When a required command cannot run because of the environment:

1. do not report it as passed;
2. report the exact limitation and evidence gathered;
3. run the closest meaningful supported validation;
4. provide exact reproduction commands for the owner.

## Completion report format

```text
Summary
- concise implemented result

Changed
- important files/packages and why

Validation
- exact commands run and pass/fail result
- runtime version used
- commands reserved for owner validation

Acceptance criteria
- satisfied criteria
- unsatisfied criteria, if any

Follow-up
- unresolved issues and intentionally deferred work only
```
