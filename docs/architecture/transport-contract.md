# Transport Contract Design

## Purpose and status

This document proposes the adapter-neutral boundary between the Torrevieja Tycoon web application and an authoritative simulation host. It guides Phase 3 design; it is not production TypeScript and does not finalize game commands or events.

The contract supports two host placements:

- a local simulation hosted in a Web Worker;
- a future remote authoritative host reached through a Socket.IO adapter.

Both expose equivalent command, outcome, observation, and synchronization semantics. They do not pretend to have identical lifecycle details or failure modes.

## Boundaries and ownership

```text
apps/web
  React / R3F / stores
          |
          v
  SimulationClient port
      /           \
 Worker adapter   Socket.IO adapter

packages/protocol
  serializable envelopes, compatibility metadata,
  shared client/host port concepts

packages/simulation
  domain commands and events, authoritative state,
  SimulationTick advancement, deterministic rules, snapshots
```

The host assigns `CommandRevision`; `packages/protocol` defines its validated,
adapter-neutral primitive.

The future remote host is an application adapter around the simulation, not part of the simulation package. Socket.IO types and callbacks must not appear in the app-facing port or shared envelopes.

## Design rules

1. All cross-boundary values are serializable data and runtime-validated at receipt.
2. Commands are the only public mutation path.
3. A command result has application meaning; a transport-level receipt does not.
4. `CommandRevision` orders accepted external commands. `SimulationTick` is game time. `StreamOffset` orders reliable output, while `RenderSnapshotSequence` orders replaceable visual projections. `TimelineId` identifies one authoritative history. These coordinates are not interchangeable.
5. Clients apply only compatible, contiguous authoritative updates.
6. Retries reuse `commandId`; user re-attempts after a domain rejection use a new `commandId`.
7. A full synchronization path is always available, regardless of transport recovery features.
8. Subscriptions return cleanup functions and adapters must not accumulate listeners across reconnects.
9. Public read models are immutable projections, not shared mutable simulation internals.

## App-facing `SimulationClient` port

Documentation-only TypeScript shape:

```ts
interface SimulationClient {
  connect(request: ConnectRequest): Promise<ConnectResult>;
  disconnect(reason?: string): Promise<void>;

  getLifecycle(): ClientLifecycle;
  subscribeLifecycle(listener: (state: ClientLifecycle) => void): Unsubscribe;

  sendCommand<TCommand>(
    envelope: CommandEnvelope<TCommand>,
    options?: CommandSendOptions,
  ): Promise<CommandResultEnvelope>;

  synchronize(
    request: SynchronizationRequest,
  ): Promise<SynchronizationResponse>;

  subscribeMessages(listener: (message: HostMessage) => void): Unsubscribe;
}

type Unsubscribe = () => void;
```

Contract expectations:

- `connect()` resolves only after protocol compatibility is established. The client may still need synchronization before becoming `ready`.
- `sendCommand()` resolves only with a terminal application result. It rejects with a transport failure when the outcome is unknown.
- `disconnect()` is idempotent and prevents new messages after completion.
- Unsubscribe functions are idempotent. Disconnecting releases adapter resources and listeners.
- Message listener ordering matches the order accepted by the client adapter. Consumers still verify `TimelineId`, `StreamOffset`, and `CommandRevision`.
- An adapter may expose separate diagnostic data, but UI/domain code must not branch on Socket.IO or Worker APIs.

## Lifecycle model

```ts
type ClientLifecycle =
  | { state: 'idle' }
  | { state: 'connecting'; attempt: number }
  | { state: 'synchronizing'; reason: SynchronizationReason }
  | {
      state: 'ready';
      timelineId: TimelineId;
      commandRevision: CommandRevision;
      simulationTick: SimulationTick;
      streamOffset: StreamOffset;
    }
  | {
      state: 'degraded';
      timelineId?: TimelineId;
      commandRevision?: CommandRevision;
      simulationTick?: SimulationTick;
      streamOffset?: StreamOffset;
      reason: DegradedReason;
    }
  | { state: 'disconnected'; retryable: boolean; reason?: string }
  | { state: 'failed'; retryable: boolean; error: TransportError }
  | { state: 'closed' };
```

Common lifecycle states describe what the application can safely do. Adapter diagnostics remain distinct:

```ts
type AdapterDiagnostics =
  | {
      adapter: 'worker';
      workerState: 'starting' | 'running' | 'crashed' | 'terminated';
    }
  | {
      adapter: 'socket-io';
      connectionState: 'connecting' | 'connected' | 'reconnecting' | 'offline';
      recovery: 'not_attempted' | 'succeeded' | 'failed';
      connectionId?: string;
    };
```

A Worker adapter need not simulate packet loss or reconnection attempts. It must still handle worker startup, crash, termination, malformed messages, and synchronization after host recreation. A Socket.IO adapter handles network reachability, reconnect attempts, acknowledgement timeouts, and connection-state recovery.

## Compatibility metadata

Every top-level message carries explicit compatibility information:

```ts
interface Compatibility {
  protocolVersion: number;
  minimumProtocolVersion: number;
  messageSchema: string;
  messageSchemaVersion: number;
  simulationVersion?: string;
}
```

- `protocolVersion` identifies envelope semantics.
- `minimumProtocolVersion` enables an explicit compatible range; compatibility must not be inferred from Socket.IO client/server version compatibility.
- `messageSchema` identifies the payload family, such as `command-result` or `client-read-model`.
- `messageSchemaVersion` versions that family independently.
- `simulationVersion` identifies snapshot/replay compatibility when relevant, not transport compatibility.

An unsupported protocol fails before commands are accepted. A known protocol with an unsupported payload schema returns a protocol error. Unknown fields may be tolerated only when a documented compatibility rule permits them; unknown required variants fail closed.

## Common identifiers

Documentation examples use opaque string types:

```ts
type GameId = string;
type CommandId = string;
type EventId = string;
type CorrelationId = string;
type CausationId = string;
type ClientId = string;
type SessionId = string;
type TimelineId = string;
type CommandRevision = number;
type SimulationTick = number;
type StreamOffset = number;
type RenderSnapshotSequence = number;
```

Values must eventually be runtime-validated. `CommandRevision`, `SimulationTick`, `StreamOffset`, and `RenderSnapshotSequence` are distinct non-negative integers. `CommandRevision` and `StreamOffset` are monotonic within their documented scopes; `RenderSnapshotSequence` orders replaceable projections and does not imply reliable-stream continuity.

`connectionId` is deliberately absent from domain envelopes. An adapter may attach it to diagnostics and logs only.

## Command envelope

```ts
interface CommandEnvelope<TCommand> {
  kind: 'command';
  compatibility: Compatibility;
  gameId: GameId;
  timelineId: TimelineId;
  commandId: CommandId;
  correlationId: CorrelationId;
  causationId?: CausationId;
  clientId: ClientId;
  sessionId: SessionId;
  expectedCommandRevision?: CommandRevision;
  sentAt?: string;
  command: TCommand;
}
```

`sentAt` is diagnostic and never determines simulation outcomes. A deliberately trivial example payload might be `{ type: 'foundation.ping' }`; it does not establish a production command.

The authoritative host processing order is:

1. validate protocol and envelope;
2. authenticate/authorize in a future remote host;
3. find an existing `(gameId, commandId)` result;
4. reject conflicting reuse of a command ID;
5. compare `expectedCommandRevision` when supplied;
6. validate the domain command;
7. apply it atomically with idempotency recording;
8. assign the resulting `CommandRevision` and terminal result;
9. publish resulting events/read-model updates.

Steps 7 and 8 must not allow a crash window that can apply the command again without finding its recorded outcome. The concrete transaction/persistence mechanism is deferred.

## Command result envelope

```ts
type CommandResultEnvelope =
  | {
      kind: 'command-result';
      compatibility: Compatibility;
      gameId: GameId;
      commandId: CommandId;
      correlationId: CorrelationId;
      status: 'applied';
      appliedCommandRevision: CommandRevision;
      simulationTick: SimulationTick;
      duplicate: boolean;
    }
  | {
      kind: 'command-result';
      compatibility: Compatibility;
      gameId: GameId;
      commandId: CommandId;
      correlationId: CorrelationId;
      status: 'rejected';
      currentCommandRevision: CommandRevision;
      rejection: CommandRejection;
      duplicate: boolean;
    };
```

An `applied` result proves exact-once application for that command ID and names the resulting `CommandRevision`. It does not prove that any subscriber has processed the associated update.

A `rejected` result is also terminal and is stored for duplicate handling. Rejection does not advance `CommandRevision`. `duplicate: true` means the stored original result was returned.

```ts
type CommandRejection =
  | { code: 'invalid_command'; message: string; details?: unknown }
  | {
      code: 'stale_command_revision';
      expectedCommandRevision: CommandRevision;
      currentCommandRevision: CommandRevision;
    }
  | { code: 'rule_violation'; rule: string; message: string };
```

Messages must not expose stack traces or internal host details.

## Event envelope

```ts
interface EventEnvelope<TEvent> {
  kind: 'domain-event';
  compatibility: Compatibility;
  gameId: GameId;
  timelineId: TimelineId;
  eventId: EventId;
  streamOffset: StreamOffset;
  commandRevision: CommandRevision;
  simulationTick: SimulationTick;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  event: TEvent;
}
```

- `timelineId` identifies the authoritative history.
- `streamOffset` establishes contiguous observation order for the client-visible reliable stream.
- Multiple events may share a `CommandRevision` when one command produces several facts; their `StreamOffset` values remain distinct.
- Events with an already applied `eventId` or `StreamOffset` are duplicates and are ignored after compatibility checks.
- A `StreamOffset` greater than `lastAppliedStreamOffset + 1` is a gap. The client pauses incremental application and synchronizes.
- An event with a `CommandRevision` older than the current full read model is stale unless the synchronization protocol explicitly identifies it as replay metadata.

A trivial example such as `{ type: 'foundation.pong' }` illustrates serialization only and does not define the future domain catalogue.

## Read-model envelopes

Routine rendering should consume compact immutable projections:

```ts
interface ReadModelUpdateEnvelope<TUpdate> {
  kind: 'read-model-update';
  compatibility: Compatibility;
  gameId: GameId;
  timelineId: TimelineId;
  updateId: string;
  streamOffset: StreamOffset;
  commandRevision: CommandRevision;
  simulationTick: SimulationTick;
  update: TUpdate;
}

interface FullReadModelEnvelope<TReadModel> {
  kind: 'full-read-model';
  compatibility: Compatibility;
  gameId: GameId;
  timelineId: TimelineId;
  commandRevision: CommandRevision;
  simulationTick: SimulationTick;
  lastIncludedStreamOffset: StreamOffset;
  readModelSchemaVersion: number;
  readModel: TReadModel;
}

interface RenderSnapshotEnvelope<TRenderSnapshot> {
  kind: 'render-snapshot';
  compatibility: Compatibility;
  gameId: GameId;
  timelineId: TimelineId;
  sequence: RenderSnapshotSequence;
  commandRevision: CommandRevision;
  simulationTick: SimulationTick;
  snapshot: TRenderSnapshot;
}
```

Render snapshots are replaceable projections. A gap in
`RenderSnapshotSequence` neither proves a reliable-stream gap nor triggers
reliable-stream recovery. A projection from a different `TimelineId` must not
be merged into the current projection.

A full read model is the client's synchronization baseline. It may be derived from a simulation snapshot but is not required to be the persistence snapshot. The simulation's internal state must not become mutable client state.

Snapshot references are deferred. If later introduced, a reference must include immutable content identity, schema/version metadata, integrity metadata, expiry behavior, and an in-band fallback strategy.

## Synchronization

```ts
type SynchronizationReason =
  | 'initial_connect'
  | 'browser_refresh'
  | 'event_gap'
  | 'stale_command_revision'
  | 'recovery_failed'
  | 'host_restarted'
  | 'manual';

interface SynchronizationRequest {
  kind: 'synchronization-request';
  compatibility: Compatibility;
  gameId: GameId;
  clientId: ClientId;
  sessionId: SessionId;
  reason: SynchronizationReason;
  timelineId?: TimelineId;
  lastAppliedCommandRevision?: CommandRevision;
  lastAppliedStreamOffset?: StreamOffset;
  acceptedReadModelSchemaVersions: number[];
}

type SynchronizationResponse<TReadModel, TMessage> =
  | {
      kind: 'synchronization-response';
      compatibility: Compatibility;
      gameId: GameId;
      timelineId: TimelineId;
      mode: 'delta';
      fromExclusiveStreamOffset: StreamOffset;
      throughStreamOffset: StreamOffset;
      throughCommandRevision: CommandRevision;
      messages: TMessage[];
    }
  | {
      kind: 'synchronization-response';
      compatibility: Compatibility;
      gameId: GameId;
      mode: 'full';
      baseline: FullReadModelEnvelope<TReadModel>;
      reason:
        'no_baseline' | 'history_expired' | 'host_restarted' | 'client_ahead';
    };
```

The host returns `delta` only when it retains a complete contiguous sequence after the client's `StreamOffset`, the request has the same `TimelineId`, and the client's baseline/schema is compatible. Otherwise it returns `full`.

Client application of a synchronization response is atomic from the UI's perspective:

1. enter `synchronizing` and pause normal update application;
2. validate compatibility, identity, bounds, and contiguity;
3. replace the baseline or apply the full delta in order;
4. set the resulting `CommandRevision`, `SimulationTick`, and `StreamOffset`;
5. process buffered messages only if they continue contiguously;
6. enter `ready`, or request a new full synchronization if validation fails.

## Host messages

```ts
type HostMessage =
  | CommandResultEnvelope
  | EventEnvelope<unknown>
  | ReadModelUpdateEnvelope<unknown>
  | FullReadModelEnvelope<unknown>
  | RenderSnapshotEnvelope<unknown>
  | ProtocolErrorEnvelope
  | HostNoticeEnvelope;
```

`unknown` here means that the generic catalogue is not designed in Phase 2. Runtime code must use validated discriminated payloads, not pass unchecked `unknown` to consumers.

## Error categories

```ts
interface ProtocolErrorEnvelope {
  kind: 'protocol-error';
  compatibility: Compatibility;
  code:
    | 'malformed_message'
    | 'unsupported_protocol'
    | 'unsupported_schema'
    | 'identity_mismatch'
    | 'command_id_conflict';
  retryable: false;
  correlationId?: CorrelationId;
  message: string;
}

interface TransportError {
  category: 'transport';
  code: 'timeout' | 'disconnected' | 'unavailable' | 'adapter_failure';
  retryable: boolean;
  outcome: 'not_sent' | 'unknown';
  message: string;
}

interface AuthorizationError {
  category: 'authorization';
  code: 'unauthenticated' | 'forbidden' | 'session_expired';
  retryable: boolean;
  message: string;
}

interface HostError {
  category: 'host';
  code: 'unexpected_failure' | 'game_unavailable';
  retryable: boolean;
  incidentId?: string;
  message: string;
}
```

An acknowledgement timeout after send has `outcome: 'unknown'`. The client may retry only with the same command ID or query/synchronize. It must not create a new command ID automatically.

## Subscription and cleanup semantics

- Register long-lived adapter listeners once, outside reconnect callbacks.
- Each `subscribe...` call returns its own idempotent `Unsubscribe` function.
- A listener removed during dispatch receives no later message; whether it receives the current dispatch must be specified and tested in implementation.
- `disconnect()` removes transport listeners, rejects or resolves pending operations according to their known outcome, and transitions to `closed` when explicitly disposed.
- Reconnect must not duplicate subscriptions or replay already-applied messages without duplicate markers/identifiers.
- Listener exceptions are isolated from adapter state and reported through application diagnostics.
- Contract tests should run against an in-memory adapter, Worker adapter, and future Socket.IO adapter. Adapter-specific suites additionally cover their unique failures.

## Rooms and namespaces

Rooms and namespaces are not represented in this contract. A future Socket.IO server adapter may:

- map a validated `gameId` to an internal room for fan-out;
- use a namespace to separate an operational endpoint only when deployment needs justify it.

Clients request access to a game through application protocol semantics. They do not join arbitrary rooms or derive authorization from room membership.

## Failure-mode matrix

“Full sync?” means whether a full read-model synchronization is always required. “Conditional” permits a proven contiguous delta.

| Failure mode                                       | Detection                                                                                                             | Authoritative response                                                                            | Client response                                                                                                                              | Full sync?                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Temporary network loss                             | Adapter disconnect/lifecycle event; command promise may time out.                                                     | Preserve authoritative state and idempotency results; attempt transport recovery where supported. | Enter `degraded`/`disconnected`; stop assuming freshness; reconnect, then synchronize unless application continuity is proven.               | Conditional                                          |
| Browser tab refresh                                | New application session has no live transport state; persisted baseline may be present.                               | Treat as a new connection; validate logical session independently of `socket.id`.                 | Connect and send the last trusted `TimelineId` and `StreamOffset` if retained; otherwise request a full baseline.                            | Conditional                                          |
| Duplicate command delivery                         | Existing `(gameId, commandId)` record with equivalent command fingerprint.                                            | Return the stored terminal result with `duplicate: true`; do not reapply.                         | Accept the result and reconcile to its `CommandRevision`.                                                                                    | No, unless client state has a gap                    |
| Acknowledgement timeout after host applied command | Transport timeout gives unknown outcome; retry finds stored command result.                                           | On same-ID retry/query, return original applied result.                                           | Never invent a new ID automatically; retry with the same ID, then synchronize if the resulting `CommandRevision` or update is missing.       | Conditional                                          |
| Out-of-order or duplicated event observation       | `StreamOffset` lower than or equal to the applied value is a duplicate; higher than the next expected value is a gap. | Continue authoritative order; answer synchronization request.                                     | Ignore known duplicates; buffer only within bounded policy; pause and synchronize on unresolved ordering.                                    | Conditional                                          |
| Missed event gap                                   | Incoming `StreamOffset` is greater than `lastAppliedStreamOffset + 1`.                                                | Return complete delta if retained, otherwise current full read model.                             | Stop incremental application and request synchronization.                                                                                    | Conditional                                          |
| Stale expected command revision                    | Command `expectedCommandRevision` differs from the current `CommandRevision`.                                         | Return terminal `stale_command_revision`; do not apply or advance `CommandRevision`.              | Synchronize, show/reconcile changed state, and require deliberate resubmission with a new command ID if intent remains valid.                | Conditional                                          |
| Incompatible protocol version                      | Handshake/envelope compatibility validation fails.                                                                    | Reject connection/message before command processing with supported range.                         | Stop automatic command retries; require compatible client update.                                                                            | Not applicable                                       |
| Host restart                                       | Host instance/recovery state is lost, or synchronization reports restart/history loss.                                | Restore authoritative state and establish its `TimelineId`; invalidate unavailable delta history. | Discard unproven incremental assumptions and request synchronization. Resolve pending commands by command ID when result retention survives. | Usually yes                                          |
| Failed connection-state recovery                   | Socket.IO reports `recovered === false`, session expired, or adapter lacks support.                                   | Accept normal synchronization request; do not infer client position.                              | Use application synchronization rather than treating reconnect as continuity.                                                                | Conditional                                          |
| Client behind reliable stream                      | Client reports a lower `StreamOffset` on the same `TimelineId`.                                                       | Supply a contiguous delta when available and compatible, otherwise a full baseline.               | Apply verified delta or atomically replace baseline.                                                                                         | Conditional                                          |
| Client ahead or wrong timeline                     | Client `StreamOffset` is greater than the host value, or `TimelineId` differs.                                        | Reject delta assumption and return current full baseline plus diagnostic reason.                  | Verify game identity, discard local authoritative projection, and replace from host; surface serious consistency diagnostics.                | Yes                                                  |
| Worker crash or termination                        | Worker error/message error/termination; pending operations lose channel.                                              | Recreated local host restores only through the defined host restoration policy.                   | Enter `failed`; recreate host when allowed and synchronize. Do not mimic network retries.                                                    | Usually yes                                          |
| Malformed or schema-invalid message                | Runtime validation fails at receiving boundary.                                                                       | Reject without domain execution; log correlation/incident data safely.                            | Do not apply; transition to failed or synchronize depending on severity.                                                                     | No for isolated request; yes if stream trust is lost |

## Testing implications for later phases

Phase 3 should turn these documented semantics into executable contract tests before platform adapters are considered complete. Tests should cover:

- terminal acknowledgement meaning;
- same-ID duplicate replay and conflicting ID reuse;
- stale `CommandRevision` rejection;
- contiguous update application and gap detection;
- delta versus full synchronization;
- protocol/schema incompatibility;
- idempotent subscription cleanup;
- adapter lifecycle mapping;
- a timeout where application outcome remains unknown.

The Worker adapter and future Socket.IO adapter share these tests. Network-specific recovery/retry tests apply only to Socket.IO; worker crash/recreation tests apply only to Worker hosting.

## Deferred details

- Concrete exported TypeScript and Zod schemas.
- Final command/event/read-model catalogues.
- Storage and transactional mechanism for idempotency records and event history.
- Authentication, authorization, session issuance, and actor identity.
- Retention, compaction, rate limits, payload limits, compression, and snapshot references.
- Server application, deployment topology, Socket.IO options, rooms/namespaces mapping, and scaling adapter.
