# Phase 3F — Foundation Hardening and Template Release

> **Document status:** Historical phase contract. This file preserves the named
> milestone scope and acceptance criteria. It is not a current-state summary;
> read [`../current-state.md`](../current-state.md) first.

## Goal

Audit, harden, and release the complete Phase 1–3 platform as reusable
Foundation Template v1.0.0 before any transport domain enters the codebase.

## Milestones

### 3F.1 — Clean reproducibility and pinned runtime

- validate from a clean dependency state with immutable lockfile;
- run under exact Node `24.18.0` and Yarn `4.17.1`;
- align `.node-version`, engines, CI, documentation, and manifest;
- fail clearly on unsupported runtime in the documented validation entry;
- ensure no generated/local artifacts are required.

CI should run:

- full validation on Linux under the pinned runtime;
- format/lint/typecheck/test/build or equivalent portability subset on
  Windows;
- real-browser Cypress/PWA flow on Linux.

Do not create an unnecessarily large CI matrix.

### 3F.2 — Architecture and domain-free audit

Add executable audits for:

- package dependency directions;
- forbidden browser/persistence/state imports in simulation;
- no simulation wall-clock/random/timer usage;
- no Worker globals outside Worker adapter/entry;
- no public writable Zustand projection;
- no foundation production transport-domain concepts;
- no module-global Dexie database or authoritative singleton;
- no generated output committed.

Prefer current ESLint/TypeScript/package metadata. A small deterministic
repository audit script is acceptable; do not add a general architecture
framework.

### 3F.3 — Cross-layer lifecycle acceptance suite

Add a focused acceptance journey:

```text
new Worker session
-> pacing advancement
-> pause
-> queued snapshot export
-> save to Dexie
-> close
-> restore under new timeline
-> coordinate/history reset
-> pacing reset
-> advance again
-> final cleanup
```

Also preserve direct/Worker parity for the critical path and terminal
failure cleanup. This remains foundation integration, not game mechanics.

### 3F.4 — PWA and offline hardening

Using the built production application and real service worker:

- verify manifest/installability metadata;
- verify shell loads after first online visit when offline;
- verify the dedicated Worker chunk is available offline;
- verify a previously saved IndexedDB record remains listable/restorable
  offline;
- verify cleanup and no fatal page/Worker error;
- document deterministic service-worker update behavior.

Do not add background sync, push, cloud saves, or hidden-time catch-up.

### 3F.5 — Bundle and warning baseline

Create a deterministic build-artifact audit:

- validate JavaScript and Worker chunk budgets;
- ensure the dedicated Worker is emitted separately;
- enforce project source-map/build-artifact policy;
- resolve project-owned warnings;
- record third-party warnings with source, impact, and removal condition.

The existing large-chunk advisory must either be removed through a narrow
split/lazy boundary or replaced by explicit reviewed budgets so the build
is warning-clean under project-owned configuration.

The Three.js Clock deprecation warning must be shown to originate outside
project-owned code or corrected if owned. Do not hide arbitrary warnings.

### 3F.6 — Template manifest and release handoff

Add and validate:

```text
foundation-template.json
docs/template/foundation-release-evidence.md
docs/template/clone-and-rename.md
docs/template/domain-extension-guide.md
```

The manifest records template version `1.0.0`, exact pins, schema
versions, commands, foundation paths, extension points, rename surfaces,
and archive exclusions.

Update foundation, roadmap, and README status to mark Phase 3 complete.

## Required audit/TDD order

1. Add failing architecture/repository audits.
2. Add failing cross-layer acceptance tests.
3. Add failing production PWA/offline checks.
4. Add failing manifest/build-budget validation.
5. Demonstrate each red state.
6. Apply the smallest hardening changes.
7. Run clean pinned validation and CI-equivalent commands.
8. Produce factual release evidence.

## Evidence discipline

The completion report must distinguish local evidence, CI evidence,
skipped/unavailable evidence, and accepted third-party warnings.

Never claim pinned-runtime validation when it did not run.

## Coverage

Retain:

```text
Statements  95%
Lines       95%
Functions   95%
Branches    90%
```

Do not hide foundation production modules through new exclusions.

## Non-goals

Do not add:

- routes, stops, platforms, buses, vehicles, passengers, fares, schedules,
  depots, or economics;
- scenario data or domain commands/read models;
- multiplayer or Socket.IO;
- cloud saves;
- background simulation;
- advertising integration;
- template generator CLI;
- namespace rewrite automation;
- published npm packages;
- broad unrelated dependency upgrades.

## Acceptance criteria

Phase 3F is complete only when:

1. exact pinned Node and Yarn validation passes in CI;
2. clean immutable installation and full validation pass;
3. Linux and Windows portability checks pass;
4. architecture/domain-free audits are executable and green;
5. full lifecycle acceptance passes with the real Worker;
6. direct/Worker critical compatibility remains tested;
7. production PWA starts offline after first load;
8. Worker and saved-session restore work offline;
9. bundle budgets and warning policy are explicit and green;
10. template manifest is validated and internally consistent;
11. clone/rename and domain-extension guides are complete;
12. all coverage thresholds remain green;
13. Phase 3 status and release evidence are updated;
14. no Phase 4 domain code is introduced.

## Completion report

Finish with:

```text
Summary
Changed
Audit red states and corrections
Pinned-runtime and cross-platform evidence
Architecture and domain-free audit
Lifecycle acceptance evidence
PWA/offline evidence
Bundle budgets and warning disposition
Template manifest and handoff
Coverage and validation commands
Acceptance criteria status
Intentionally deferred work
```

Report exact Node, Yarn, TypeScript, Vite, Vitest, Cypress, browser,
React, R3F, Three.js, Zustand, Dexie, and service-worker tooling versions.
