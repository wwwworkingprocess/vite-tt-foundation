# Persistence and Application Bridge Model

## Status

Provisional architecture contract for Phase 3D.

Phase 3D adds versioned local persistence and a vanilla Zustand bridge
around the accepted direct/Worker client contract.

It does not add timers, autosave scheduling, gameplay UI, route data, or
transport mechanics.

## Architecture

```text
React later
   |
   v
vanilla Zustand application projection
   ^
   |
FoundationApplicationController
   |                 |
   v                 v
FoundationSimulationClient   FoundationSaveRepository
(direct or Worker)                 |
                                   v
                              Dexie / IndexedDB
```

The simulation client remains authoritative. The store is a replaceable
projection. The repository stores validated save records but never mutates
simulation state.

## Simulation snapshot

`packages/simulation` owns a versioned foundation snapshot:

```ts
interface FoundationSimulationSnapshotV1 {
  readonly kind: 'foundation-simulation-snapshot';
  readonly schemaVersion: 1;
  readonly simulationVersion: 'foundation-1';
  readonly state: {
    readonly tick: SimulationTick;
  };
}
```

Required APIs are pure and environment-neutral:

```ts
createFoundationSimulationSnapshot(
  state: FoundationState,
): FoundationSimulationSnapshot;

restoreFoundationState(
  snapshot: FoundationSimulationSnapshot,
): FoundationState;

parseFoundationSimulationSnapshot(
  value: unknown,
): FoundationSimulationSnapshot;
```

All returned values are deeply immutable.

## Snapshot export envelope

The host/client boundary exports an exact authoritative snapshot:

```ts
interface FoundationSnapshotExport {
  readonly kind: 'foundation-snapshot-export';
  readonly gameId: GameId;
  readonly timelineId: TimelineId;
  readonly commandRevision: CommandRevision;
  readonly simulationTick: SimulationTick;
  readonly streamOffset: StreamOffset;
  readonly snapshot: FoundationSimulationSnapshot;
}
```

The export is queued with command processing. It is not delivered through
reliable or render subscriptions.

Direct and Worker clients expose:

```ts
exportSnapshot(): Promise<FoundationSnapshotExport>;
```

The Worker operation is runtime-validated on both sides and refrozen after
structured cloning.

## Connect modes

The shared client connect request becomes an explicit union:

```ts
type FoundationClientConnectRequest =
  | {
      readonly mode: 'new';
      readonly gameId: GameId;
      readonly timelineId: TimelineId;
      readonly initialSimulationTick: SimulationTick;
    }
  | {
      readonly mode: 'restore';
      readonly gameId: GameId;
      readonly timelineId: TimelineId;
      readonly snapshot: FoundationSimulationSnapshot;
    };
```

A restored host initializes simulation state from the snapshot. All host
coordinates still begin at zero.

The restore controller enforces that the new timeline differs from the
saved source timeline.

## Save record

Application persistence uses a strict versioned record:

```ts
interface FoundationSaveRecordV1 {
  readonly kind: 'foundation-save-record';
  readonly schemaVersion: 1;
  readonly saveId: FoundationSaveId;
  readonly label?: string;
  readonly gameId: GameId;
  readonly sourceTimelineId: TimelineId;
  readonly sourceCommandRevision: CommandRevision;
  readonly sourceSimulationTick: SimulationTick;
  readonly sourceStreamOffset: StreamOffset;
  readonly createdAtUtcMs: number;
  readonly updatedAtUtcMs: number;
  readonly snapshot: FoundationSimulationSnapshot;
}
```

Rules:

- IDs and timestamps are supplied by the caller;
- timestamps are non-negative safe integer UTC epoch milliseconds;
- `updatedAtUtcMs >= createdAtUtcMs`;
- labels are trimmed, bounded strings;
- `sourceSimulationTick` equals the snapshot tick;
- all values are JSON-safe and deeply immutable;
- repository output is revalidated, cloned, and frozen.

## Save repository port

```ts
interface FoundationSaveRepository {
  put(record: FoundationSaveRecord): Promise<void>;
  get(saveId: FoundationSaveId): Promise<FoundationSaveRecord | undefined>;
  list(): Promise<readonly FoundationSaveSummary[]>;
  delete(saveId: FoundationSaveId): Promise<void>;
  close(): Promise<void>;
}
```

`put` replaces a record with the same `saveId`.

`list()` returns immutable summaries ordered by:

1. `updatedAtUtcMs` descending;
2. `saveId` ascending as deterministic tie-breaker.

An in-memory repository and Dexie repository must pass one shared contract
suite.

## Dexie database

Phase 3D uses database schema version one.

Suggested table:

```text
foundationSaves
  primary key: saveId
  indexes: gameId, updatedAtUtcMs
```

Requirements:

- database name is injected for test isolation;
- no module-global database singleton;
- stored values are plain JSON-safe records;
- every read is runtime-validated;
- corrupted records produce a typed persistence error;
- close is idempotent;
- test databases are explicitly deleted;
- no timers, polling, or autosave behavior.

A test-only IndexedDB implementation such as `fake-indexeddb` may be added
if not already present.

## Application projection

Use `zustand/vanilla` for a framework-independent store.

Suggested state:

```ts
interface FoundationApplicationState {
  readonly session:
    | { readonly status: 'idle' }
    | { readonly status: 'starting' | 'restoring' }
    | {
        readonly status: 'ready';
        readonly gameId: GameId;
        readonly timelineId: TimelineId;
      }
    | { readonly status: 'failed'; readonly message: string }
    | { readonly status: 'closed' };

  readonly authoritative?: {
    readonly commandRevision: CommandRevision;
    readonly simulationTick: SimulationTick;
    readonly streamOffset: StreamOffset;
  };

  readonly latestRenderSnapshot?: FoundationRenderSnapshot;

  readonly synchronization:
    | { readonly status: 'idle' | 'synchronized' }
    | {
        readonly status: 'required';
        readonly reason: 'gap' | 'timeline-mismatch';
      }
    | { readonly status: 'synchronizing' }
    | { readonly status: 'failed'; readonly message: string };

  readonly persistence:
    | { readonly status: 'idle'; readonly saves: readonly FoundationSaveSummary[] }
    | { readonly status: 'saving' | 'loading' | 'restoring'; readonly saves: readonly FoundationSaveSummary[] }
    | { readonly status: 'failed'; readonly saves: readonly FoundationSaveSummary[]; readonly message: string };
}
```

Concrete naming may vary. State exposed to consumers is immutable.

## Application controller

The controller owns side effects and updates the store.

Required operations:

```ts
startNew(request);
synchronize();
save(input);
listSaves();
restore(input);
deleteSave(saveId);
close();
```

### Start

`startNew`:

1. creates a client through an injected factory;
2. subscribes before connecting;
3. connects in `new` mode;
4. performs full synchronization;
5. publishes a ready immutable projection.

### Reliable updates

For one timeline:

- exact next `StreamOffset` is applied;
- already-applied offsets are ignored as duplicates;
- a higher non-contiguous offset marks synchronization required;
- a different timeline marks synchronization required;
- the store never invents missing state.

### Render snapshots

- matching timeline only;
- newer sequence replaces the previous snapshot;
- duplicates/older snapshots are ignored;
- render sequence does not affect reliable synchronization.

### Save

`save`:

1. calls queued `client.exportSnapshot()`;
2. builds a validated save record from caller-supplied save metadata;
3. writes through the repository;
4. refreshes immutable save summaries.

No autosave timer is added.

### Restore

`restore`:

1. loads and validates the save;
2. requires a caller-supplied new timeline different from the source;
3. closes the current client;
4. creates a new client;
5. subscribes before connect;
6. connects in restore mode using the saved snapshot;
7. performs full synchronization;
8. publishes a ready projection with zero command revision and stream
   offset on the new timeline.

If restoration fails after the old client is closed, the controller enters
a failed state and does not pretend the old session remains active.

### Close

Close is idempotent and:

- closes the active client;
- removes subscriptions;
- closes the repository;
- rejects new controller operations;
- transitions the projection to closed.

## Concurrency

Controller mutations are serialized through one application-operation
queue.

This prevents overlapping:

- save and restore;
- two restores;
- close during save;
- start during restore.

Read-only store access and subscriptions remain synchronous.

An operation already queued before close is rejected when close begins
unless it is the close operation itself.

## Testing

### Snapshot tests

- exact round trip;
- schema/version rejection;
- invalid tick rejection;
- deep immutability;
- snapshot restoration does not require browser APIs.

### Repository contract

Run against in-memory and Dexie repositories:

- put/get;
- replace same ID;
- missing record;
- deterministic list ordering;
- delete;
- idempotent close;
- malformed write rejection;
- corrupted stored record rejection;
- deep immutable results;
- repository instances/database names isolated.

### Snapshot export

Run against direct and Worker clients:

- export position is serialized with commands;
- commands before export are included;
- commands after export are excluded;
- returned snapshot is deeply frozen;
- Worker clone cannot mutate host state;
- export is not published through update channels.

### Restore

- restored tick equals saved tick;
- new timeline is required;
- same source timeline is rejected;
- command revision/stream/render sequences restart at zero;
- old command IDs/results are not retained;
- first restored command produces revision/offset/sequence one;
- source save remains unchanged.

### Store/controller

- store does not mutate authoritative state directly;
- subscriptions are established before connect;
- initial full synchronization;
- contiguous updates;
- duplicate ignore;
- gap detection;
- latest-compatible render snapshot;
- save refreshes summaries;
- restore swaps client and timeline;
- failed restore exposes failure;
- operations are serialized;
- close is idempotent and terminal;
- state remains deeply immutable.

## Deferred work

- autosave cadence;
- background timers;
- scheduler/playback integration;
- React hooks and save UI;
- PWA storage quota UX;
- cloud/server persistence;
- route data and game mechanics;
- save migration beyond version one;
- compression/encryption;
- thumbnails;
- final playback metadata persistence.
