# Phase 2 Prompt — Socket.IO Readiness Research

## Objective

Research and document how Torrevieja Tycoon can support a future Socket.IO-based authoritative host without making Socket.IO part of the simulation core, domain model, or public application semantics.

This is an architecture-research and documentation phase. Do not implement networking.

The result must make the later Worker and Socket.IO adapters easier to build while preserving the existing package boundaries and deterministic simulation model.

## Read first

Before working:

1. read `AGENTS.md`;
2. read every document linked from `docs/project-foundation.md`;
3. inspect the current protocol and simulation package public exports and tests;
4. inspect the existing tooling ADR;
5. state a concise research plan before editing.

## Research-source requirements

Use current primary sources only for technical claims:

- official Socket.IO 4.x documentation;
- official web-platform specifications or MDN only where browser behaviour must be clarified;
- official TypeScript or Node.js documentation only where relevant.

Record the source links and access date in the resulting ADR. Clearly distinguish documented Socket.IO guarantees from application-level guarantees that Torrevieja Tycoon must implement itself.

At minimum, examine the current official documentation for:

- delivery guarantees and message ordering;
- acknowledgements, acknowledgement timeouts, and client retries;
- connection-state recovery and its limitations;
- handling disconnections and full resynchronization;
- typed events;
- client identity versus ephemeral `socket.id`;
- horizontal scaling and adapter compatibility caveats.

## Required questions to answer

### Boundary and ownership

1. Which package should own domain commands and domain events?
2. Which package should own network/worker envelopes and transport contracts?
3. Which application layer should own Worker and future Socket.IO adapter implementations?
4. Should the web client depend on a single app-facing simulation-client port while Worker and Socket.IO are hidden behind adapters?
5. How can the local Worker host and a future server host expose equivalent semantics without pretending that they have identical failure modes?

### Commands and acknowledgements

6. What does an acknowledgement mean: packet received, command validated, command accepted, command applied, or resulting revision published?
7. Which identifiers are needed for idempotency, correlation, causation, game identity, client identity, and session identity?
8. How should stale expected revisions and duplicate commands be handled?
9. Which errors are protocol errors, command rejections, authorization failures, or transient transport failures?

### Events, snapshots, and synchronization

10. What ordering and delivery guarantees does Socket.IO provide by default, and what must the application add?
11. When should the host emit domain events, compact render/read-model updates, full snapshots, or snapshot references?
12. How should a client recover after temporary disconnection, failed connection-state recovery, browser refresh, missed events, or an expired session?
13. What revision, tick, offset, and schema/version information should be carried in messages?
14. How should the client detect gaps, duplicates, stale snapshots, and incompatible protocol versions?

### Future deployment

15. How should rooms or namespaces be used without leaking Socket.IO concepts into domain contracts?
16. What assumptions must not be made about Redis or other scaling adapters, especially connection-state-recovery support?
17. Which authentication, authorization, persistence, hosting, observability, and rate-limiting concerns remain explicitly deferred?

## Required deliverables

### 1. Architecture decision record

Create:

```text
docs/architecture/decisions/0002-simulation-host-transport-readiness.md
```

It must include:

- context;
- researched facts with official sources;
- options considered;
- decision;
- consequences and trade-offs;
- risks and mitigations;
- deferred decisions;
- source list and access date.

The decision should remain adapter-neutral. Do not select a production hosting provider, database, authentication system, or Socket.IO scaling adapter.

### 2. Transport contract design document

Create:

```text
docs/architecture/transport-contract.md
```

Specify proposed concepts and TypeScript-shaped examples in documentation only. At minimum include:

- the app-facing simulation-client port;
- host/transport lifecycle states;
- command envelope;
- command result or acknowledgement envelope;
- event envelope;
- snapshot/read-model envelope;
- synchronization request and response;
- protocol and schema compatibility information;
- error categories;
- subscription and cleanup semantics.

Do not create the final game command/event catalogue. Use deliberately trivial example payloads where examples are necessary.

### 3. Failure-mode matrix

Include a matrix covering at least:

- temporary network loss;
- browser tab refresh;
- duplicate command delivery;
- acknowledgement timeout after the host applied a command;
- out-of-order or duplicated event observation;
- missed event gap;
- stale expected revision;
- incompatible protocol version;
- host restart;
- failed connection-state recovery;
- client ahead of or behind the authoritative revision.

For each, identify detection, authoritative response, client response, and whether a full snapshot resynchronization is required.

### 4. Documentation alignment

Update only the architecture/development documents that must change to reflect durable decisions. Do not rewrite unrelated documentation.

The TDD and coverage policy in `docs/development/testing-strategy.md` is already authoritative. This phase must not add simulation behaviour merely to exercise the test setup.

## Expected architectural direction to evaluate, not blindly assume

Evaluate whether the following is the cleanest model:

```text
React / R3F / UI
        │
        ▼
app-facing SimulationClient port
        │
        ├── Worker adapter ──► local simulation host
        │
        └── Socket.IO adapter ──► remote authoritative host
```

The simulation core should receive domain commands and produce domain outcomes without knowing whether its host is local or remote. Socket.IO-specific concepts such as sockets, rooms, reconnect attempts, acknowledgement callbacks, and adapter selection must remain outside `packages/simulation`.

Do not force Worker transport to imitate network failure semantics where that would reduce clarity. Share protocol concepts where useful while allowing adapter-specific lifecycle information.

## Explicit non-goals

Do not:

- install `socket.io`, `socket.io-client`, or a scaling adapter;
- add a server application;
- implement Web Worker communication;
- implement a transport interface in production code;
- add commands, events, snapshots, or envelopes to package runtime code;
- add persistence workflows;
- design multiplayer gameplay;
- design authentication or authorization;
- add transport simulation mechanics;
- change pinned dependency versions;
- weaken package boundaries, tests, lint rules, or compiler settings.

## Acceptance criteria

1. The ADR uses current official sources and distinguishes library guarantees from application responsibilities.
2. The recommended architecture keeps Socket.IO out of the simulation package and domain semantics.
3. Worker and Socket.IO adapters have a credible shared app-facing boundary without hiding their different failure modes.
4. Command acknowledgement semantics are explicitly defined.
5. Idempotency and duplicate-command handling are addressed.
6. Ordering, delivery, event-gap detection, and snapshot resynchronization are addressed.
7. Ephemeral socket identity is not treated as durable client, session, user, or game identity.
8. Protocol/schema versioning and stale-revision handling are addressed.
9. Scaling-adapter and connection-state-recovery caveats are documented without selecting infrastructure prematurely.
10. No runtime dependencies or application features are added.
11. Documentation links remain valid and formatting passes.
12. Existing lint, typecheck, tests, builds, and Cypress smoke test still pass.

## Validation

Run from the repository root:

```text
corepack yarn format:check
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn build
corepack yarn test:e2e
```

If the runtime differs from the pinned Node version, report the exact version and do not claim validation under the pinned runtime.

## Completion report

Finish with:

```text
Summary
Changed
Research findings and decision
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```
