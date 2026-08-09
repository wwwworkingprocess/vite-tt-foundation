# Phase 3B — In-Memory Foundation Host

> **Document status:** Historical phase contract. This file preserves the named
> milestone scope and acceptance criteria. It is not a current-state summary;
> read [`../current-state.md`](../current-state.md) first.

## Goal

Create a test-first, browser-neutral in-memory authoritative host around
the Phase 3A foundation simulation.

This phase proves application semantics before adding a Web Worker.

## Deliverables

### Simulation package

Add the smallest foundation command model needed to exercise the host:

- `foundation.advance-ticks`;
- runtime validation;
- pure immutable application to `FoundationState`;
- tests for valid, zero, invalid, and overflowing advancement.

No game-domain command is introduced.

### Protocol package

Add only the concrete foundation contracts needed by Phase 3B:

- opaque validated IDs required by the host;
- command envelope;
- terminal applied/rejected result;
- protocol error for conflicting command-ID reuse and identity mismatch;
- reliable foundation-state update;
- replaceable foundation render snapshot;
- synchronization request and full/delta response;
- runtime validation for every cross-boundary value.

All wire values must be JSON-safe.

### Web application host layer

Implement a browser-neutral in-memory host under:

```text
apps/web/src/simulation-host/
```

It must own:

- serialization of command processing;
- command-result retention;
- idempotency fingerprinting;
- `expectedCommandRevision`;
- reliable-update history;
- render-snapshot sequencing;
- subscriptions and cleanup;
- full/delta synchronization.

It must not own simulation rules.

## Required TDD order

1. Add failing protocol and simulation tests.
2. Add failing host contract tests.
3. Confirm the intended red state.
4. Implement the smallest behavior to pass.
5. Refactor while green.
6. Run coverage and all repository validation.

## Required behavioral tests

### Simulation

- parses and applies the foundation command;
- zero advancement is valid and immutable;
- invalid counts are rejected;
- overflow is rejected;
- equivalent batching remains deterministic.

### Host initialization

- uses injected `gameId` and `timelineId`;
- starts all positions at zero;
- exposes an immutable full baseline.

### Applied command

- applies at the current tick;
- returns the resulting tick;
- increments `CommandRevision` once;
- emits one reliable update;
- emits one render snapshot;
- increments the two output sequences independently.

### Stale command revision

- mismatch returns a terminal rejection;
- does not mutate state or any sequence;
- matching revision applies normally;
- ordinary tick advancement does not independently invalidate commands.

### Idempotency

- same ID and equivalent stable intent returns the stored result;
- duplicate result has `duplicate: true`;
- duplicate does not reapply or republish;
- changed correlation/session/sent-at metadata remains equivalent;
- same ID with different stable intent returns protocol error;
- conflicting reuse changes nothing.

### Output semantics

- reliable offsets are contiguous;
- render snapshots are replaceable and separately sequenced;
- rejected and duplicate commands publish nothing;
- subscriptions clean up idempotently;
- one failing listener does not prevent other listeners.

### Synchronization

- missing baseline returns full;
- wrong timeline returns full;
- same timeline and retained offset returns contiguous delta;
- current offset returns empty delta;
- client-ahead offset returns full;
- full baseline and delta report consistent coordinates;
- render sequence is not used for reliable synchronization.

### Serialization

- all public envelopes round-trip through JSON;
- runtime schemas reject malformed, unsafe, non-finite, or incompatible
  values;
- public results and projections are immutable by contract.

## Coverage

Keep the existing repository thresholds:

```text
Statements  95%
Lines       95%
Functions   95%
Branches    90%
```

Do not broaden exclusions beyond tests and generated output.

## Non-goals

Do not add:

- Worker code or `postMessage`;
- scheduler or timer loops;
- playback accumulator implementation;
- Dexie or IndexedDB;
- Zustand simulation bridge;
- Socket.IO;
- React UI;
- R3F visualization changes;
- transport-game mechanics;
- authentication;
- durable persistence;
- random ID generation;
- generic speculative framework abstractions.

## Acceptance criteria

Phase 3B is complete only when:

1. the foundation command is pure and simulation-owned;
2. the host is browser-neutral and outside `packages/simulation`;
3. command revisions, stream offsets, render sequences, ticks, and
   timelines remain distinct;
4. command idempotency and conflict behavior are executable tests;
5. stale revision behavior is executable and non-mutating;
6. reliable updates and render snapshots have separate semantics;
7. synchronization supports full and retained contiguous delta responses;
8. subscriptions clean up and isolate listener failures;
9. all wire contracts are runtime-validated and JSON-safe;
10. coverage thresholds pass;
11. standard validation and independent package builds pass;
12. no Phase 3C+ work is introduced.

## Completion report

Finish with:

```text
Summary
Changed
TDD and coverage
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```

Report the exact Node and Yarn versions used.
