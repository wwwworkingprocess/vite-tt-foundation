# Phase 3E — Browser Pacing, Speeds, and Bonus

## Goal

Add deterministic active-page pacing around the accepted Phase 3D
application controller, including pause, 20×/50×/60× modes, provisional
quiet-period acceleration, and a tick-counted 2× speed bonus.

## Milestones

### 3E.1 — Pure planner

Implement and test integer pacing-credit arithmetic, playback profiles,
quiet ranges, bonus expiry, and conservation invariants.

### 3E.2 — Pacing controller

Add a serialized application pacing controller with a read-only vanilla
Zustand projection.

It builds deterministic foundation advancement commands and commits plans
only after authoritative applied results.

### 3E.3 — Browser driver

Add a focused `requestAnimationFrame`/visibility adapter with one pulse in
flight and no hidden-page catch-up.

### 3E.4 — Minimal controls and real-browser smoke

Add accessible foundation controls and extend Cypress against the real
Worker.

## TDD order

1. Add failing pure planner tests.
2. Add failing pacing-controller tests.
3. Add failing browser-driver tests using injected browser primitives.
4. Demonstrate each red state.
5. Implement the smallest behavior per milestone.
6. Add the real Worker Cypress flow.
7. Refactor while green.
8. Run complete coverage and validation.

## Required invariants

- simulation receives only whole ticks;
- no browser time enters simulation state;
- planner conservation always holds;
- bonus decrements only after applied ticks;
- no overlapping pacing command;
- one pulse produces at most one batched command;
- quiet and bonus rate changes apply at exact tick boundaries;
- hidden intervals do not catch up;
- timeline replacement resets runtime pacing state;
- stale pulse completion cannot mutate a new session;
- pacing projection is read-only;
- no timers or scheduler code enters simulation/protocol packages.

## Dependency rules

Use existing React, Zustand, Worker, and testing dependencies.

Do not add a scheduling library, state-machine library, date library,
advertising SDK, or persistence middleware.

## Coverage

Retain:

```text
Statements  95%
Lines       95%
Functions   95%
Branches    90%
```

Pure planner, pacing controller, and browser driver production modules
must remain in coverage.

## Non-goals

Do not add:

- transport-game mechanics;
- route/stop datasets;
- vehicle or passenger behavior;
- bonus/ad entitlement verification;
- persistence of pacing state or bonus;
- autosave;
- hidden/background catch-up;
- WebSocket or Socket.IO;
- Worker restart;
- generic scheduler framework;
- production game UI;
- economic systems.

## Acceptance criteria

1. Pure planner uses whole ticks and deterministic integer credit.
2. Provisional 20×/50×/60× and quiet policy are implemented as config.
3. Tick-counted 2× bonus handles mid-interval expiry exactly.
4. Planner invariants and pulse-partition equivalence are tested.
5. Pacing controller serializes operations and commits only applied plans.
6. Session replacement invalidates stale pacing work and resets runtime
   pacing state.
7. Browser driver has one pulse in flight and no hidden catch-up.
8. Read-only pacing projection and minimal controls are present.
9. Real Worker Cypress proves advance, bonus, pause, and cleanup.
10. Coverage and all standard validation pass.
11. No Phase 4 mechanics or deferred product integrations are introduced.

## Completion report

Finish with:

```text
Summary
Changed
TDD and coverage
Pacing arithmetic and bonus semantics
Browser driver and visibility behavior
Worker/browser integration
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```

Report exact Node, Yarn, Cypress, browser, React, Zustand, and Vite
versions used.
