# Phase 3C — Typed Dedicated Worker Adapter

> **Document status:** Historical phase contract. This file preserves the named
> milestone scope and acceptance criteria. It is not a current-state summary;
> read [`../current-state.md`](../current-state.md) first.

## Goal

Host the accepted Phase 3B in-memory foundation host inside a dedicated
Web Worker and expose it through one client contract shared with a direct
in-process adapter.

## Deliverables

### Protocol

Add only adapter-neutral contracts justified by both adapters:

- connect request;
- minimal lifecycle;
- foundation client port types;
- shared client errors where appropriate.

No Worker globals or Worker-specific message kinds enter simulation.

### Direct client adapter

Wrap the existing host behind the common client port while preserving
FIFO commands, results, publication channels, synchronization,
subscriptions, and deep immutability.

### Worker wire contracts

Create strict runtime schemas for Worker-specific request and response
wrappers:

- JSON-safe values;
- monotonic adapter-local request IDs;
- operation discriminators;
- safe serializable failures without raw `Error` objects/stacks;
- revalidation of embedded foundation protocol payloads.

### Worker runtime

Implement a runtime that initializes one host, subscribes before ready,
routes commands/synchronization, forwards publications, correlates
responses, validates both directions, reports safe failures, and closes
cleanly.

### Worker client

Implement a client that creates or receives a Worker, owns pending request
correlation, implements the shared port, validates/deeply freezes received
values, maps failures to lifecycle, rejects pending work on failure/close,
removes listeners, and terminates exactly once.

No automatic retry or recreation.

### Shared contract suite

Run one behavior suite against:

- direct adapter;
- Worker adapter using a structured-clone loopback Worker double.

The suite must be adapter-blind.

### Browser smoke

Extend Cypress to prove the actual Vite Worker entry loads and executes in
a real browser context.

A minimal foundation status is allowed. No gameplay UI is allowed.

## Required TDD order

1. Write failing shared client contract tests.
2. Add failing Worker parser/failure tests.
3. Confirm red state.
4. Implement direct and Worker clients minimally.
5. Add actual-browser Worker smoke.
6. Refactor while green.
7. Run coverage and full validation.

## Behavioral requirements

### Shared contract

- starts idle;
- connects once and becomes ready;
- rejects operations before ready;
- applies command and resolves terminal result;
- stale, duplicate, conflict, and identity outcomes match;
- reliable update precedes matching render snapshot;
- later commands remain FIFO;
- full, delta, empty-delta, ahead, wrong-timeline, and wrong-game sync;
- independent/idempotent subscriptions;
- listener failures isolated;
- returned and published nested values deeply immutable;
- close idempotent;
- nothing accepted or published after close.

### Worker transport

- request IDs start at one and increase;
- responses settle only matching requests;
- unknown/duplicate response IDs do not affect other requests;
- structured cloning removes freeze and receive-side refreezing restores
  immutability;
- startup error enters failed;
- crash and `messageerror` reject all pending operations;
- close removes listeners and terminates once;
- no pending promise survives terminal failure.

### Browser

- real dedicated Worker reaches ready;
- one command advances the tick;
- result/update reaches the page;
- no fatal error;
- cleanup terminates the Worker.

## Coverage

Retain:

```text
Statements  95%
Lines       95%
Functions   95%
Branches    90%
```

Do not exclude Worker production modules merely to preserve thresholds.
Any browser-entry exclusion requires explicit minimal justification.

## Non-goals

Do not add scheduling, automatic ticks, playback accumulators, restart,
persistence, Dexie, Zustand bridge, Socket.IO, authentication, route
data, transport mechanics, R3F gameplay visualization, multiplayer,
generic RPC framework, binary transport, or transferables.

## Acceptance criteria

1. Direct and Worker clients share one contract.
2. One suite passes against both.
3. Worker runtime delegates to the accepted host.
4. Every boundary value is runtime-validated.
5. Received projections are deeply frozen after clone.
6. Command results remain promise results, not publications.
7. Reliable/render channels remain distinct.
8. Pending requests settle or reject deterministically.
9. Failure/close cleanup removes listeners and terminates resources.
10. Real Cypress smoke proves the bundled Worker.
11. Coverage and full validation pass.
12. No Phase 3D+ work appears.

## Completion report

```text
Summary
Changed
TDD and coverage
Worker contract and browser smoke
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```

Report exact Node, Yarn, Cypress, and browser versions.
