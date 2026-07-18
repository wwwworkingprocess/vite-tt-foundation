# Dedicated Web Worker Adapter Model

## Status

Implemented architecture contract for Phase 3C.

Phase 3C places the accepted Phase 3B in-memory authoritative host inside
a dedicated Web Worker and exposes it through the same application-facing
foundation client semantics as a direct local client.

This phase proves a process boundary. It does not add a simulation
scheduler, persistence, game mechanics, or networking.

## Architecture

```text
React/application bootstrap
          |
          v
 FoundationSimulationClient
       /             \
direct adapter     Worker adapter
      |                 |
in-memory host      typed Worker messages
                        |
                        v
                 Worker host runtime
                        |
                        v
                 in-memory host
                        |
                        v
               simulation package
```

The direct adapter is a reference implementation and test oracle.
Production browser hosting uses the Worker adapter.

## Ownership

`packages/simulation` continues to own deterministic foundation state,
foundation command validation/application, and `SimulationTick`.

`packages/protocol` owns foundation command/result/update/synchronization
contracts, validated identifiers and position primitives, and the
adapter-neutral foundation client port/lifecycle when shared by both
adapters.

`apps/web/src/simulation-host` owns the existing in-memory host, a direct
client adapter, and application-facing deep-freezing after process
boundaries.

`apps/web/src/simulation-worker` owns dedicated Worker creation,
Worker-specific message wrappers, request correlation, validation at both
ends, the Worker runtime, failure mapping, termination, and cleanup.

Worker-specific APIs must not enter `packages/simulation`.

## Shared application-facing client

Phase 3C establishes one narrow port implemented by both adapters:

```ts
interface FoundationSimulationClient {
  connect(request: FoundationClientConnectRequest): Promise<void>;
  sendCommand(
    envelope: FoundationCommandEnvelope,
  ): Promise<FoundationCommandResult>;
  synchronize(
    request: FoundationSynchronizationRequest,
  ): Promise<FoundationSynchronizationResponse>;
  subscribeReliableUpdates(
    listener: (update: FoundationStateUpdate) => void,
  ): Unsubscribe;
  subscribeRenderSnapshots(
    listener: (snapshot: FoundationRenderSnapshot) => void,
  ): Unsubscribe;
  getLifecycle(): FoundationClientLifecycle;
  subscribeLifecycle(
    listener: (state: FoundationClientLifecycle) => void,
  ): Unsubscribe;
  close(): Promise<void>;
}
```

Concrete names may vary, but both adapters must pass one shared suite.

## Minimal lifecycle

```ts
type FoundationClientLifecycle =
  | { readonly state: 'idle' }
  | { readonly state: 'connecting' }
  | {
      readonly state: 'ready';
      readonly gameId: GameId;
      readonly timelineId: TimelineId;
    }
  | {
      readonly state: 'failed';
      readonly code:
        | 'worker-startup-failed'
        | 'worker-crashed'
        | 'message-error'
        | 'invalid-worker-message';
      readonly message: string;
    }
  | { readonly state: 'closed' };
```

Rules:

- `connect()` is valid only from `idle`;
- commands and synchronization require `ready`;
- `close()` is idempotent;
- after `closed`, no operations are accepted;
- terminal Worker failure rejects pending operations and enters `failed`;
- no automatic restart or retry is implemented.

## Initialization

The application injects durable identity and initial state data:

```ts
interface FoundationClientConnectRequest {
  readonly gameId: GameId;
  readonly timelineId: TimelineId;
  readonly initialSimulationTick: SimulationTick;
}
```

The Worker creates the foundation state and host internally. It never
generates `gameId`, `timelineId`, or command IDs.

## Worker request correlation

Worker requests use an ephemeral adapter-local key:

```ts
type WorkerRequestId = number;
```

The client assigns positive safe integers beginning at one.

A Worker request ID is not persisted, is not a command idempotency key,
does not enter simulation/domain state, and may reset with a new client.

## Wire messages

All Worker messages are strict, runtime-validated, JSON-safe data.

Client to Worker:

```text
initialize
send-command
synchronize
close
```

Worker to client:

```text
operation-result
reliable-update
render-snapshot
worker-failure
```

Command results settle the matching command promise only. They are not
emitted through general subscriptions.

Malformed data must never reach the host unchecked.

## Structured clone boundary

`postMessage` structured cloning does not preserve runtime
`Object.freeze()` status.

The receiver must therefore:

1. runtime-validate each message;
2. construct only documented public projections;
3. deeply freeze nested values before resolving or publishing them.

The Worker runtime also validates cloned requests before passing them to
the host.

Tests must prove that mutable clones cannot corrupt retained host state or
later duplicate/synchronization results.

## Ordering

The Phase 3B host remains the authoritative ordering source.

The Worker runtime registers host subscriptions before reporting ready.

For accepted command N, clients observe:

```text
reliable update N
render snapshot N
```

before publications from a later command.

Reliable updates use contiguous `StreamOffset`. Render snapshots remain
replaceable and separately sequenced.

## Pending operations

The Worker client maintains pending request promises.

Required behavior:

- a response settles exactly its matching request;
- unknown/duplicate request IDs do not settle unrelated requests;
- close rejects all unresolved requests;
- both adapters reject unresolved public operations as soon as close begins;
- each pending Worker request records its expected operation, and a response
  is accepted only when its result shape matches that operation;
- Worker error or `messageerror` rejects all unresolved requests;
- malformed incoming messages cannot leave promises silently pending;
- one rejected request does not poison later requests while ready.

No timeout policy is added in Phase 3C.

## Subscriptions and cleanup

Preserve Phase 3B semantics:

- each registration is independent;
- cleanup is idempotent;
- listener failures do not block other listeners;
- diagnostic failures do not affect delivery;
- no messages are delivered after close;
- Worker listeners are installed once and removed on close.
- subscriptions may be registered independently before connect;
- Worker-runtime close detaches its endpoint listener, releases the host, and
  permits no later request or publication.

## Direct adapter

The direct adapter wraps the existing in-memory host behind the same
client port. It is not a second simulation implementation.

It supports shared testing, debugging, and future headless tools.

## Testing layers

### Shared client contract suite

Run the same suite against:

- direct client;
- Worker client with a deterministic structured-clone loopback Worker
  test double.

Cover lifecycle, command outcomes, FIFO publication, synchronization,
subscriptions, close, and deep immutability after clone.

### Worker-specific tests

Cover request correlation, malformed messages, unknown IDs, startup
failure, crash, `messageerror`, pending rejection, and listener cleanup.

### Actual-browser smoke

Cypress must exercise a real Vite-created dedicated Worker and verify:

1. initialization reaches ready;
2. one command applies;
3. the resulting tick/update reaches the application;
4. no fatal page/Worker error occurs;
5. cleanup terminates the Worker.

A minimal foundation status surface is allowed. No gameplay UI is added.

## Deferred work

- automatic Worker restart;
- reconnect/degraded lifecycle;
- simulation pacing scheduler;
- browser timers and accumulators;
- Dexie persistence;
- Zustand bridge;
- Socket.IO;
- game commands and route data;
- R3F simulation visualization;
- production telemetry;
- transferables, compression, binary protocols, or batching.
