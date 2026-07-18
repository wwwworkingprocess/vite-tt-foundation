# ADR 0006: Reusable browser-game foundation template

## Status

Proposed for Phase 3F.

## Context

Phases 1 through 3 establish a reusable platform:

- strict TypeScript/Yarn workspace;
- deterministic environment-neutral simulation;
- validated protocol contracts;
- FIFO authoritative host;
- direct and dedicated-Worker clients;
- versioned snapshots and Dexie persistence;
- explicit timeline replacement;
- read-only Zustand projections;
- deterministic browser pacing;
- React/R3F/PWA browser shell.

Phase 4 will introduce Torrevieja transport data and mechanics. A stable,
auditable foundation snapshot is therefore required first.

## Decision

The accepted Phase 3F state becomes:

```text
Foundation Template v1.0.0
```

It is a source-template release, not a published framework.

A compatible game accepts:

- deterministic whole-tick simulation;
- command-driven authoritative mutation;
- browser-neutral in-memory host;
- dedicated Worker production boundary;
- runtime-validated JSON-safe contracts;
- versioned local snapshots and IndexedDB saves;
- explicit timeline replacement on restore;
- read-only application projections;
- active-page browser pacing;
- React shell with optional R3F representation.

Projects based on continuous nondeterministic physics or immediate
server-authority are not automatically compatible.

## Domain-free boundary

Before the template snapshot, foundation production types and behavior
must contain no transport-domain concepts such as:

```text
route
stop
platform
bus
passenger
fare
depot
timetable
vehicle
```

Project branding and documentation about future extension points are
allowed. The package namespace may remain `@torrevieja-tycoon/*`;
renaming is a clone operation, not Phase 3F work.

## Template manifest

A machine-readable manifest records:

- template version;
- pinned Node and Yarn;
- foundation paths and public entry points;
- schema versions;
- validation commands;
- extension points;
- rename surfaces;
- archive exclusions.

The manifest must be schema-validated and checked against the repository.

## Compatibility policy

Template semantic versioning:

- patch: tests, docs, diagnostics, non-behavioral hardening;
- minor: backward-compatible extension points or optional platform work;
- major: incompatible lifecycle, protocol, snapshot, save, ownership, or
  client changes.

Domain snapshot versions remain independent.

## Clean snapshot

Exclude:

```text
.git/
node_modules/
dist/
coverage/
.vite/
Cypress artifacts/
temporary databases and caches/
local environment files/
```

Include source, docs, lockfile, Yarn config, CI, tests, manifests, and
validation scripts.

## Release evidence

Phase 3F records:

- exact tool versions;
- immutable clean-install result;
- unit/coverage/build/E2E evidence;
- independent package builds;
- architecture audit;
- production PWA/offline result;
- bundle-budget result;
- warning disposition;
- template-manifest validation;
- commit identity when available.

## Deferred

- publishing foundation packages;
- separate upstream template repository;
- namespace rewrite CLI;
- cloud saves;
- server authority;
- multiplayer;
- domain plugin loading.
