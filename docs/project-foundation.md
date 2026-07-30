# Torrevieja Tycoon — Project Foundation

## Purpose

Torrevieja Tycoon is a browser-based transport-management game inspired by Torrevieja's urban bus network.

The product is intentionally designed as two cooperating projects:

1. a standalone deterministic TypeScript simulation library;
2. one or more clients that represent and control that simulation.

The first client is a browser-based Progressive Web App built with Vite, React, and React Three Fiber.

## Workspace

```text
torrevieja-tycoon/
├── apps/
│   └── web/                  # Browser/PWA representation and interaction layer
├── packages/
│   ├── simulation/           # Standalone deterministic TypeScript library
│   ├── protocol/             # Shared adapter-neutral contracts
│   └── transport-domain/     # Scenario DTOs and directed graph
└── docs/
```

## Core architectural statement

> The web application is a client of the simulation library. It displays simulation output, sends commands, and provides platform adapters. It is not the source of truth for game outcomes.

The simulation can run in Node.js, Vitest, a browser main thread, a Web Worker, a future server, or a command-line balancing tool without requiring React, Three.js, the DOM, IndexedDB, or networking.

## Agreed foundation stack

| Concern                    | Choice                                 |
| -------------------------- | -------------------------------------- |
| Package manager            | Yarn                                   |
| Workspace model            | Yarn workspaces                        |
| Build tooling              | Vite                                   |
| Language                   | TypeScript with strict checking        |
| UI                         | React                                  |
| 3D representation          | Three.js, React Three Fiber, Drei      |
| Client state               | Zustand                                |
| Persistence adapter        | Dexie / IndexedDB                      |
| Runtime validation         | Zod                                    |
| PWA integration            | vite-plugin-pwa                        |
| Unit and integration tests | Vitest                                 |
| Browser tests              | Cypress                                |
| Development method         | TDD for simulation behaviour           |
| Formatting                 | Prettier                               |
| Linting                    | ESLint                                 |
| Continuous integration     | GitHub Actions                         |
| Licence                    | MIT                                    |
| Runtime                    | A pinned supported Node.js LTS release |

## Documentation map

- [`architecture/principles.md`](architecture/principles.md) — non-negotiable design principles.
- [`architecture/boundaries.md`](architecture/boundaries.md) — package dependencies and adapter boundaries.
- [`architecture/state-ownership.md`](architecture/state-ownership.md) — authoritative, application, and presentation state.
- [`architecture/transport-contract.md`](architecture/transport-contract.md) — proposed adapter-neutral host/client semantics and failure recovery.
- [`architecture/time-model.md`](architecture/time-model.md) — authoritative five-second tick and host-owned playback model.
- [`architecture/scenario-packages-and-directed-graph.md`](architecture/scenario-packages-and-directed-graph.md) — Phase 4A scenario and graph boundary.
- [`architecture/transport-simulation-authority.md`](architecture/transport-simulation-authority.md) — Phase 4B authoritative scenario and snapshot boundary.
- [`architecture/vehicle-movement-authority.md`](architecture/vehicle-movement-authority.md) — Phase 4C deterministic vehicle authority.
- [`architecture/decisions/0009-graph-native-vehicle-movement.md`](architecture/decisions/0009-graph-native-vehicle-movement.md) — graph-native movement and V2 compatibility decision.
- [`architecture/decisions/0010-repeating-route-cycle-assignment.md`](architecture/decisions/0010-repeating-route-cycle-assignment.md) — canonical RouteId assignment and repeating ordered-leg operation.
- [`architecture/decisions/0011-city-population-grid-and-stop-catchments.md`](architecture/decisions/0011-city-population-grid-and-stop-catchments.md) — WGS84 population-grid and physical StopPlace catchment decision.
- [`architecture/decisions/0013-deterministic-passenger-destination-assignment.md`](architecture/decisions/0013-deterministic-passenger-destination-assignment.md) — weighted destination-cell assignment and Snapshot V5 decision.
- [`architecture/decisions/0014-deterministic-direct-passenger-itineraries.md`](architecture/decisions/0014-deterministic-direct-passenger-itineraries.md) — static single-pattern itinerary and directional StopNode decision.
- [`architecture/decisions/0008-authoritative-scenario-snapshot-compatibility.md`](architecture/decisions/0008-authoritative-scenario-snapshot-compatibility.md) — exact scenario-coordinate compatibility decision.
- [`architecture/decisions/0007-scenario-package-and-directed-graph.md`](architecture/decisions/0007-scenario-package-and-directed-graph.md) — scenario package and directed-edge decision.
- [`architecture/decisions/0002-simulation-host-transport-readiness.md`](architecture/decisions/0002-simulation-host-transport-readiness.md) — Socket.IO-readiness research and transport-boundary decision.
- [`architecture/decisions/0003-simulation-time-and-playback-pacing.md`](architecture/decisions/0003-simulation-time-and-playback-pacing.md) — simulation-time and playback-pacing decision.
- [`development/roadmap.md`](development/roadmap.md) — phased master plan.
- [`development/testing-strategy.md`](development/testing-strategy.md) — TDD workflow, test layers, determinism, and coverage policy.
- [`development/phase-3-plan.md`](development/phase-3-plan.md) — incremental Phase 3 delivery milestones.
- [`development/definition-of-done.md`](development/definition-of-done.md) — completion and validation rules.
- [`prompts/codex-system-prompt.md`](prompts/codex-system-prompt.md) — reusable Codex session prompt.
- [`prompts/phase-1-project-foundation.md`](prompts/phase-1-project-foundation.md) — completed foundation implementation request.
- [`prompts/phase-2-socketio-readiness-research.md`](prompts/phase-2-socketio-readiness-research.md) — completed architecture-research request.
- [`prompts/phase-3a-time-foundation.md`](prompts/phase-3a-time-foundation.md) — completed time and contract foundation milestone.

## Fixed implementation facts

- Node.js 24.18.0 LTS and Yarn 4.17.1 are pinned.
- Vite 8, React 19, strict TypeScript, Vitest, Cypress, ESLint, and Prettier provide the initial toolchain.
- The simulation and protocol package compilers are restricted to environment-neutral ECMAScript libraries and no ambient platform types.
- ESLint enforces the documented package dependency direction and forbidden platform imports.
- The web production build generates a service worker and web app manifest through `vite-plugin-pwa`.
- Phase 3A adds deterministic five-second time primitives, distinct protocol position primitives, and pure application-owned playback calculations.
- Phase 3B adds a browser-neutral in-memory foundation host with concrete validated command, result, reliable-update, render-snapshot, and synchronization contracts; Worker and persistence adapters remain deferred.
- Phase 3C adds direct and dedicated-Worker adapters behind one foundation client contract, with strict Worker-boundary validation, correlation, lifecycle failure handling, cleanup, and structured-clone re-freezing; scheduling and persistence remain deferred.
- Phase 3D adds simulation-owned versioned snapshots, queued direct/Worker
  snapshot export, explicit new-timeline restoration, validated in-memory and
  Dexie save repositories, and a serialized vanilla Zustand application
  projection; timers, autosave, React save UI, and gameplay remain deferred.
- Phase 3E adds deterministic integer browser pacing, configurable playback
  modes, tick-counted 2× bonus consumption, a generation-safe pacing
  controller, visibility-aware animation-frame driving, and minimal platform
  controls; pacing state remains runtime-only.
- Phase 3F hardens the completed platform as Foundation Template v1.0.0 with
  executable architecture, manifest, bundle, lifecycle, and built-PWA offline
  release gates. Final release status requires the pinned CI workflows to pass.
- Phase 4A adds an environment-neutral transport-domain package, reviewed
  scenario assets, strict immutable parsing, directed graph queries, and a
  base-aware browser loader without changing authoritative Phase 3 contracts.
- Phase 4B binds one immutable canonical scenario and derived graph to a
  transport timeline. Transport snapshots and current saves retain only the
  exact scenario coordinate plus dynamic tick; legacy foundation saves remain
  explicitly incompatible rather than being assigned invented scenario data.
- Phase 4C adds strict graph-native vehicles, integer per-edge movement plans,
  atomic tick advancement, and explicit versioned snapshots and saves. Its
  final refinement assigns new vehicles to canonical RouteIds, repeats each
  route's ordered direction patterns with zero-tick terminal handoffs, and
  advances Snapshot, Save, client, and Worker contracts to V3. V1 migrates to
  an empty fleet; V2 migrates as legacy single-pattern authority. A read-only
  SVG proves active-authority movement. Scheduling remains deferred.
- Phase 4E0 adds a transport-domain-owned City Population Grid V1 and pure
  scenario-derived StopPlace catchments. Native cells remain individual
  `0.001° × 0.001°` WGS84 angular samples with conserved relative weights.
  Real city assets remain deferred.
- Phase 4E1 adds simulation-owned fixed-point passenger emission from an exact
  immutable demand plan. Served groups use implicit WGS84 grid-cell access
  timing before aggregating at physical StopPlaces; unserved demand remains
  explicit at source. Snapshot V4 stores only dynamic demand state and requires
  the exact plan during active restore. Destination choice, queues, boarding,
  capacity, services, UI, and rendering remain deferred.
- Phase 4E2 assigns arrived passengers to served, other-StopPlace population
  cells through deterministic weighted cyclic allocation. Per-origin cursors,
  bounded origin/destination-cell groups, explicit unavailable totals, and
  exact conservation are authoritative in Snapshot V5. Active V4 migration
  preserves backlog without inventing destinations. Dynamic itinerary
  activation and waiting authority remain deferred.
- Phase 4E3A adds a static simulation-owned Passenger Direct Itinerary Plan V1.
  Every ordered distinct physical StopPlace pair is either one canonical
  forward-pattern segment with exact directional StopNodes or explicitly
  unavailable. Dynamic passenger groups remain awaiting itinerary; Snapshot
  V5, Save V3, clients, Workers, persistence, UI, and rendering are unchanged.
- The pre-Phase-4D browser refinement presents the accepted authority through a
  viewport-bound game shell: compact navigation, a full-workspace SVG
  diagnostic view, a swappable R3F minimap, and accessible project,
  simulation, and session dialogs. Shell state is presentation-only.
  Simulation and persistence interfaces are independently lazy-loaded so Load
  exposes only saved-session operations and the initial application entry keeps
  reviewed budget headroom.
  City-filtered catalogues, campaign progression, and promotion of the R3F
  renderer to the production primary view remain explicit future seams.
- Simulation behaviour is developed test-first with enforced package coverage thresholds and deterministic tests.
