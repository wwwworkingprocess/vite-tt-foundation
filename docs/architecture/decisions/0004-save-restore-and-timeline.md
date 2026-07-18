# ADR 0004: Save, restore, and authoritative timeline semantics

## Status

Proposed for Phase 3D.

## Context

The deterministic simulation can serialize and restore its own
authoritative state, but it must not perform persistence.

The web application needs versioned local saves through IndexedDB. A
restore replaces the currently authoritative history with an earlier
snapshot. Existing command revisions, stream offsets, render sequences,
and retained command outcomes cannot safely continue as though no history
replacement occurred.

## Decision

### Simulation snapshot ownership

`packages/simulation` owns the serializable and runtime-validated
foundation simulation snapshot.

The snapshot contains only authoritative simulation data and its schema
compatibility metadata. It does not contain:

- IndexedDB keys;
- save labels;
- browser timestamps;
- client lifecycle;
- `CommandRevision`;
- `StreamOffset`;
- `RenderSnapshotSequence`;
- retained command results;
- Worker request IDs;
- Zustand state;
- playback timers or host clock data.

### Persistence ownership

The web application owns a `FoundationSaveRepository` port and a Dexie
implementation.

The repository stores a save record containing:

- save-record schema version;
- `saveId`;
- optional user-facing label;
- `gameId`;
- source `TimelineId`;
- source `CommandRevision`;
- source `SimulationTick`;
- caller-supplied created/updated UTC metadata;
- simulation snapshot.

The repository does not create simulation snapshots and does not restore a
host. It stores and returns validated immutable data.

### Atomic snapshot export

The authoritative host exposes a queued snapshot-export operation.

Snapshot export is serialized with commands so it observes one exact
authoritative position:

```text
all commands accepted before export
    -> included in snapshot

all commands queued after export
    -> excluded from snapshot
```

The export includes source identity and coordinates alongside the
simulation-owned snapshot.

### Restore creates a new timeline

Restoring a save requires a caller-supplied `newTimelineId`.

The restored session:

- preserves the saved `gameId`;
- restores the saved simulation snapshot;
- requires `newTimelineId` to differ from the saved source timeline;
- starts `CommandRevision` at zero;
- starts `StreamOffset` at zero;
- starts `RenderSnapshotSequence` at zero;
- begins with no retained command outcomes or reliable-update history.

The source timeline and source command revision remain save metadata for
diagnostics. They are not resumed.

This makes history replacement explicit and prevents old commands or
incremental messages from being mistaken for part of the restored
timeline.

### No implicit time or identity generation

The repository and controller do not call `Date.now()` or generate IDs.

Callers inject:

- `saveId`;
- timestamps;
- new timeline identity.

This keeps behavior deterministic and tests reproducible.

### Application state bridge

A vanilla Zustand store presents immutable application projections:

- client lifecycle;
- authoritative identity and coordinates;
- latest full/read-model projection;
- latest render snapshot;
- synchronization status;
- save-operation status and save summaries.

The store is not authoritative simulation state. It may be deleted and
rebuilt from client synchronization without changing the simulation.

Commands, snapshot export, save, and restore are performed by an
application controller. Store actions must not directly mutate
authoritative coordinates or simulation state.

## Consequences

### Benefits

- simulation remains independent of IndexedDB and Zustand;
- saves are versioned and runtime-validated;
- snapshot export has an exact command-order boundary;
- restore cannot silently merge incompatible histories;
- the UI receives one reactive state projection without owning outcomes;
- in-memory and Dexie repositories can share contract tests.

### Costs

- restoring requires a new timeline ID from the application;
- command-result history and reliable deltas are not retained across
  restore;
- persistence and application-controller tests require more explicit
  fixtures and injected metadata.

## Deferred decisions

- autosave cadence and timers;
- cloud or server persistence;
- save encryption or compression;
- user accounts and cross-device sync;
- save thumbnails;
- production migration beyond schema version one;
- persistence of final playback-mode and bonus-entitlement configuration;
- replay history;
- background-tab lifecycle;
- storage quotas and eviction UX.
