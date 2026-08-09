# Codex Task — Phase 3A Time and Contract Foundation

> **Document status:** Historical phase task/review prompt. Use only to
> reproduce or review the named phase. Current work follows `AGENTS.md`,
> [`../current-state.md`](../current-state.md), and the user's active request.

## Required reading

Before editing:

1. Read `AGENTS.md`.
2. Read every document linked from `docs/project-foundation.md`.
3. Read:
   - `docs/architecture/time-model.md`;
   - `docs/architecture/decisions/0003-simulation-time-and-playback-pacing.md`;
   - `docs/development/phase-3-plan.md`.
4. Inspect the current workspace, package exports, TypeScript project references, ESLint boundaries, Vitest setup, and CI workflow.
5. Briefly state the implementation plan before modifying files.

## Objective

Implement Phase 3A only: the environment-neutral simulation-time primitives, protocol position primitives, and pure host-side playback/bonus calculations required for later Phase 3 milestones.

Use test-driven development. Add failing behavioural tests before each implementation unit where practical. Do not implement transport-game mechanics or platform adapters.

## Architecture rules

- `packages/simulation` remains deterministic and environment-neutral.
- `packages/protocol` remains serializable, adapter-neutral, and independent of simulation implementation details.
- `packages/simulation` must not import `packages/protocol` during this task.
- Browser/application pacing logic must not become authoritative simulation state.
- No React, Three.js, Zustand, Dexie, Worker, Socket.IO, DOM, browser timer, or filesystem dependency may enter either library.
- Cross-boundary runtime data must be JSON-safe and runtime-validated.
- Do not use wall-clock reads in tested business logic.

## Required implementation

### 1. Simulation-time primitives

In `packages/simulation`, implement and export a small public API for:

- validated non-negative safe-integer `SimulationTick` values;
- the constants:
  - 5 game seconds per tick;
  - 12 ticks per game minute;
  - 720 ticks per game hour;
  - 17,280 ticks per game day;
- exact derived game-time conversion;
- exact `tick -> UTC epoch milliseconds` conversion from `genesisUtcMs`;
- exact `UTC epoch milliseconds -> tick` conversion;
- rejection of instants before genesis or not aligned to a five-second boundary;
- validated whole-tick advancement counts;
- a deliberately trivial immutable foundation state with `tick` only, plus a pure `advanceTicks` operation.

Use integer arithmetic. Do not store floating-point authoritative time.

### 2. Protocol position primitives

In `packages/protocol`, implement and export validated, JSON-safe primitives for:

- `CommandRevision`;
- `StreamOffset`;
- `TimelineId`;
- `RenderSnapshotSequence`.

These are distinct types/concepts. Do not design the final command/event catalogue and do not add Worker or Socket.IO APIs.

`TimelineId` may be an opaque validated string. Do not generate IDs through an environment-specific API inside the package; callers may provide them.

### 3. Pure playback policy module

Place host/application playback calculations outside the authoritative simulation state. Prefer a browser-neutral pure TypeScript module in `apps/web/src/simulation-host/` or another existing application-owned location consistent with current boundaries.

Implement and test:

- paused and active playback decisions;
- provisional 20x normal rate;
- configurable quiet-period rates, including 50x and 60x examples;
- effective rate calculation;
- a temporary 2x speed bonus;
- `remainingSimulationTicks` validation;
- bonus countdown by actual whole simulation ticks advanced;
- no countdown while paused;
- exact splitting when an advancement crosses the bonus-expiry boundary;
- a pure duration helper using:

  `durationSeconds = bonusTicks * 5 / effectiveRate`;

- examples proving:
  - 720 ticks at 20x equals 180 seconds;
  - 720 ticks at 40x equals 90 seconds;
  - 1,440 ticks at 40x equals 180 seconds.

Do not add browser timers or scheduling loops. This task implements arithmetic and state transitions only.

### 4. Command-order documentation contract

Do not implement a command processor yet. Add only the smallest exported type or documentation adjustment necessary to preserve this rule for Phase 3B:

- a command applies at the current tick before the next tick advances;
- tick advancement does not increment command revision;
- optimistic concurrency uses `expectedCommandRevision`, never the simulation tick.

### 5. Runtime validation

Use the repository's selected validation approach consistently. Public constructors/parsers must reject:

- negative values;
- fractions;
- `NaN` and infinities;
- unsafe integers;
- malformed opaque identifiers;
- non-aligned reverse date conversions.

Do not expose unchecked `number` values as validated domain primitives without a clearly named parsing/creation function.

### 6. TDD and coverage

Configure or extend Vitest coverage for the relevant packages using the existing toolchain.

Enforce package-level minimum thresholds before substantial game mechanics begin:

- statements: 95%;
- lines: 95%;
- functions: 95%;
- branches: 90%.

Keep tests deterministic and fast. Test public behaviour and invariants, including:

- constant relationships;
- minute/hour/day boundaries;
- multiple-day conversion;
- genesis conversion round trips;
- invalid input rejection;
- `advanceTicks(0)`;
- equivalent batched advancement;
- distinct position primitives;
- playback arithmetic;
- speed-bonus expiry and pause semantics;
- authoritative foundation state remaining identical regardless of playback calculations.

Do not chase thresholds with meaningless tests or exclusions. Any exclusion must be narrow and justified in the completion report.

### 7. Documentation consistency

Update existing documentation only where required to:

- link the time model and ADR from `docs/project-foundation.md`;
- mark Phase 2 complete;
- link `docs/development/phase-3-plan.md`;
- identify Phase 3A as the current milestone;
- replace `expectedRevision` with `expectedCommandRevision` where command concurrency is meant;
- keep `SimulationTick`, `CommandRevision`, `StreamOffset`, `TimelineId`, and render-snapshot sequencing distinct;
- state that reliable stream updates and replaceable render snapshots have different continuity requirements.

Do not broadly rewrite the accepted transport research.

## Explicit non-goals

Do not add:

- stations, routes, edges, buses, passengers, timetables, finances, incidents, or objectives;
- Worker runtime or Worker transport;
- Socket.IO packages or networking;
- Dexie tables or save workflows;
- Zustand simulation bridge;
- React UI features;
- R3F game visualization;
- ad-provider integration;
- wall-clock scheduling;
- final command, event, snapshot, or read-model catalogues.

## Validation

Run the repository-standard commands, including at minimum:

```text
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn build
yarn test:e2e
```

Also run the new coverage command and independent builds/tests for `packages/simulation` and `packages/protocol` where scripts permit.

Report the exact Node and Yarn versions used. If they differ from pinned versions, say so explicitly.

## Acceptance criteria

Phase 3A is complete only when:

1. the five-second integer time model is implemented and exported;
2. genesis UTC mapping works exactly in both directions;
3. invalid and non-aligned values are rejected;
4. the trivial simulation state advances deterministically through whole ticks;
5. command revision is not changed by tick advancement;
6. protocol position primitives are distinct and validated;
7. playback and bonus logic is pure application-owned code;
8. the 720/1,440 tick duration examples pass as tests;
9. playback decisions cannot affect authoritative foundation state;
10. coverage thresholds pass without meaningless tests;
11. all standard validation commands pass;
12. no deferred Phase 3B+ work or game mechanics were introduced.

## Completion report format

Finish with exactly these headings:

```text
Summary
Changed
TDD and coverage
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```
