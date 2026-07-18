# Codex task — Phase 3D persistence and application bridge

Read `AGENTS.md` and every document linked from
`docs/project-foundation.md`.

Also read:

- `docs/architecture/time-model.md`;
- `docs/architecture/transport-contract.md`;
- `docs/architecture/foundation-host-model.md`;
- `docs/architecture/worker-adapter-model.md`;
- `docs/architecture/persistence-and-app-bridge.md`;
- `docs/architecture/decisions/0004-save-restore-and-timeline.md`;
- `docs/development/testing-strategy.md`;
- `docs/development/phase-3d-persistence-app-bridge.md`;
- `docs/development/definition-of-done.md`.

Before editing:

1. inspect repository and Git state;
2. confirm final Phase 3C lifecycle corrections are present;
3. confirm the current suite is green;
4. state the milestone-based TDD plan.

Implement Phase 3D exactly as defined in
`docs/development/phase-3d-persistence-app-bridge.md`.

## Mandatory constraints

- Start each milestone with failing behavioral tests.
- Keep simulation free of persistence, Zustand, Worker, and browser APIs.
- Make snapshot export part of the authoritative command queue.
- Do not derive persistence snapshots from mutable UI/store state.
- Keep persistence snapshot and client read model distinct.
- Restore must use a caller-supplied timeline different from the saved
  source timeline.
- Reset command revision, stream offset, render sequence, command results,
  and reliable history on restore.
- Validate and deeply freeze every persisted or cloned public value.
- Use one repository contract suite for in-memory and Dexie adapters.
- Inject database names, save IDs, timestamps, and timeline IDs.
- Use vanilla Zustand; do not add React hooks or persist middleware.
- Store only projections; all authoritative mutation goes through client
  commands or restore/start workflows.
- Serialize controller side effects.
- Do not add timers, autosave, scheduler, gameplay UI, route data,
  Socket.IO, or game mechanics.
- Do not create speculative generic repositories or migration frameworks.
- Keep documentation changes narrow and status-oriented.
- Maintain coverage thresholds.

## Validation

Run at least:

```text
yarn install --immutable
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn test:coverage
yarn build
yarn test:e2e
yarn workspace @torrevieja-tycoon/simulation test
yarn workspace @torrevieja-tycoon/protocol test
yarn workspace @torrevieja-tycoon/simulation build
yarn workspace @torrevieja-tycoon/protocol build
```

Also run focused snapshot, shared-client, repository, Dexie, controller,
and store suites.

Report exact Node, Yarn, Cypress, browser, Dexie, Zustand, and test
IndexedDB versions. Do not claim the pinned Node runtime when another
version was used.

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
