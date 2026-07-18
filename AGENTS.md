# Codex Repository Instructions

## Start here

Before planning or changing this repository, read these documents in order:

1. `docs/project-foundation.md`
2. `docs/architecture/principles.md`
3. `docs/architecture/boundaries.md`
4. `docs/architecture/state-ownership.md`
5. `docs/development/roadmap.md`
6. `docs/development/definition-of-done.md`
7. The phase prompt named by the user

If documents conflict, use this precedence:

1. The user's current request
2. This `AGENTS.md`
3. Architecture documents
4. Development documents
5. Phase prompts
6. Existing implementation details

Do not silently resolve a genuine architectural conflict. Report it before implementing the conflicting change.

## Project model

Torrevieja Tycoon consists of two primary products in one workspace:

- `packages/simulation`: a standalone deterministic TypeScript simulation library;
- `apps/web`: a Vite, React, and React Three Fiber client that represents and controls the simulation.

`packages/protocol` contains adapter-neutral commands, events, envelopes, snapshots, and transport contracts that may be shared by clients and future hosts.

The dependency direction is one-way:

```text
apps/web ───────────────► packages/simulation
    │                            ▲
    └────► packages/protocol ◄────┘
```

The simulation and protocol packages must never depend on the web application.

## Non-negotiable architecture rules

1. The simulation owns authoritative game state and game rules.
2. The simulation must not import React, Three.js, React Three Fiber, Zustand, Dexie, IndexedDB, Socket.IO, DOM APIs, or browser-only APIs.
3. Rendering must never advance or directly mutate simulation state.
4. Commands are the public mutation path into the simulation.
5. Simulation time advancement must be deterministic and testable without rendering.
6. The simulation may validate, serialize, and restore snapshots, but it must not persist them.
7. Persistence, workers, PWA behaviour, and networking are host adapters.
8. Easy, Normal, and Realistic are rulesets for one engine, not separate engines.
9. Do not introduce Torrevieja-specific game mechanics before the relevant phase requests them.
10. Do not add Socket.IO before its architecture decision and implementation phase.

## Working method

For each task:

1. Inspect the repository and relevant documentation before editing.
2. Restate the intended scope internally and identify explicit non-goals.
3. Make the smallest coherent change that satisfies the phase prompt.
4. Preserve package boundaries and strict TypeScript settings.
5. Add or update tests for behaviour introduced by the change.
6. Run all validation commands relevant to the touched packages.
7. Update documentation when a durable decision is made.
8. Finish with a concise report containing:
   - files and systems changed;
   - commands run and their outcomes;
   - acceptance criteria satisfied;
   - unresolved issues or follow-up work.

Do not claim a command passed unless it was actually run successfully.

## Tooling decisions

Use the agreed stack unless a phase prompt explicitly changes it:

- Yarn workspaces
- Vite
- TypeScript with strict checking
- React
- Three.js, React Three Fiber, and Drei
- Zustand
- Dexie / IndexedDB
- Zod
- vite-plugin-pwa
- Vitest
- Cypress
- ESLint
- Prettier
- GitHub Actions
- MIT licence

Select and pin compatible current stable versions during scaffolding. Record the chosen Node and Yarn versions in the repository. Do not perform unrelated dependency upgrades in later phases.

## Quality restrictions

Do not:

- bypass type errors with broad `any`, `@ts-ignore`, or unsafe casts without a documented reason;
- disable lint or tests to make validation pass;
- place simulation logic in React components, hooks, Zustand stores, R3F frame callbacks, or persistence adapters;
- persist complete application stores by default;
- expose mutable simulation internals to the web client;
- create parallel implementations for difficulty modes;
- add speculative infrastructure outside the current phase;
- rewrite unrelated files merely for style consistency.

A phase is not complete while required validation is failing.
