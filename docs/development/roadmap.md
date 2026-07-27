# Development Roadmap

## Pre-Phase-4D shell refinement

The Phase 4C authority is presented through a single-screen,
visualization-first browser shell. Project metadata and detailed
simulation/persistence diagnostics are available through accessible dialogs;
scenario and principal session actions remain in compact navigation. SVG and
R3F views can exchange primary/minimap roles without changing authority.

This does not begin Phase 4D. A future city filter may narrow the scenario
catalogue using stable Wikidata Q-codes, and a later campaign screen may own
city progression. The current shell introduces neither state. The SVG remains
the authoritative diagnostic representation while the R3F boundary remains
available for a later production renderer based on line segments and instanced
elements.

The roadmap separates platform construction, architecture research, simulation development, representation, and game mechanics.

## Phase 0 — Architecture contract

### Goal

Create the repository root, durable documentation, Codex instructions, and bounded phase prompts.

### Status

Complete.

## Phase 1 — Strong project template

### Goal

Create a modern, reusable Yarn workspace with the selected stack, strict quality tooling, package boundaries, and minimal smoke implementations.

### Status

Complete after the architecture-enforcement correction. Final milestone verification should include a successful CI run under the pinned Node runtime.

## Cross-cutting rule — Test-driven simulation development

All actual simulation behaviour introduced from Phase 4 onward follows the test strategy in `testing-strategy.md`. Coverage enforcement must be installed and passing before Phase 4 game mechanics begin.

TDD extends the roadmap; it does not change package ownership or phase boundaries.

## Phase 2 — Socket.IO-readiness research

### Goal

Research and document how a future authoritative host could integrate through Socket.IO without coupling the simulation or client to Socket.IO semantics.

### Output

- an architecture decision record based on current official sources;
- proposed adapter-neutral client/host and transport boundaries;
- command, acknowledgement, event, snapshot, revision, and resynchronization recommendations;
- connection loss, duplicate delivery, ordering, refresh, and stale-client failure analysis;
- guidance for worker and future Socket.IO adapters sharing protocol contracts;
- an explicit list of deferred implementation work.

### Non-goals

- no Socket.IO package installation;
- no Socket.IO server or client;
- no Web Worker runtime;
- no final game command/event catalogue;
- no authentication, hosting, database, or multiplayer implementation;
- no transport simulation mechanics.

### Research result

The adapter-neutral decision and proposed contracts are recorded in `../architecture/decisions/0002-simulation-host-transport-readiness.md` and `../architecture/transport-contract.md`. Runtime implementation remains deferred to Phase 3 or later.

Phase 2 is complete.

## Phase 3 — Blank end-to-end platform

Phases 3A–3E are complete. Phase 3F release hardening is implemented locally;
Foundation Template v1.0.0 remains a release candidate until its exact-runtime
Linux and Windows CI gates pass.

### Goal

Prove the application boundaries with a deliberately trivial deterministic model.

### Includes

- typed browser-to-worker transport;
- local worker hosting a trivial simulation counter/model;
- immutable snapshots/read models delivered to the web client;
- Zustand bridge for application and presentation state;
- Dexie save repository implementation;
- save, restore, pause, and speed smoke behaviours;
- PWA offline and update lifecycle verification;
- R3F representation of trivial simulation output;
- adapter contract tests;
- package coverage command and CI enforcement required before Phase 4.

### Non-goal

No transport-game mechanics yet.

## Phase 4A — Canonical scenario domain foundation

### Status

Implemented: strict split scenario packages, immutable canonical StopNodes,
explicit ordered-pattern directed graphs, browser-owned integrity loading, and
the reviewed partial Torrevieja A2 development seed.

Torrevieja is the first scenario rather than a simulation assumption. Complete
network curation and source-data reconciliation remain external tasks.

## Phase 4B — Standalone non-graphical simulation integration

### Goal and status

Freeze-candidate hardening: a selected canonical scenario and derived graph are
bound to one authoritative timeline, with exact coordinates preserved through
compact transport snapshots and saves. Direct/clone-boundary/Worker lifecycle,
cross-scenario restore, and root/subpath offline behavior now have dedicated
behavioral evidence and critical-file coverage gates.

The temporary Torrevieja Mini test scenario exists only to prove multi-scenario
selection, authority, persistence, and offline restore behavior. This remains
Phase 4B hardening rather than Phase 4C mechanics.

## Phase 4C — Deterministic vehicles on directed edges

### Status

Freeze candidate: authoritative vehicles use immutable graph-native location
states and integer per-edge plans. Create/start commands and the existing tick
command operate through the single Worker/application/pacing/persistence stack.
Transport Snapshot/Save V3 preserve RouteId assignments and repeating ordered
route legs; V1 migration is explicit and empty, while V2 remains explicit
single-pattern authority. Transport client/Worker contracts are marked V3. A deliberately plain SVG
diagnostic maps the active canonical graph and integer fleet progress for
acceptance evidence only; it owns no simulation clock or state.

Services, schedules, dwell, dispatch, passengers, capacity, economics, traffic,
maps, and render interpolation remain deferred to Phase 4D or later.

## Phase 5 — React Three Fiber visualization POC

### Goal

Render the Phase 4 simulation through an abstract node graph.

### Includes

- stations and links;
- smoothly interpolated buses;
- passenger counts and occupancy;
- selection and inspection;
- play, pause, and speed controls;
- strict separation between logical progress and visual interpolation.

## Phase 6 — Torrevieja Tycoon vertical slice

### Goal

Begin the actual game by combining one coherent scenario, a minimal management loop, and a polished representation.

Detailed mechanics will be designed before this phase begins.

## Phase 7 and beyond — Ruleset growth

Develop a complete Easy game first, then grow the same engine through Normal and Realistic rulesets.

```text
Easy
  abstract node graph and simplified systems
      ↓
Normal
  expanded demand, capacity, transfers, costs, and disruptions
      ↓
Realistic
  greater operational, timetable, traffic, energy, and maintenance fidelity
```

The modes are configurations of one engine, not separate codebases.
