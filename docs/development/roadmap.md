# Development Roadmap

The roadmap separates platform construction, architecture research, simulation development, representation, and game mechanics.

## Phase 0 — Architecture contract

### Goal

Create the repository root, durable documentation, Codex instructions, and bounded phase prompts.

### Output

- architecture principles;
- package boundaries;
- state ownership rules;
- definition of done;
- reusable Codex system prompt;
- Phase 1 implementation prompt.

### Current status

In progress through this documentation pack.

## Phase 1 — Strong project template

### Goal

Create a modern, reusable Yarn workspace with the selected stack, strict quality tooling, package boundaries, and minimal smoke implementations.

### Includes

- root Yarn workspace configuration;
- pinned Node and Yarn versions;
- `apps/web` Vite + React + TypeScript application;
- `packages/simulation` standalone TypeScript package skeleton;
- `packages/protocol` standalone TypeScript package skeleton;
- React Three Fiber dependency and minimal scene smoke test;
- Zustand, Dexie, Zod, and PWA dependencies prepared in their owning layer;
- Vitest and Cypress configuration;
- ESLint, Prettier, strict TypeScript, and GitHub Actions;
- build, test, lint, formatting, and type-check scripts.

### Explicit non-goals

- no transport simulation;
- no passengers, routes, buses, finances, or scenarios;
- no Socket.IO implementation;
- no full worker/persistence runtime pipeline;
- no Torrevieja map or game UI.

## Phase 2 — Socket.IO-readiness research

### Goal

Research and document how a future authoritative host could integrate through Socket.IO without coupling the simulation or client to Socket.IO semantics.

### Output

- architecture decision record;
- command/event envelope recommendations;
- reconnection, acknowledgement, revision, and resynchronization strategy;
- proposed adapter-neutral transport interface;
- explicit list of deferred implementation work.

### Non-goal

Do not add a Socket.IO server or client merely to prove connectivity.

## Phase 3 — Blank end-to-end platform

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
- R3F representation of trivial simulation output.

### Non-goal

No transport-game mechanics yet.

## Phase 4 — Standalone non-graphical simulation library

### Goal

Implement the first actual transport simulation as a pure TypeScript library.

### Initial model

- directed node graph;
- stations as nodes;
- travel links as edges;
- one ordered service;
- buses moving in fixed deterministic steps;
- generated passengers with origins and destinations;
- boarding, alighting, waiting, and capacity;
- command processing, events, metrics, and snapshots.

### Required property

A full simulated day can run and be tested without React, a browser, a worker, or a database.

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
