# ADR 0002: Simulation host transport readiness

## Status

Accepted in Phase 2.

## Context

Torrevieja Tycoon must support a local Web Worker host first and may later support a remote authoritative host over Socket.IO. The simulation core must remain deterministic and unaware of workers, sockets, rooms, reconnection, persistence, or deployment topology.

The application needs one stable way to issue commands, observe outcomes, and synchronize state. That boundary must not imply that a local worker and a remote network have identical availability or failure modes.

This ADR records architecture only. No runtime contract, adapter, server, command catalogue, or Socket.IO dependency is introduced.

## Researched facts

The following are Socket.IO 4.x guarantees or limitations documented by Socket.IO, not guarantees supplied by Torrevieja Tycoon:

- Socket.IO preserves message ordering across its supported low-level transports, including an upgrade from HTTP long-polling to WebSocket, provided messages arrive.
- Delivery is at most once by default. An interrupted send may or may not have reached the peer, the client does not automatically retry it after reconnection by default, and the server does not buffer missed events for a disconnected client.
- Client `retries` plus `ackTimeout` can attempt an event up to `retries + 1` times until the server acknowledges it. This improves arrival probability but means the application must tolerate duplicate delivery. Pending client events are lost on browser refresh.
- An acknowledgement is a callback mechanism. Socket.IO does not define whether it means receipt, validation, acceptance, application, persistence, or publication; that meaning belongs to the application protocol.
- Connection-state recovery can restore socket state and missed packets after some temporary disconnections, but recovery is not guaranteed. Applications must still implement state synchronization.
- Recovery support depends on the selected Socket.IO adapter. The built-in adapter and Redis Streams adapter support it; the classic Redis Pub/Sub adapter does not. This capability must be verified when infrastructure is selected.
- `socket.id` is ephemeral, changes on reconnection or refresh, differs between tabs, and has no durable message queue. It is unsuitable as a game, user, client, or durable session identity.
- Rooms are server-only routing channels. Namespaces and rooms are Socket.IO deployment tools, not domain concepts.
- Socket.IO TypeScript event maps provide compile-time hints but do not validate or sanitize runtime input.
- Multi-node deployments need session-aware routing when HTTP long-polling is enabled and need an adapter to forward broadcasts between nodes. The exact requirements depend on the chosen transports and deployment topology.
- Disconnections are normal. Automatic reconnection does not itself recover application state or events missed while disconnected.

## Application guarantees Torrevieja Tycoon must add

Torrevieja Tycoon cannot derive correctness from transport delivery alone. A future host and protocol must provide:

- runtime validation of every envelope and payload at trust boundaries;
- a durable `commandId` and idempotency result store scoped to a game;
- an optional `expectedCommandRevision` for optimistic concurrency;
- one monotonically increasing `CommandRevision` for accepted external commands;
- one `StreamOffset` sequence for reliable message gap and duplicate detection;
- a `TimelineId` that identifies the authoritative history across creation, restoration, or replacement;
- a separate `RenderSnapshotSequence` for replaceable visual projections;
- protocol and payload schema versions;
- a synchronization operation that returns either a contiguous delta or a full current read model;
- explicit command result semantics, including the `CommandRevision` at which a command was applied;
- durable application identities independent of any Socket.IO connection identifier;
- explicit authorization checks in a future remote host;
- observability around command latency, duplicates, gaps, reconnects, recovery failures, and resynchronization.

## Options considered

### Option A: expose Socket.IO directly to React and application stores

Rejected. Components would depend on connection callbacks, rooms, and retry behavior. Worker hosting would need a second application API, and transport concerns could leak into domain and presentation state.

### Option B: define separate Worker and Socket.IO client APIs

Rejected. It would duplicate command, result, event, and synchronization semantics and make switching host modes visible throughout the UI. Divergence would be likely.

### Option C: one app-facing client port with adapter-neutral envelopes

Accepted. React and application state depend on a `SimulationClient` port. Worker and future Socket.IO adapters implement that port and translate adapter-specific lifecycle information into a small common lifecycle model. Detailed diagnostics remain adapter-specific.

```text
React / R3F / application state
                |
                v
       SimulationClient port
          /             \
 Worker adapter      Socket.IO adapter
      |                    |
 local host        remote authoritative host
      \                    /
       simulation application service
                  |
          deterministic simulation
```

The common port promises equivalent application semantics, not identical failures. A Worker adapter can report a worker crash or startup failure; a Socket.IO adapter can report network loss, reconnect attempts, and recovery status.

## Decision

### Ownership

- `packages/simulation` owns domain commands, command validation that is part of game rules, domain events, authoritative `SimulationTick`, snapshots, and deterministic state transitions.
- `packages/protocol` owns the distinct `CommandRevision`, `StreamOffset`, `TimelineId`, and `RenderSnapshotSequence` primitives. It will also own serializable adapter-neutral envelopes, version metadata, error/result categories, synchronization contracts, and the app-facing client/host port where sharing across process boundaries is justified.
- `apps/web` will own the Worker creation/transport adapter and future Socket.IO client adapter. A future remote host application will own its Socket.IO server adapter, authentication/authorization integration, deployment, and persistence adapters.
- Socket.IO event names, acknowledgement callbacks, rooms, namespaces, reconnection options, and `socket.id` remain inside Socket.IO adapters.

The exact production TypeScript API is deferred to Phase 3. The proposed shape is documented in [`../transport-contract.md`](../transport-contract.md).

### Command result semantics

An application acknowledgement is a terminal `CommandResult`, not a packet receipt acknowledgement.

For an applied command, the result means:

1. the envelope and payload were validated;
2. the host authorized the operation where authorization applies;
3. the command passed domain validation;
4. the authoritative simulation applied it exactly once for its `commandId`;
5. the host assigned and returns the resulting `CommandRevision`.

It does **not** mean that every subscriber has observed the resulting event or read-model publication. Publication and client observation are separate. Rejected commands return a terminal rejection without advancing `CommandRevision`. A transport timeout is not a rejection and leaves the outcome unknown until the client queries or retries with the same `commandId`.

### Idempotency and concurrency

- A client generates a globally unique `commandId` before its first send and reuses it for all retries.
- The host records the terminal result for each `(gameId, commandId)` for a defined retention period.
- A duplicate with an equivalent envelope returns the original result and never reapplies the command.
- Reuse of a `commandId` with different content is a protocol violation.
- If `expectedCommandRevision` does not equal the current `CommandRevision` when processing begins, the host returns `stale_command_revision` with the current value. The client synchronizes before deciding whether user intent can be safely resubmitted as a new command.
- Commands for one game are serialized by the authoritative host. Cross-game ordering is not promised.

### Identities and metadata

The protocol concepts have distinct purposes:

| Field             | Purpose                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `gameId`          | Selects the authoritative simulation instance.                                              |
| `commandId`       | Idempotency key for one command intent.                                                     |
| `correlationId`   | Correlates logs and an app-level interaction.                                               |
| `causationId`     | Links an emitted outcome to the command or event that caused it.                            |
| `clientId`        | Identifies a logical client installation/device when needed; not an authorization identity. |
| `sessionId`       | Identifies a logical application session; lifecycle policy is deferred.                     |
| `actorId`         | Future authenticated principal for authorization; design is deferred.                       |
| `connectionId`    | Adapter diagnostic only; never domain or durable identity.                                  |
| `commandRevision` | Orders accepted external commands; routine tick advancement does not increment it.          |
| `simulationTick`  | Authoritative game-time coordinate.                                                         |
| `streamOffset`    | Orders reliable client-visible messages and detects duplicates or gaps.                     |
| `timelineId`      | Identifies one authoritative history across creation, restoration, or replacement.          |
| `renderSequence`  | Orders replaceable render snapshots without requiring reliable continuity.                  |
| `eventId`         | Identifies a reliable event independently of its stream position.                           |
| `protocolVersion` | Compatibility of envelope semantics.                                                        |
| `schemaVersion`   | Compatibility of a specific payload or snapshot/read model.                                 |

`socket.id` may be logged as a `connectionId` but must not populate any durable identity field.

### Events, read models, and synchronization

- Domain events describe authoritative facts and remain owned by the simulation.
- Transport event envelopes carry domain events where clients need them. Not every internal event must be public.
- Compact read-model updates are preferred for routine rendering and UI subscriptions.
- A full client read model is used for initial synchronization and recovery. It is not necessarily the simulation's persistence snapshot and does not expose mutable internals.
- Snapshot references may be used later only when payload size or storage architecture proves the need; references must resolve to immutable, versioned content.
- Each reliable stream item carries `gameId`, `timelineId`, `streamOffset`, `simulationTick`, `eventId`, compatibility metadata, and `commandRevision` when command ordering is relevant.
- A client applies reliable updates only when `TimelineId` matches and `StreamOffset` is contiguous. It ignores known duplicates and requests synchronization on a gap.
- A render snapshot carries `TimelineId`, `RenderSnapshotSequence`, and `SimulationTick`. A newer compatible render snapshot may replace missed intermediate snapshots without reliable-stream gap recovery.
- A synchronization response supplies a contiguous delta only when the host can prove it covers the client's last applied `StreamOffset` on the same `TimelineId`. Otherwise it supplies a full current read model and authoritative timeline identity.

Browser refresh, host restart, expired recovery state, and failed Socket.IO recovery all use the same application synchronization operation. Socket.IO connection-state recovery may optimize the path but is never the correctness mechanism.

### Errors

Errors are separated into:

- `protocol_error`: malformed, unsupported, or incompatible envelope/payload;
- `command_rejected`: valid request refused by domain rules, including stale `CommandRevision` as a specific rejection;
- `authorization_error`: unauthenticated or unauthorized operation in a future remote host;
- `transport_error`: timeout, disconnect, host unavailable, or adapter failure where command outcome may be unknown;
- `host_error`: unexpected authoritative-host failure, with no internal details exposed to clients.

Only terminal command results may be treated as applied or rejected. Transport errors never prove that a command was not applied.

### Rooms, namespaces, and scaling

An adapter may map `gameId` to a room for efficient fan-out, but rooms do not appear in protocol or domain contracts. A namespace may separate an operational endpoint if a demonstrated deployment need arises; it must not model a game mode or domain aggregate.

No scaling adapter is selected. Future infrastructure evaluation must verify message propagation, acknowledgement behavior, connection-state-recovery support, failure behavior, ordering assumptions, sticky-session requirements, and operational observability. The classic Redis adapter must not be assumed to support connection-state recovery.

## Consequences and trade-offs

### Benefits

- UI code is independent of Worker and Socket.IO APIs.
- The deterministic simulation remains environment-neutral.
- Idempotency makes acknowledgement timeouts and retries safe.
- `CommandRevision`, `StreamOffset`, and `TimelineId` make stale command expectations, message gaps, and history replacement observable.
- One synchronization operation handles refresh, reconnect, recovery failure, and host restart.
- Local and remote adapters can share contract tests without inventing network failures for a Worker.

### Costs

- A host must retain command outcomes and either event history or a current full read model.
- Envelope metadata and compatibility handling add design and test work.
- Exactly-once effects are achieved at the application boundary through idempotent processing, not supplied by Socket.IO.
- A single client port requires careful separation between common lifecycle states and adapter diagnostics.

## Risks and mitigations

| Risk                                          | Mitigation                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A retry applies a command twice.              | Stable `commandId`, atomic deduplication with application, and stored terminal results.                      |
| An acknowledgement is lost after application. | Retry/query with the same `commandId`; return the stored result.                                             |
| A client silently misses events.              | Monotonic `StreamOffset`, matching `TimelineId`, contiguous application, gap detection, and synchronization. |
| Recovery support is mistaken for correctness. | Always retain full synchronization; treat connection-state recovery as an optimization.                      |
| Socket identities leak into domain state.     | Keep `connectionId` adapter-only and use explicit application identities.                                    |
| Typed events are mistaken for validation.     | Runtime validation at all process/network boundaries.                                                        |
| Read models expose mutable simulation state.  | Serialize immutable client-facing projections rather than sharing engine objects.                            |
| Scaling changes semantics.                    | Capability-test the selected adapter/topology against shared contract and failure tests.                     |
| Event history grows without bound.            | Define retention/compaction with a full-read-model fallback in a later host phase.                           |
| Protocol evolution strands older clients.     | Explicit protocol/schema versions, negotiated compatibility range, and fail-closed incompatibility.          |

## Deferred decisions

- Final domain command and event catalogue.
- Exact runtime schemas and validation library placement.
- Event/result retention duration and persistence implementation.
- Whether remote clients receive domain events, read-model deltas, or both for each use case.
- Authentication, authorization, actor/session lifecycle, and credential transport.
- Hosting provider, server framework, database, scaling adapter, load balancer, and deployment topology.
- Rate limiting, quotas, abuse controls, audit policy, and privacy policy.
- Multiplayer or collaborative gameplay.
- Snapshot transfer size limits, compression, chunking, and reference storage.
- Concrete Worker and Socket.IO adapter implementations.

## Sources

Accessed 2026-07-18. All technical Socket.IO claims above use official Socket.IO 4.x documentation.

- [Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [Emitting events: acknowledgements and timeouts](https://socket.io/docs/v4/emitting-events/)
- [Client options: retries and acknowledgement timeout](https://socket.io/docs/v4/client-options/)
- [Connection-state recovery and adapter compatibility](https://socket.io/docs/v4/connection-state-recovery)
- [Handling disconnections](https://socket.io/docs/v4/tutorial/handling-disconnections)
- [Server API: `socket.id`](https://socket.io/docs/v4/server-api/#socketid)
- [TypeScript event typing and runtime-validation warning](https://socket.io/docs/v4/typescript/)
- [Rooms](https://socket.io/docs/v4/rooms/)
- [Namespaces](https://socket.io/docs/v4/namespaces/)
- [Using multiple nodes](https://socket.io/docs/v4/using-multiple-nodes/)
- [Redis adapter feature compatibility](https://socket.io/docs/v4/redis-adapter/)
