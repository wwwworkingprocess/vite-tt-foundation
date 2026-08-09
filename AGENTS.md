# Codex Repository Instructions

## Start here

Before planning or changing this repository, read these documents in order:

1. `docs/project-foundation.md`
2. `docs/current-state.md`
3. `docs/architecture/principles.md`
4. `docs/architecture/boundaries.md`
5. `docs/architecture/state-ownership.md`
6. `docs/development/roadmap.md`
7. `docs/development/testing-strategy.md`
8. `docs/development/definition-of-done.md`
9. The active task or phase prompt supplied by the user

Then inspect the actual package manifests, schemas, tests, and Git state. Current
source and machine-readable manifests are authoritative for facts that may have
changed after the documentation was last edited.

## Documentation status and precedence

Documents have different purposes. Do not treat every Markdown statement as a
claim about current HEAD.

- **Current architecture/product contract** — must match current source. This
  includes `AGENTS.md`, `docs/current-state.md`, the durable architecture
  principles/boundaries/state-ownership documents, and the current roadmap.
- **Accepted ADR** — preserves the decision made at a point in time. The decision
  may remain active while version markers or phase-specific consequences are
  superseded. Read its metadata and later ADR links.
- **Historical phase contract or prompt** — preserves the original phase scope,
  non-goals, and acceptance criteria. Its statements about what was deferred are
  not current-state claims.
- **Foundation Template reference** — describes the domain-free reusable
  snapshot, not current Torrevieja Tycoon product HEAD.

When material conflicts, use this precedence:

1. The user's current request
2. `AGENTS.md`
3. `docs/current-state.md` and current architecture contracts
4. Current machine-readable manifests, schemas, and package boundaries
5. Accepted ADRs, interpreted with their status/supersession metadata
6. Current development roadmap and testing/definition-of-done documents
7. Historical phase documents and prompts, only for their named phase
8. Existing implementation details not covered above

Do not silently resolve a genuine architectural conflict. Report it before
implementing the conflicting change.

## Project model

Torrevieja Tycoon has four explicit workspace surfaces:

- `packages/protocol`: adapter-neutral foundation commands, envelopes,
  synchronization coordinates, snapshots, and validators;
- `packages/transport-domain`: environment-neutral scenario DTO parsing,
  canonical immutable scenario values, and deterministic directed graphs;
- `packages/simulation`: standalone deterministic transport authority;
- `apps/web`: browser/PWA composition, scenario acquisition, Worker and direct
  adapters, persistence, pacing, UI, and representation.

The current dependency direction is:

```text
apps/web ───────────────► packages/simulation
   │                              │
   ├────────► packages/protocol   └────────► packages/transport-domain
   └────────► packages/transport-domain

packages/protocol          independent of simulation/web implementation
packages/transport-domain  independent of protocol/simulation/web adapters
```

`packages/simulation` does not depend on `packages/protocol`. No package may
depend on `apps/web`.

## Non-negotiable architecture rules

1. The simulation owns authoritative game state and rules.
2. The simulation must not import React, Three.js, React Three Fiber, Zustand,
   Dexie, IndexedDB, Socket.IO, DOM APIs, Node-only APIs, or browser-only APIs.
3. Rendering must never advance or directly mutate simulation state.
4. Commands are the public mutation path into the simulation.
5. Simulation time advancement is deterministic, whole-tick, and testable
   without rendering or browser time.
6. The simulation may validate, serialize, and restore snapshots, but it must
   not persist them.
7. Scenario acquisition and asset hashing belong to `apps/web`; canonical
   scenario parsing and graph construction belong to `transport-domain`;
   authoritative scenario-bound state belongs to `simulation`.
8. Persistence, workers, PWA behavior, pacing, and networking are host adapters.
9. Direct, structured-clone, and Worker execution must remain semantically
   equivalent.
10. Restore semantic preflight completes before current authority is torn down;
    restore failure is non-destructive.
11. Public authority is deeply readonly, recursively frozen where promised, and
    structured-clone safe.
12. StopNodes are directional graph identities; StopPlaces are physical access
    locations. StopPlace equality never invents an edge, itinerary, boarding,
    or alighting operation.
13. A genuine loop uses one ordered `closesLoop: true` pattern without repeating
    its first node at the end. Ordinary ida/vuelta service uses separate
    non-loop patterns. Alternative service variants must not be interpreted as
    sequential route-cycle legs without an explicit supported model.
14. Easy, Normal, and Realistic are rulesets for one engine, not separate
    engines.
15. New simulation behavior is developed test-first: establish a failing
    behavioral test, implement the smallest passing change, then refactor while
    tests remain green.
16. Coverage is a guardrail, not a substitute for behavioral, invariant,
    determinism, corruption, conservation, and regression tests.

## Current pre-release persistence policy

The current transport contracts are Snapshot V9 and Transport Save V7 with V3
client and Worker contracts. Earlier transport/foundation save records are
pre-release data and are classified as obsolete unless current source and tests
explicitly support them. Do not invent migrations or compatibility from an old
ADR or phase document.

## Working method

For each task:

1. Inspect the repository, current-state ledger, relevant ADRs, and tests before
   editing.
2. Verify the exact baseline and distinguish pre-existing working-tree changes.
3. Identify scope, acceptance criteria, invariants, and explicit non-goals.
4. Make the smallest coherent change that satisfies the request.
5. Preserve package boundaries, deterministic ordering, conservation, restore
   safety, and direct/clone/Worker parity.
6. For behavioral work, add the failing test before production implementation
   unless the task is documentation-only or a narrowly justified refactor.
7. Add or update tests for every behavior introduced or defect fixed.
8. Run all validation commands relevant to the touched packages. Do not run
   broader browser suites when the owner explicitly retains that responsibility.
9. Update current documentation when a durable current contract changes. Update
   or supersede ADR metadata rather than rewriting historical decision bodies.
10. Finish with a concise report listing files changed, commands and outcomes,
    acceptance criteria, and unresolved follow-up work.

Do not claim a command passed unless it actually ran successfully.

## Tooling decisions

Use the versions pinned by the repository and the agreed stack:

- Yarn workspaces
- Vite
- strict TypeScript
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

Do not perform unrelated dependency upgrades.

## Quality restrictions

Do not:

- bypass type errors with broad `any`, `@ts-ignore`, or unsafe casts without a
  documented reason;
- disable lint, tests, validation, or coverage thresholds to make a change pass;
- add coverage-ignore directives for reachable business or lifecycle logic;
- write production behavior first and add superficial tests afterward;
- test implementation details when public behavior or invariants are available;
- use real time, unseeded randomness, arbitrary sleeps, frame counts, or
  rendering state as simulation authority;
- place simulation logic in React components, hooks, Zustand stores, R3F frame
  callbacks, persistence adapters, or transport adapters;
- persist complete application stores by default;
- expose mutable simulation internals to the web client;
- create parallel implementations for difficulty modes;
- add speculative infrastructure outside the active task;
- rewrite unrelated files merely for style consistency.

A milestone is not complete while required validation is failing.
