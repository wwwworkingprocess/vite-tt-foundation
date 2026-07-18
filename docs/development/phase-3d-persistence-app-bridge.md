# Phase 3D — Persistence and Application Bridge

## Goal

Add simulation-owned snapshots, a versioned save repository with Dexie,
explicit new-timeline restore behavior, and a vanilla Zustand application
bridge around the accepted direct/Worker clients.

## Milestones

### 3D.1 — Simulation snapshot

Add a strict version-one foundation snapshot to `packages/simulation`.

Use TDD for parsing, creation, restoration, overflow/version rejection,
JSON round trips, and deep immutability.

### 3D.2 — Snapshot export and restore connect

Extend the host and shared client boundary with:

- queued `exportSnapshot()`;
- direct and Worker support;
- strict Worker schemas;
- explicit new/restore connect modes.

Run shared direct/Worker tests.

### 3D.3 — Save repository

Add:

- browser-neutral repository port;
- in-memory implementation;
- Dexie implementation;
- shared repository contract suite;
- deterministic save summaries;
- corruption and deep-immutability tests.

### 3D.4 — Zustand application bridge

Add a vanilla Zustand store and serialized application controller for:

- start;
- synchronization;
- reliable/render projection;
- save/list/delete;
- restore to a caller-supplied new timeline;
- close.

No React hook or visual save screen.

## Required TDD order

1. Add failing simulation snapshot tests.
2. Add failing shared snapshot-export/restore-client tests.
3. Add failing repository contract tests.
4. Add failing controller/store tests.
5. Demonstrate the focused red states.
6. Implement the smallest behavior per milestone.
7. Refactor while green.
8. Run complete validation and real Worker Cypress smoke.

## Required invariants

- simulation contains no Dexie, Zustand, Worker, DOM, or persistence I/O;
- repository never creates/restores simulation state;
- snapshot export is ordered with commands;
- restore always begins a different timeline;
- restored authoritative sequences begin at zero;
- old idempotency results/history do not cross restore;
- store is projection only;
- every external/persisted value is runtime-validated;
- IndexedDB reads are refrozen before application use;
- controller side effects are serialized;
- no timer or autosave behavior exists.

## Dependencies

Use existing Dexie and Zustand dependencies.

A test-only `fake-indexeddb` dependency may be added if required for
deterministic Dexie tests.

Do not add a new state-management, persistence, or migration framework.

## Coverage

Retain repository thresholds:

```text
Statements  95%
Lines       95%
Functions   95%
Branches    90%
```

Do not exclude persistence/controller production modules to preserve
coverage.

## Non-goals

Do not add:

- simulation scheduler or browser timers;
- automatic tick advancement;
- autosave timer;
- React save/load UI;
- Zustand persistence middleware;
- gameplay R3F changes;
- route/stop data;
- transport mechanics;
- Socket.IO;
- cloud persistence;
- authentication;
- save compression/encryption;
- migration beyond an explicit version-one baseline;
- random ID/time generation inside services.

## Acceptance criteria

Phase 3D is complete only when:

1. simulation snapshots are pure, versioned, validated, and immutable;
2. snapshot export is serialized with command processing;
3. direct and Worker clients share export/restore behavior;
4. restore requires a new timeline and resets host coordinates/history;
5. in-memory and Dexie repositories pass one contract suite;
6. Dexie data is validated and refrozen on read;
7. corrupted data fails explicitly;
8. vanilla Zustand store contains projections only;
9. controller operations are serialized and terminal after close;
10. save and restore workflows are executable behavioral tests;
11. coverage and all standard validation pass;
12. real Worker Cypress smoke remains green;
13. no Phase 3E+ work is introduced.

## Completion report

Finish with:

```text
Summary
Changed
TDD and coverage
Snapshot and restore semantics
Repository and IndexedDB validation
Zustand bridge behavior
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```

Report exact Node, Yarn, Cypress, browser, Dexie, Zustand, and
fake-indexeddb versions used.
