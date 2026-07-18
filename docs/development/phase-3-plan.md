# Phase 3 Delivery Plan

## Goal

Prove the end-to-end application boundaries with a deliberately trivial deterministic model before implementing transport-game mechanics.

Phase 3 is one roadmap phase delivered through small, separately reviewed milestones.

## Cross-cutting method

All behavioural work in Phase 3 follows test-driven development:

```text
failing behavioural test
-> smallest implementation
-> passing test
-> refactor without behaviour change
```

Coverage enforcement is introduced before substantial mechanics. Coverage is a guardrail, not a substitute for behavioural and invariant tests.

## Phase 3A — Time, identity, and contract foundation

### Goal

Implement the minimum environment-neutral primitives needed by later host and adapter work.

### Includes

- five-second integer `SimulationTick` model;
- genesis UTC mapping;
- derived game-time utilities;
- `CommandRevision`, `StreamOffset`, `TimelineId`, and render-snapshot sequence primitives;
- host-side playback calculation as pure functions;
- temporary 2x speed-bonus tick budget as pure host/application logic;
- runtime validation at package boundaries;
- high package-level test coverage;
- documentation terminology updates.

### Non-goals

- no Worker;
- no Socket.IO;
- no Dexie;
- no Zustand bridge;
- no React/R3F changes beyond existing smoke code;
- no bus, station, passenger, route, finance, or game mechanics;
- no ad-provider SDK or reward flow.

## Phase 3B — In-memory simulation host

### Goal

Create a browser-neutral reference host around a trivial deterministic counter/model.

### Includes

- one command application path;
- idempotent command results;
- command revision handling;
- reliable stream offsets;
- replaceable render snapshots;
- full synchronization;
- contract tests against an in-memory client/host pair.

## Phase 3C — Web Worker adapter

### Goal

Run the reference host in a Worker through the shared protocol contract.

### Includes

- typed Worker messages;
- runtime validation;
- startup, close, crash, malformed-message, and recreation tests;
- shared adapter contract tests.

## Phase 3D — Persistence and application bridge

### Goal

Persist and restore the trivial model without moving persistence into the simulation.

### Includes

- Dexie save repository;
- simulation snapshot validation;
- separate persisted playback/bonus metadata;
- Zustand application/presentation bridge;
- save, load, delete, and restore tests.

## Phase 3E — Browser representation and PWA flow

### Goal

Represent trivial simulation output and verify the platform in a real browser.

### Includes

- R3F rendering of trivial deterministic output;
- pause and playback controls;
- visual interpolation that cannot mutate simulation state;
- Cypress save/reload and offline smoke coverage;
- PWA update lifecycle verification.

## Phase 3F — Foundation review

### Goal

Verify the platform before Phase 4 transport mechanics.

### Exit criteria

- package boundaries remain enforced;
- all validation commands pass under the pinned runtime in CI;
- simulation/protocol packages build independently;
- shared contract tests pass for in-memory and Worker adapters;
- coverage thresholds pass;
- save/restore is deterministic;
- playback and speed bonuses do not alter authoritative outcomes;
- no transport-game mechanics exist.
