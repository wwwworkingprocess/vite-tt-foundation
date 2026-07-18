# Testing Strategy

## Purpose

Torrevieja Tycoon's simulation core is a standalone rules engine. Its correctness must not depend on React, rendering, browser timing, IndexedDB, workers, or networking. Test-driven development is therefore a primary architectural technique, not only a quality check after implementation.

## Core workflow

For new simulation behaviour, use a red-green-refactor cycle:

1. **Red:** express the required behaviour, rule, invariant, or regression as a failing test;
2. **Green:** implement the smallest coherent change that makes the test pass;
3. **Refactor:** improve names and structure without changing behaviour while the test suite remains green.

Documentation-only work, build configuration, and mechanically safe refactors do not require manufacturing a failing test. Any changed observable behaviour does.

A defect fix begins with a regression test that fails for the reported defect.

## Test layers

### Behavioural unit tests

Test public simulation operations and outcomes through public package APIs. Examples include command acceptance, movement, boarding, capacity, time advancement, metrics, and objective evaluation.

Avoid tests that merely reproduce private implementation steps.

### Invariant tests

Continuously protect rules that must never be violated, such as:

- passenger counts cannot become negative;
- a vehicle cannot exceed capacity when capacity is enabled;
- a vehicle cannot occupy an invalid graph location;
- simulation time and revisions are monotonic;
- entities cannot silently disappear or duplicate;
- immutable inputs and previous states are not mutated.

### Determinism and replay tests

Given the same initial state, ruleset, random seed, and ordered commands, the simulation must produce identical events, snapshots, and final state.

Tests must control:

- the simulation clock;
- the random seed and random-generator state;
- command ordering;
- serialization versions.

Do not use wall-clock time or rendering frames as authoritative simulation inputs.

### Serialization and migration tests

Snapshots must support round-trip tests. Every supported migration requires fixtures for the source version and tests for the migrated result. Invalid or unsupported data must fail predictably.

The simulation may serialize, validate, migrate, and restore state. Storage adapters are tested separately through repository contracts.

### Scenario tests

Scenario tests exercise multiple systems over many ticks and verify player-relevant outcomes and invariants. They must remain runnable without React, a browser, a worker, or a database.

### Adapter contract tests

Worker, persistence, and future Socket.IO adapters should be tested against shared contracts. The same behavioural contract should be reusable for an in-memory adapter and platform-specific implementations.

### Browser tests

Cypress verifies critical user-visible integration paths. It does not replace simulation tests and should not be used to exhaustively test game rules.

## Coverage policy

Coverage is a guardrail against untested paths, not evidence that behaviour is correct.

Before Phase 4 introduces actual simulation mechanics, the repository must provide a package-level simulation coverage command and enforce minimum thresholds in local validation and CI.

Initial minimum targets for `packages/simulation` are:

| Metric     | Minimum |
| ---------- | ------- |
| Statements | 95%     |
| Lines      | 95%     |
| Functions  | 95%     |
| Branches   | 90%     |

These are repository-wide floors for the package, not targets to be reached through meaningless tests. Critical rule modules may require complete branch coverage through phase-specific acceptance criteria.

Coverage exclusions must be narrow, explicit, and documented. Generated files, declaration-only files, and deliberate public export barrels may be excluded when they contain no runtime behaviour. Excluding difficult business logic is prohibited.

Protocol runtime validators, serializers, and other executable behaviour require tests. Type-only declarations do not produce meaningful runtime coverage.

## Test design rules

- Prefer table-driven tests for rules with multiple cases.
- Use descriptive domain language in test names.
- Assert events and externally observable state rather than private helper calls.
- Prefer deterministic fakes over mocks of internal implementation.
- Do not use arbitrary sleeps when an observable condition can be awaited.
- Keep fixtures small and purpose-specific.
- Use builders only when they improve clarity and preserve valid defaults.
- A large scenario test does not excuse missing focused tests for individual rules.
- Snapshot testing may support structural output checks but must not be the only assertion for game logic.

## Future extensions

Property-based and mutation testing may be introduced during simulation development when they provide measurable value. They are not required during the project foundation or Socket.IO-readiness research phase.
