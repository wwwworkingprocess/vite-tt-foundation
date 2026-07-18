# Package and Dependency Boundaries

## Intended workspace

```text
apps/web
packages/simulation
packages/protocol
```

Additional packages may be introduced later only when they represent a proven boundary rather than convenience-driven fragmentation.

## Dependency direction

```text
apps/web
  ├── may depend on packages/simulation
  └── may depend on packages/protocol

packages/simulation
  └── may depend on packages/protocol only when the shared contract genuinely belongs there

packages/protocol
  └── must remain independent of apps/web and packages/simulation implementation details
```

No package may import from `apps/web`.

## `packages/simulation`

### Owns

- authoritative domain model;
- simulation engine and clock semantics;
- commands and command validation related to game rules;
- domain events;
- deterministic random state;
- rulesets and scenarios as pure data/contracts;
- authoritative selectors and metrics;
- snapshot creation, validation, supported migration, and restoration.

### Must not own

- React components or hooks;
- Three.js objects or world coordinates used only for rendering;
- Zustand stores;
- Dexie tables or IndexedDB calls;
- service workers or PWA lifecycle;
- socket clients, HTTP clients, or browser messaging APIs;
- filesystem or database storage policy;
- UI notifications, camera state, hover state, or open panels.

## `packages/protocol`

### Owns

- serializable command and event envelopes shared across process boundaries;
- stable identifiers and revision/tick metadata needed by transports;
- transport-neutral client/host interfaces;
- snapshot transfer contracts where sharing is necessary;
- runtime validation schemas for wire data when appropriate.

### Must not own

- Socket.IO-specific socket objects or event registration;
- Web Worker globals or `postMessage` calls;
- UI behaviour;
- simulation-system implementations;
- persistence implementations.

Socket.IO and Worker code are adapters that implement protocol contracts.

## `apps/web`

### Owns

- Vite application bootstrap;
- React DOM interface;
- React Three Fiber scene and interpolation;
- Zustand application and presentation stores;
- Dexie persistence adapter;
- PWA manifest, service worker integration, update UI, and offline shell;
- worker creation and worker transport adapter;
- future Socket.IO client adapter;
- browser-specific configuration and accessibility behaviour.

### Must not own

- authoritative transport rules;
- passenger, vehicle, finance, or objective outcomes;
- simulation advancement in `requestAnimationFrame` or R3F `useFrame`;
- hidden mutations of simulation snapshots;
- duplicate domain rules for UI convenience.

## Adapter model

Host integrations should be expressed through interfaces. Examples:

```ts
interface SaveRepository {
  save(slotId: string, snapshot: SimulationSnapshot): Promise<void>;
  load(slotId: string): Promise<SimulationSnapshot | undefined>;
  delete(slotId: string): Promise<void>;
}

interface SimulationTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: CommandEnvelope): Promise<void>;
  subscribe(listener: (message: HostMessage) => void): () => void;
}
```

The precise interfaces will be designed in their implementation phases. These examples establish ownership, not final APIs.

## Rendering boundary

The simulation publishes logical information such as:

```text
vehicle X is 42% along edge A → B
```

The scene converts this into representation data such as:

```text
world position, orientation, animation, mesh, label, and camera framing
```

Scene interpolation is visual only. It cannot become authoritative movement.

## Enforcement

Phase 1 should establish import-boundary enforcement where practical through TypeScript project references, package exports, and lint rules. Tests should prove that the simulation package can build independently of the web application.
