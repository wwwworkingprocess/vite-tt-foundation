# Testing Strategy

**Document status:** Current testing contract

## Purpose

Torrevieja Tycoon's simulation core is a standalone rules engine. Correctness
must not depend on React, rendering, browser timing, IndexedDB, workers, or
networking. Test-driven development is therefore an architectural technique, not
only a quality check after implementation.

## Core workflow

For new simulation behavior, use red-green-refactor:

1. **Red:** express the required behavior, invariant, corruption rejection, or
   regression as a failing test.
2. **Green:** implement the smallest coherent passing change.
3. **Refactor:** improve structure while the suite remains green.

Documentation-only work, build configuration, coverage discovery, and
mechanically safe refactors do not require a manufactured failing test. A defect
fix begins with a regression test that fails for the defect whenever the public
boundary can express it.

## Test layers

### Behavioral unit tests

Exercise public operations and observable outcomes. Avoid tests that merely
reproduce private implementation steps.

### Invariant and conservation tests

Protect properties that must never be violated, including:

- non-negative safe-integer counts;
- valid graph locations and exact route/pattern/occurrence identity;
- vehicle capacity;
- monotonic ticks, revisions, runs, and calls;
- passenger ownership conservation across lifecycle states;
- immutable inputs and previous states;
- bounded current-tick events;
- non-destructive restore failure.

### Determinism and equivalence tests

Given the same initial scenario, derived plans, commands, and tick advancement,
the simulation must produce identical authority.

Prove relevant equivalence among:

- split and batched advancement;
- fast-forward and repeated one-tick advancement;
- direct, structured-clone, and Worker execution;
- original and restored authority after continued advancement.

Do not use wall-clock time or rendering frames as authoritative inputs.

### Serialization, compatibility, and corruption tests

Snapshots and saves require round-trip tests. Every supported migration requires
source fixtures and exact expected results. Unsupported, obsolete, malformed,
or semantically impossible data must fail predictably.

Create valid authority first, `structuredClone` it, corrupt only the intended
coordinate, and restore through the real public boundary. Validators must not use
submitted events as evidence of their own truth or silently sort/repair corrupt
authority.

### Scenario tests

Scenario tests use the real parser/graph builder and verify package hashes,
identity, topology, route shapes, and representative simulation behavior.
Scenario data remains immutable unless a task explicitly authorizes data work.

### Adapter contract tests

Direct, Worker, persistence, pacing, and future network adapters are tested
through shared public contracts. Adapter-specific suites cover unique failures,
correlation, liveness, close terminality, clone boundaries, and storage/browser
behavior.

### Browser/PWA tests

Cypress verifies critical user-visible integration, Worker execution, root and
subpath loading, saves/restores, and offline PWA behavior. It does not replace
simulation tests or exhaustively test game rules.

## Coverage policy

Coverage is a guardrail against untested paths, not evidence that behavior is
correct.

Each workspace exposes a package coverage command, and root
`yarn test:coverage` runs all package reports. Configured threshold floors are
currently 95% statements/lines/functions and 90% branches; accepted milestones
may require 100% for targeted production surfaces.

Meaningful coverage rules:

- assert public behavior, exact errors, invariants, or lifecycle state;
- do not add unasserted calls solely to execute a line;
- do not mock language/library internals to manufacture impossible branches;
- do not add `c8`/Istanbul ignores for reachable logic;
- do not weaken thresholds or exclusions to accept a milestone;
- remove code only when a branch is proven mathematically impossible, duplicated
  by identical prior validation, or completely subsumed by a stronger invariant;
- retain independent defensive checks even when failure is rare.

Generated/declaration-only files and deliberate public export barrels may be
excluded only when they contain no runtime behavior. Runtime validators,
serializers, adapters, and controllers require tests.

## Test design rules

- Prefer table-driven tests for rules with multiple cases.
- Use descriptive domain language in test names.
- Assert events and externally observable state rather than private calls.
- Prefer deterministic fakes at real boundaries over internal mocks.
- Use controlled deferred promises instead of sleeps for races.
- Keep fixtures small and valid by default.
- Use builders only when they improve clarity.
- Assert exact ordering and identity where order is authoritative.
- A large scenario test does not excuse missing focused tests.
- Snapshot testing may support structure checks but must not be the only game-rule
  assertion.
- Restore all fake timers, globals, Workers, listeners, and repositories after a
  test.

## Validation tiers

- Focused package/test commands during development.
- `yarn validate` for the normal development gate.
- `yarn validate:portable` for complete audits, coverage, build, browser, PWA,
  and subpath validation.
- `yarn validate:repository` for tracked-output and clean-tree release checks.

The project owner may retain browser/Git validation responsibility for a task;
reports must distinguish developer-side preliminary evidence from authoritative
owner validation.

## Future extensions

Property-based and mutation testing may be introduced when they provide
measurable value. They do not replace focused deterministic behavioral and
corruption tests.
