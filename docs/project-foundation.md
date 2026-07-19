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
- Simulation behaviour is developed test-first with enforced package coverage thresholds and deterministic tests.
