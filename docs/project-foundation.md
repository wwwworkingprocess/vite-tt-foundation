# Torrevieja Tycoon — Project Foundation

**Document status:** Current core documentation index

## Purpose

Torrevieja Tycoon is a browser-based transport-management game built around a
standalone deterministic simulation and replaceable clients/adapters.

The first client is an offline-capable browser PWA built with Vite, React, SVG,
and React Three Fiber. The browser displays immutable authority, sends commands,
and owns platform integration. It is not the source of truth for game outcomes.

## Workspace

```text
torrevieja-tycoon/
├── apps/
│   └── web/                  # Browser/PWA adapters and representation
├── packages/
│   ├── protocol/             # Adapter-neutral foundation contracts
│   ├── transport-domain/     # Canonical scenario parsing and graph
│   └── simulation/           # Deterministic authoritative simulation
└── docs/
```

See [`current-state.md`](current-state.md) for the exact current package graph,
versions, scenario catalogue, distribution policy, and next product milestone.

## Core architectural statement

> The web application is a client of the simulation library. It displays
> simulation output, sends commands, and provides platform adapters. It is not
> the source of truth for game outcomes.

The simulation can run in Node.js, Vitest, a browser main thread, a Web Worker,
a future server, or a command-line balancing tool without React, Three.js, the
DOM, IndexedDB, or networking.

## Documentation status model

The repository intentionally preserves historical phase records. Read them
according to their status:

1. **Current contract** — must match HEAD and uses present tense.
2. **Accepted ADR** — preserves a decision; later versions may supersede only
   parts of its consequences.
3. **Historical phase contract/prompt** — preserves the original milestone
   scope and non-goals; “deferred” statements apply to that phase only.
4. **Foundation Template reference** — applies to the domain-free reusable
   snapshot, not current product HEAD.

When a historical document disagrees with [`current-state.md`](current-state.md)
about current versions or implemented features, the current-state ledger wins.

## Core documentation

### Read for every task

- [`current-state.md`](current-state.md) — current product and architecture facts.
- [`architecture/principles.md`](architecture/principles.md) — durable design constraints.
- [`architecture/boundaries.md`](architecture/boundaries.md) — current package dependencies and adapter ownership.
- [`architecture/state-ownership.md`](architecture/state-ownership.md) — authoritative, application, and presentation state.
- [`development/roadmap.md`](development/roadmap.md) — implemented sequence and current direction.
- [`development/testing-strategy.md`](development/testing-strategy.md) — TDD, determinism, coverage, and test layers.
- [`development/definition-of-done.md`](development/definition-of-done.md) — completion and validation rules.

### Current and foundational architecture

- [`architecture/time-model.md`](architecture/time-model.md) — current whole-tick time model.
- [`architecture/browser-pacing-model.md`](architecture/browser-pacing-model.md) — implemented browser pacing boundary.
- [`architecture/foundation-host-model.md`](architecture/foundation-host-model.md) — in-memory host baseline and invariants.
- [`architecture/worker-adapter-model.md`](architecture/worker-adapter-model.md) — direct/Worker adapter baseline.
- [`architecture/persistence-and-app-bridge.md`](architecture/persistence-and-app-bridge.md) — persistence/application baseline.
- [`architecture/transport-contract.md`](architecture/transport-contract.md) — historical Phase 2 transport design that informed current adapters.

### Phase 4 historical authority baselines

These files preserve the named phase decision and contain prominent current
contract notes:

- [`architecture/scenario-packages-and-directed-graph.md`](architecture/scenario-packages-and-directed-graph.md) — Phase 4A.
- [`architecture/transport-simulation-authority.md`](architecture/transport-simulation-authority.md) — Phase 4B.
- [`architecture/vehicle-movement-authority.md`](architecture/vehicle-movement-authority.md) — Phase 4C.

### Architecture decision records

- [`architecture/decisions/README.md`](architecture/decisions/README.md) — ADR index, phase, status, and supersession/applicability notes.
- ADR 0001–0018 under [`architecture/decisions/`](architecture/decisions/).

The index includes the previously omitted ADR 0012 and the correct ADR 0015
path/title:

- [`architecture/decisions/0012-deterministic-passenger-emission-and-stop-access.md`](architecture/decisions/0012-deterministic-passenger-emission-and-stop-access.md)
- [`architecture/decisions/0015-dynamic-direct-itinerary-activation.md`](architecture/decisions/0015-dynamic-direct-itinerary-activation.md)

### Development history and historical prompts

- [`development/milestone-history.md`](development/milestone-history.md) — concise implementation chronology.
- [`development/phase-3-plan.md`](development/phase-3-plan.md) and other `phase-*` development files — historical Phase 3 contracts.
- [`prompts/codex-system-prompt.md`](prompts/codex-system-prompt.md) — reusable current assistant orientation.
- `prompts/phase-*` — historical task/review prompts for their named phases.

### Foundation Template reference

- [`architecture/foundation-template-contract.md`](architecture/foundation-template-contract.md)
- [`template/foundation-release-evidence.md`](template/foundation-release-evidence.md)
- [`template/clone-and-rename.md`](template/clone-and-rename.md)
- [`template/domain-extension-guide.md`](template/domain-extension-guide.md)

These describe the reusable domain-free template snapshot and must not be used as
the current Torrevieja Tycoon product status.

## Agreed foundation stack

| Concern                | Choice                                                      |
| ---------------------- | ----------------------------------------------------------- |
| Package manager        | Yarn workspaces                                             |
| Build tooling          | Vite                                                        |
| Language               | TypeScript with strict checking                             |
| UI                     | React                                                       |
| Representation         | SVG diagnostics; Three.js, React Three Fiber, Drei boundary |
| Client state           | Zustand                                                     |
| Persistence adapter    | Dexie / IndexedDB                                           |
| Runtime validation     | Zod                                                         |
| PWA integration        | vite-plugin-pwa                                             |
| Unit/integration tests | Vitest                                                      |
| Browser tests          | Cypress                                                     |
| Development method     | TDD for simulation behavior                                 |
| Formatting/linting     | Prettier and ESLint                                         |
| Continuous integration | GitHub Actions                                              |
| Licence                | MIT                                                         |
| Runtime                | Pinned Node.js and Yarn versions from repository files      |

Do not duplicate current schema numbers, catalogue counts, or validation details
here. Those belong in [`current-state.md`](current-state.md) and their
machine-readable sources.
