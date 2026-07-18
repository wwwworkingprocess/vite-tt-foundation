# Foundation In-Memory Host Model

## Status

Implemented architecture contract for Phase 3B.

This phase creates a browser-neutral in-memory reference host around the
Phase 3A deterministic foundation state. It proves command, idempotency,
revision, stream, render-snapshot, and synchronization semantics before
introducing a Web Worker or persistence.

It does not introduce transport-game mechanics.

## Ownership

`packages/simulation` owns:

- the immutable foundation simulation state;
- the five-second `SimulationTick`;
- the deliberately trivial foundation command;
- domain validation and pure deterministic command application.

`packages/protocol` owns:

- serializable foundation envelopes and read-model contracts;
- validated identifiers and position primitives;
- protocol-level command results and errors.

`apps/web/src/simulation-host` owns:

- the browser-neutral in-memory authoritative host;
- `CommandRevision` assignment;
- `StreamOffset` assignment;
- `RenderSnapshotSequence` assignment;
- command-result retention and idempotency;
- reliable update publication;
- replaceable render-snapshot publication;
- full and delta synchronization.

The host code must not import React, Zustand, Dexie, Three.js, R3F, Worker
globals, timers, Socket.IO, or browser APIs.

## Foundation command

Phase 3B uses exactly one deliberately trivial command:

```ts
interface AdvanceFoundationTicksCommand {
  readonly type: 'foundation.advance-ticks';
  readonly count: TickAdvancement;
}
```

It exists only to prove the host boundary. It is not a transport-game
mechanic.

The simulation package validates and applies the command purely:

```ts
applyFoundationCommand(
  state: FoundationState,
  command: FoundationCommand,
): FoundationState;
```

## Host creation

The host receives all durable identity explicitly:

```ts
createInMemorySimulationHost({
  gameId,
  timelineId,
  initialState,
});
```

The host must not generate random identifiers internally.

Initial coordinates are:

```text
CommandRevision         0
StreamOffset            0
RenderSnapshotSequence  0
SimulationTick          initialState.tick
```

The first accepted command advances each applicable sequence to `1`.

## Command processing order

For one game, commands are serialized.

`sendCommand` is Promise-based. The in-memory host processes submissions
through one FIFO promise queue, so a listener that submits another command
cannot interleave its publications with the command currently being published.

For a new command:

1. runtime-validate the envelope;
2. confirm `gameId` and `timelineId`;
3. look up the `(gameId, commandId)` result;
4. return the stored result for an equivalent duplicate;
5. reject conflicting command-ID reuse;
6. compare `expectedCommandRevision` when supplied;
7. validate and apply the domain command through `packages/simulation`;
8. increment `CommandRevision` exactly once;
9. retain the terminal command result;
10. publish one reliable foundation-state update;
11. publish one replaceable render snapshot.

A rejected command does not change simulation state, `CommandRevision`,
`StreamOffset`, or `RenderSnapshotSequence`.

A duplicate does not reapply the command and does not publish new output.

## Applied command result

For the foundation command, an applied result records both sides of the
application boundary:

```ts
interface AppliedFoundationCommandResult {
  readonly status: 'applied';
  readonly appliedAtTick: SimulationTick;
  readonly resultingSimulationTick: SimulationTick;
  readonly appliedCommandRevision: CommandRevision;
  readonly duplicate: boolean;
}
```

`appliedAtTick` is the tick before command application.
`resultingSimulationTick` is the tick after advancing the requested count.

## Idempotency fingerprint

Phase 3B uses a normalized, deterministic fingerprint containing only
stable command intent:

```text
gameId
timelineId
command type
validated command payload
expectedCommandRevision, when supplied
```

It excludes:

```text
correlationId
sessionId
clientId
sentAt
transport attempt information
connection information
```

Therefore, a retry may use changed diagnostic/session metadata and still
be an equivalent duplicate.

Reusing one `commandId` with different stable intent is a protocol error.

Command results are retained only for the lifetime of the in-memory host.
Persistence and retention policy remain deferred.

## Reliable update

Every newly applied command publishes one reliable immutable update:

```ts
interface FoundationStateUpdate {
  readonly kind: 'foundation-state-update';
  readonly gameId: GameId;
  readonly timelineId: TimelineId;
  readonly streamOffset: StreamOffset;
  readonly commandRevision: CommandRevision;
  readonly simulationTick: SimulationTick;
}
```

The first update has `StreamOffset` 1.

Reliable updates must be contiguous. They are retained in memory during
the host lifetime for delta synchronization.

## Replaceable render snapshot

Every newly applied command also publishes one render snapshot:

```ts
interface FoundationRenderSnapshot {
  readonly kind: 'foundation-render-snapshot';
  readonly gameId: GameId;
  readonly timelineId: TimelineId;
  readonly sequence: RenderSnapshotSequence;
  readonly commandRevision: CommandRevision;
  readonly simulationTick: SimulationTick;
}
```

The first snapshot has `RenderSnapshotSequence` 1.

A skipped render sequence does not imply a reliable stream gap. The latest
compatible snapshot wins.

## Subscription behavior

Reliable updates and render snapshots use separate subscriptions.

Each subscription returns an idempotent cleanup function.

Each call creates an independent registration, even when the same callback is
subscribed more than once. Removing one registration leaves the others active.

Required behavior:

- listeners are called in registration order;
- removing one listener does not affect others;
- an unsubscribed listener receives no later publications;
- duplicate and rejected commands publish nothing;
- one listener throwing must not prevent other listeners from receiving
  the publication;
- listener failures are exposed through a small host diagnostic callback
  or returned diagnostic collection, not thrown through command
  processing.
- failures thrown by the diagnostic callback itself are isolated from command
  processing and publication.

The exact diagnostic shape may remain minimal in Phase 3B.

## Synchronization

The host exposes a synchronization operation independent of any adapter.

A full baseline contains:

```text
gameId
timelineId
current CommandRevision
current SimulationTick
last included StreamOffset
immutable foundation read model
```

A delta may be returned only when:

- the requested `TimelineId` matches;
- the client offset is not ahead;
- the host retains every update after the client offset.

Because Phase 3B retains all updates for the host lifetime, matching,
non-ahead offsets can receive a contiguous delta.

Return a full baseline when:

- no timeline is supplied;
- the timeline differs;
- the client offset is ahead;
- the request has no usable baseline.

A request for a different `gameId` returns only an identity-mismatch result. It
must not expose either a full baseline or a delta for the host game.

An offset equal to the current offset returns an empty valid delta.

Synchronization never uses render-snapshot sequence continuity.

## Required invariants

```text
accepted new command:
  CommandRevision +1
  StreamOffset +1
  RenderSnapshotSequence +1

rejected command:
  no authoritative coordinate changes

equivalent duplicate:
  no authoritative coordinate changes
  same stored result with duplicate = true

conflicting command ID:
  no authoritative coordinate changes

reliable history:
  offsets are contiguous from 1

simulation:
  resulting state equals pure simulation command application
```

## Deferred work

- Web Worker adapter;
- browser scheduling and playback accumulation;
- Dexie persistence;
- Zustand bridge;
- Socket.IO;
- authentication and authorization;
- durable command-result retention;
- event compaction;
- game-domain commands and events;
- React or R3F integration.
