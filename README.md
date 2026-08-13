# Torrevieja Tycoon

Torrevieja Tycoon is a deterministic, offline-capable transport simulation and
Progressive Web App. The repository contains four explicit workspace surfaces:

- `packages/protocol` — adapter-neutral foundation contracts and validators;
- `packages/transport-domain` — canonical scenario packages and directed graphs;
- `packages/simulation` — authoritative deterministic transport simulation;
- `apps/web` — scenario acquisition, Worker/application adapters, persistence,
  pacing, UI, SVG diagnostics, and the React Three Fiber representation boundary.

The web application is a client of the simulation. Rendering, browser timing,
persistence, and scenario selection never become simulation authority.

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

## Validation tiers

Use the narrowest tier that matches the task, then run the broader gate before a
milestone is accepted.

```sh
# Normal development validation
yarn validate

# Complete portable validation: audits, tests, coverage, build, browser, PWA,
# and repository-subpath behavior
yarn validate:portable

# Git/repository-only tracked-output and clean-tree checks
yarn validate:repository
```

`yarn validate` is intentionally narrower than `yarn validate:portable`.
Individual commands remain available for focused work, including
`format:check`, `lint`, `typecheck`, `test`, `test:coverage`, `build`,
`test:e2e`, `test:pwa`, and `test:pwa:subpath`.

Build every standalone library with:

```sh
yarn build:libraries
```

Or build one library independently:

```sh
yarn workspace @torrevieja-tycoon/protocol build
yarn workspace @torrevieja-tycoon/transport-domain build
yarn workspace @torrevieja-tycoon/simulation build
```

## Current product status

Phases 1–3 and the implemented Phase 4A–4E5 authority layers are present. The
current passenger chain covers deterministic demand, StopPlace access,
destination assignment, direct itinerary activation, directional waiting,
exact vehicle calls, boarding/capacity, alighting, destination access, lineage,
and completed journeys.

Current aggregate contracts are Transport Snapshot V9, Transport Save V7,
transport client V3, and transport Worker V3. The public catalogue contains
multiple Torrevieja, Elche, Elche-radial, and Alicante development-seed
packages. Application/session lifecycle, object selection, inspector
diagnostics, and deterministic population-backed passenger demand are active.
The next planned product layer is Phase 4F economics and objectives. Transfers,
advanced services, and richer operational realism remain deferred.

See [`docs/current-state.md`](docs/current-state.md) for the current contract and
[`docs/development/roadmap.md`](docs/development/roadmap.md) for sequencing.

## Foundation Template reference

The repository retains the reusable **Foundation Template v1.0.0** contract and
release evidence as historical/reference material under `docs/template/` and
`foundation-template.json`. That domain-free snapshot is not the identity or
release status of current Torrevieja Tycoon product HEAD.

## Documentation

Start with [`docs/project-foundation.md`](docs/project-foundation.md). It
separates current contracts, accepted ADRs, historical phase records, and
Foundation Template reference material.
