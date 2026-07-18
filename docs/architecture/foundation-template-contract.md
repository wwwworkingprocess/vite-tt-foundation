# Foundation Template Contract

## Status

Provisional Phase 3F release contract.

## Identity

```text
Template: Foundation Template
Version: 1.0.0
Reference project: Torrevieja Tycoon
```

## Layer inventory

### `packages/simulation`

Owns deterministic tick state, pure command application, snapshots, and
time conversion.

Forbidden: protocol, browser/Worker APIs, persistence, React/R3F,
Zustand, clocks, timers, unseeded randomness, and scenario acquisition.

### `packages/protocol`

Owns validated identifiers, client ports, command/results, reliable and
replaceable projections, synchronization, and lifecycle contracts.

Forbidden: React/R3F, Dexie, Worker globals, and domain data acquisition.

### Web foundation layers

```text
simulation-host     authoritative host and direct client
simulation-worker   Worker wire/runtime/client
persistence         save records and repositories
application         orchestration and application projection
pacing              planner, pacing controller, browser driver
React/R3F shell     composition and representation only
```

React and Zustand never own authoritative simulation state.

## Release invariants

```text
whole-tick deterministic simulation
no simulation clocks
FIFO host commands
idempotent duplicates
contiguous reliable offsets
replaceable render sequences
new timeline on restore
zeroed restored host coordinates/history
versioned validated persistence
Worker clone revalidation/refreezing
read-only Zustand projections
no hidden-time pacing catch-up
exact applied bonus-tick conservation
terminal leak-free close/failure paths
```

## Clone rename surfaces

May rename:

- repository and root package;
- workspace package namespace;
- visible title and copy;
- PWA metadata/icons;
- shell-only default IDs;
- README branding;
- CI artifact names.

Do not blindly rename:

- protocol discriminators;
- persisted `kind` values;
- schema versions;
- lifecycle names;
- authoritative coordinate meanings;
- idempotency semantics.

## Domain extension order

1. validated scenario data;
2. simulation state;
3. snapshot schema evolution;
4. simulation-owned commands;
5. protocol unions/projections;
6. host publications;
7. application workflows;
8. representation;
9. save/restore migration tests.

External preparation tools may create canonical scenario files. The game
repository validates and consumes their output; it need not contain OSM
reconciliation or geocoding.

## Release gate

The template is releasable only after every Phase 3F acceptance criterion
passes under the pinned CI runtime.
