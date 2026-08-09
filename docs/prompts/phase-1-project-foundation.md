# Phase 1 Prompt — Strong Project Foundation

> **Document status:** Historical phase task/review prompt. Use only to
> reproduce or review the named phase. Current work follows `AGENTS.md`,
> [`../current-state.md`](../current-state.md), and the user's active request.

## Objective

Create the initial **Torrevieja Tycoon** Yarn workspace and a modern, strictly validated project template. This phase establishes package boundaries, development tooling, and minimal smoke implementations only.

Do not implement transport simulation or game mechanics.

## Required preliminary work

Before editing:

1. Read `AGENTS.md` and every document linked from `docs/project-foundation.md`.
2. Inspect the current repository and Git status.
3. Determine a compatible set of current stable dependency versions using authoritative package documentation or registries available to you.
4. Select and pin a supported Node.js LTS release and a Yarn release appropriate for the workspace.
5. Briefly state the implementation plan before making substantial changes.

## Required workspace

Create this minimum structure:

```text
apps/
└── web/
packages/
├── simulation/
└── protocol/
```

Use Yarn workspaces from a private root package.

## Root requirements

Create and configure, as appropriate:

- root `package.json` with workspace scripts;
- committed Yarn lockfile;
- pinned Node and Yarn version files/settings;
- shared strict TypeScript configuration;
- ESLint configuration;
- Prettier configuration;
- GitHub Actions validation workflow;
- workspace build, type-check, lint, format-check, unit-test, and Cypress scripts;
- README development instructions matching the actual commands;
- MIT licence preservation.

Use package exports and workspace package names rather than importing another package through relative source paths.

## `packages/simulation`

Create a standalone TypeScript library skeleton named:

```text
@torrevieja-tycoon/simulation
```

Requirements:

- initially private but structured so it could later be published;
- no React, Three.js, Zustand, Dexie, browser, PWA, or networking dependencies;
- strict TypeScript compilation;
- a deliberately trivial exported API proving the package builds and can be consumed;
- at least one Vitest test;
- an independent build/type-check path.

Do not create buses, stations, passengers, routes, clocks, commands, or game rules in this phase.

## `packages/protocol`

Create a standalone TypeScript library skeleton named:

```text
@torrevieja-tycoon/protocol
```

Requirements:

- initially private but publishable in structure;
- serializable, environment-neutral code only;
- a deliberately trivial exported contract or branded foundation type proving consumption works;
- at least one Vitest test;
- no Socket.IO or Web Worker implementation;
- no dependency on `apps/web`.

Do not prematurely design the final command/event protocol. That belongs to Phase 2 research and Phase 3 implementation.

## `apps/web`

Create a Vite React TypeScript application named:

```text
@torrevieja-tycoon/web
```

Install and configure the agreed browser stack in its proper layer:

- React;
- Three.js;
- React Three Fiber;
- Drei;
- Zustand;
- Dexie;
- Zod;
- vite-plugin-pwa.

Requirements:

- a minimal accessible foundation screen identifying Torrevieja Tycoon;
- a minimal React Three Fiber canvas proving the renderer starts;
- consumption of one harmless exported value from each workspace package, proving package resolution;
- a small application/component smoke test with Vitest and Testing Library;
- PWA manifest and service-worker generation configured for a production build;
- no real simulation, persistence workflow, worker transport, map, or game interface.

The app should remain visually minimal. This is an architecture template, not a design phase.

## Cypress

Configure Cypress for browser smoke testing.

Add at least one smoke test that starts the web application and verifies the foundation screen renders without a fatal application error.

Prefer reliable element selectors and observable conditions over arbitrary waiting.

## Dependency and boundary enforcement

Establish practical enforcement through the combination of:

- workspace package boundaries;
- TypeScript project configuration/references where appropriate;
- explicit package exports;
- lint import restrictions or an equivalent maintainable rule.

At minimum, prove:

- `packages/simulation` builds independently;
- `packages/protocol` builds independently;
- `apps/web` consumes package exports;
- packages do not import from `apps/web`;
- the simulation package does not gain browser/UI dependencies.

Do not build an elaborate custom enforcement framework in this phase.

## Documentation updates

Update:

- `README.md` with install, development, validation, and build commands;
- `docs/project-foundation.md` only where implementation facts have now been fixed;
- a concise architecture decision record or tooling note documenting the selected Node, Yarn, and major tool versions and why they are mutually compatible.

Do not rewrite the game-design roadmap.

## Explicit non-goals

Do not implement:

- transport simulation;
- simulation ticking or deterministic random generation;
- commands/events beyond trivial package smoke contracts;
- Web Worker communication;
- Dexie repositories or saved games;
- Zustand simulation bridges;
- Socket.IO client or server code;
- Torrevieja route/map data;
- buses, stations, passengers, finance, incidents, or difficulty rules;
- production UI design.

## Acceptance criteria

Phase 1 is complete only when:

1. The repository is a Yarn workspace with `apps/web`, `packages/simulation`, and `packages/protocol`.
2. Node and Yarn versions are pinned and documented.
3. A clean dependency installation succeeds from the lockfile.
4. Strict TypeScript checking passes for the complete workspace.
5. ESLint and Prettier checks pass.
6. Vitest tests pass.
7. Both library packages build independently.
8. The web production build succeeds and generates the configured PWA output.
9. Cypress smoke tests pass against the web application.
10. GitHub Actions is configured to run the relevant validation on pushes and pull requests.
11. The web app consumes public exports from both workspace packages.
12. No game mechanics, Socket.IO integration, worker runtime, or persistence workflow has been introduced.
13. README commands and documentation match the actual implementation.

## Required completion report

Finish with:

```text
Summary
Changed
Dependency/version choices
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```

Include exact commands. Do not report a check as successful unless it was run successfully.
