# Torrevieja Tycoon

Torrevieja Tycoon is a browser-based transport-management game built as two cooperating products:

- a standalone deterministic TypeScript simulation library;
- a Vite, React, and React Three Fiber web client that represents and controls the simulation.

The repository is a strict Yarn workspace that keeps the standalone simulation, shared protocol foundations, and browser client in explicit packages.

## Requirements

- Node.js 24.18.0 (see `.node-version` and `.nvmrc`)
- Corepack with Yarn 4.17.1

Enable Corepack once if needed:

```sh
corepack enable
```

## Install and develop

```sh
yarn install --immutable
yarn dev
```

The development server is available at `http://localhost:4173`.

## Validation and builds

```sh
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn test:coverage
yarn build
yarn test:e2e
yarn test:pwa
yarn audit:architecture
yarn audit:tracked
yarn audit:manifest
yarn audit:build
```

Run the complete sequence with `yarn validate`. Build either standalone library independently with:

```sh
yarn workspace @torrevieja-tycoon/protocol build
yarn workspace @torrevieja-tycoon/simulation build
```

## Documentation

Begin with [`docs/project-foundation.md`](docs/project-foundation.md), which links the complete architecture contract, roadmap, definition of done, and prompts.

## Current status

Phases 1–3 are implemented. The repository is a Foundation Template v1.0.0 release candidate with deterministic simulation foundations, direct/Worker host adapters, IndexedDB saves, application orchestration, browser pacing, PWA offline verification, executable architecture audits, and enforced coverage. Final release acceptance still requires the pinned Linux and Windows CI workflows to pass. Phase 4 game mechanics remain deferred.
