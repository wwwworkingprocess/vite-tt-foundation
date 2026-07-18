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
│   └── protocol/             # Shared adapter-neutral contracts
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
- [`development/roadmap.md`](development/roadmap.md) — phased master plan.
- [`development/testing-strategy.md`](development/testing-strategy.md) — TDD workflow, test layers, determinism, and coverage policy.
- [`development/definition-of-done.md`](development/definition-of-done.md) — completion and validation rules.
- [`prompts/codex-system-prompt.md`](prompts/codex-system-prompt.md) — reusable Codex session prompt.
- [`prompts/phase-1-project-foundation.md`](prompts/phase-1-project-foundation.md) — completed foundation implementation request.
- [`prompts/phase-2-socketio-readiness-research.md`](prompts/phase-2-socketio-readiness-research.md) — current architecture-research request.

## Fixed implementation facts

- Node.js 24.18.0 LTS and Yarn 4.17.1 are pinned.
- Vite 8, React 19, strict TypeScript, Vitest, Cypress, ESLint, and Prettier provide the initial toolchain.
- The simulation and protocol package compilers are restricted to environment-neutral ECMAScript libraries and no ambient platform types.
- ESLint enforces the documented package dependency direction and forbidden platform imports.
- The web production build generates a service worker and web app manifest through `vite-plugin-pwa`.
- Phase 1 contains smoke contracts and rendering only; simulation mechanics and host adapters remain deferred.
- Actual simulation behaviour will be developed test-first with high package coverage and deterministic tests.
