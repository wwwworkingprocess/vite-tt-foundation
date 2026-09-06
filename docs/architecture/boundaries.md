# Package and Dependency Boundaries

**Document status:** Current architecture contract

## Workspace

```text
apps/web
packages/protocol
packages/transport-domain
packages/simulation
```

New packages are introduced only for a proven ownership or deployment boundary,
not convenience-driven fragmentation.

## Dependency direction

```text
apps/web ───────────────► packages/simulation
   │                              │
   ├────────► packages/protocol   └────────► packages/transport-domain
   └────────► packages/transport-domain

packages/protocol          independent of simulation/web implementation
packages/transport-domain  independent of protocol/simulation/web adapters
```

Concrete current rules:

- `apps/web` may depend on all three packages through public package exports.
- `packages/simulation` may depend on `packages/transport-domain` for canonical
  scenario and graph authority.
- `packages/simulation` does not depend on `packages/protocol`.
- `packages/protocol` and `packages/transport-domain` do not depend on each
  other or on application/simulation implementation details.
- No package may import from `apps/web`.
- Cross-package source-path imports are forbidden; use package exports.

## `packages/transport-domain`

### Owns

- strict environment-neutral scenario DTO schemas;
- cross-file package validation;
- canonical immutable settlements, StopNodes, StopPlaces, routes, and patterns;
- deterministic directed-graph construction and queries;
- population-grid and StopPlace-catchment domain values.

### Must not own

- browser fetching or URL construction;
- asset hashing or PWA policy;
- simulation ticks, vehicles, passengers, saves, or Workers;
- React, rendering, persistence, DOM, Node filesystem, or network adapters.

## `packages/simulation`

### Owns

- authoritative transport state and deterministic tick advancement;
- simulation commands and rule validation;
- scenario-bound graph authority after canonical input is supplied;
- vehicle movement, route cycles, run/call identity, passenger demand and
  journeys;
- authoritative selectors, bounded current events, and conservation;
- snapshot creation, validation, current compatibility, and restoration.

### Must not own

- scenario fetching, asset hashing, or catalogue UI;
- React components or hooks;
- Three.js objects or display-only world coordinates;
- Zustand stores;
- Dexie tables or IndexedDB calls;
- service workers or PWA lifecycle;
- Worker globals, socket clients, HTTP clients, or browser messaging APIs;
- filesystem/database storage policy;
- UI notifications, camera state, hover state, or open panels.

## `packages/protocol`

### Owns

- adapter-neutral foundation commands, results, envelopes, identifiers, and
  synchronization coordinates;
- transport-neutral foundation client/host interfaces;
- runtime validators for shared foundation wire data.

### Must not own

- transport-domain scenario data;
- transport simulation implementations;
- Socket.IO-specific objects;
- Web Worker globals or `postMessage` calls;
- UI behavior or persistence implementations.

Domain-specific transport client/save/Worker contracts currently live under
`apps/web/src/transport-simulation`; the generic protocol package remains
scenario-neutral.

## `apps/web`

### Owns

- Vite/PWA bootstrap and browser configuration;
- React DOM, SVG, and React Three Fiber representation;
- scenario catalogue acquisition, base-aware URLs, and asset integrity hashing;
- direct/Worker application adapters and transport-specific web contracts;
- Zustand application and presentation projections;
- Dexie persistence adapters;
- browser pacing and visibility/lifecycle integration;
- PWA manifest, service worker, update UI, and offline shell;
- accessibility and browser-specific behavior.

### Must not own

- authoritative vehicle, passenger, finance, service, or objective outcomes;
- simulation advancement in `requestAnimationFrame` or R3F `useFrame`;
- hidden mutation of simulation snapshots;
- duplicate domain rules for UI convenience;
- route-code/city-specific exceptions that compensate for malformed scenario
  modeling.

## Adapter model

Current host/client/repository interfaces are defined in production source and
covered by direct, structured-clone, Worker, persistence, and lifecycle tests.
Historical illustrative interfaces in Phase 2/3 documents are not current API
signatures.

The durable adapter rules are:

- the simulation owns snapshot semantics, not storage;
- adapters validate at process/storage boundaries;
- direct and Worker paths are semantically equivalent;
- one rejected request does not poison later queued work while ready;
- close is live, terminal, idempotent, and cleans pending work;
- restore preflight succeeds before current authority teardown.

## Rendering boundary

The simulation publishes logical information such as an exact edge identity and
integer progress/travel values. Representation converts that authority into
world position, orientation, interpolation, meshes, labels, and camera framing.

Representation family, view, and mode are orthogonal application concepts.
Family names renderer/materialization technology (`dom2d`, `canvas2d`, `d3d`),
view names an application capability (`map`, `main`), and mode names slot
presentation (`normal`, `mini`). One pure capability boundary owns the current
supported pairs and defaults:

| Family    | Map | Main | Default |
| --------- | --- | ---- | ------- |
| DOM 2D    | yes | no   | Map     |
| Canvas 2D | yes | no   | Map     |
| D3D       | no  | yes  | Main    |

Primary, mini, and inactive placement do not grant capabilities. Swapping a
family changes its slot and mode, not its view. Renderer materialization remains
explicit rather than becoming a plugin registry or generic renderer factory.

`apps/web/src/representation/transport-map-projection.ts` is the pure shared
2D transport projection boundary. It converts canonical scenario topology and
authoritative Vehicle positions into immutable normalized west-to-east,
north-to-south Map coordinates. It owns no React, DOM, SVG, Canvas, Three.js,
interaction, cadence, population, or passenger-diagnostic materialization.
DOM2D and Canvas2D independently materialize that projection in their own
coordinate spaces.

Scene interpolation is visual only. It cannot become authoritative movement.

## Enforcement

TypeScript project references/package exports, ESLint restrictions, and the
architecture audit enforce the dependency graph. Run:

```sh
yarn audit:architecture
yarn build:libraries
```

The standalone packages must build without `apps/web`.
