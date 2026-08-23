# Torrevieja Tycoon — Current State

**Document status:** Current architecture and product-state contract
**Update rule:** This file must match current source and machine-readable
manifests. Historical phase documents and ADR version prose do not override it.

## Current product milestone

The implemented authority is Phase 4E5. The deterministic passenger chain is:

```text
population field
→ origin StopPlace access
→ destination assignment
→ direct itinerary activation
→ directional waiting cohort
→ exact vehicle StopNode call
→ boarding and capacity
→ onboard travel
→ exact alighting
→ destination access
→ completed journey
```

The browser now provides an explicit Open Screen lifecycle, city/scenario new-game
entry, resumable-session discovery, renderer-independent Route/StopPlace/Vehicle
selection, and exact authority inspectors including live passenger diagnostics.
Session composition resolves the active settlement's checksum-pinned canonical
population grid, exact operational crop, StopPlace catchments, and deterministic
development-seed Production Passenger Demand Policy V1 for both new games and
restore preflight. The SVG exposes the active nonzero population cells as a
presentation-only diagnostic overlay, visible by default. Passenger map
diagnostics are also visible by default: physical StopPlace waiting totals,
vehicle onboard totals, and retained five-authoritative-tick pulse capability
driven by explicit origin-StopPlace arrival transition evidence. The pulse is
currently disabled by presentation policy. Arrival evidence is aggregated by
tick and StopPlace, survives batched advancement, and is published rather than
persisted; it cannot be inferred from the net queue delta.
Destination assignment uses an origin-keyed deterministic affine permutation
of eligible population-weight units. It preserves exact full-cycle weights and
network-independent spatial intent while avoiding the former shared-phase,
contiguous row-major startup bias.
The next planned product layer is Phase 4F economics and objectives. Transfers,
multi-pattern passenger routing, advanced services, traffic, schedules, and
richer operational realism remain later work unless an active task explicitly
changes the sequence.

## Workspace and dependency graph

```text
apps/web ───────────────► packages/simulation
   │                              │
   ├────────► packages/protocol   └────────► packages/transport-domain
   └────────► packages/transport-domain

packages/protocol          adapter-neutral and independent
packages/transport-domain  environment-neutral and independent of adapters
packages/simulation        environment-neutral authoritative engine
apps/web                   browser/PWA adapters and representation
```

Machine-readable authority: root/workspace package manifests and architecture
audits.

## Current aggregate contracts

| Surface                           |         Current value | Compatibility policy                                                                                       |
| --------------------------------- | --------------------: | ---------------------------------------------------------------------------------------------------------- |
| Transport Simulation Snapshot     |                    V9 | Current schema only; unsupported or malformed authority fails closed                                       |
| Transport Save Record             |                    V7 | Earlier foundation/transport records are obsolete pre-release data unless source explicitly says otherwise |
| Transport client contract         |                    V4 | Older envelopes are rejected                                                                               |
| Transport Worker contract         |                    V4 | Older envelopes are rejected                                                                               |
| Foundation Template snapshot/save | V1 reference contract | Belongs to the domain-free template snapshot, not current transport authority                              |

Machine-readable authority: `torrevieja-project.json`, simulation snapshot
constants, transport save-record constants, and transport client/Worker wire
constants.

Restore resolves the exact scenario coordinate and completes semantic preflight
before current authority is replaced. Failed restore is non-destructive.

## Scenario catalogue and distribution

- Default scenario: `torrevieja-legacy-abc-v1`.
- Public catalogue: 76 ordered entries, all currently marked
  `development-seed`.
- Scenario storage uses seven `<normalized-city-name>-v1` directories containing
  77 packages. The audit derives the directory from the package's primary
  settlement name by Unicode decomposition, removal of combining diacritics,
  lowercasing, and replacing spaces with underscores; unsupported punctuation
  requires an explicit future naming decision. `torrevieja-mini-v1` is the sole
  non-public fixture.
- `catalog.manifestPath` is the sole runtime scenario path authority. Directory
  grouping never becomes settlement or scenario identity.
- Current PWA build includes `scenarios/**/*.json` and
  `population-fields/**/*` in generated assets. The
  earlier catalogue/default-plus-runtime-cache proposal is not implemented.

Machine-readable authority: `torrevieja-project.json`,
`apps/web/public/scenarios/catalog.json`, and `apps/web/vite.config.ts`.

### Canonical topology rules

- `StopNode` is directional and belongs to route-pattern traversal.
- `StopPlace` is a physical passenger-access location.
- Shared StopPlace identity never creates a route edge or passenger transition.
- A genuine circular service uses one independently ordered
  `closesLoop: true` pattern and does not repeat the first StopNode at the end.
- An ordinary bidirectional service uses separate `closesLoop: false` ida and
  vuelta patterns. Vehicle route-cycle handoff does not create a passenger edge
  between them.
- Alternative variants are not sequential service legs unless the product model
  explicitly says they are.

Settlement `center` and `bounds` currently act as package-local scenario
viewport metadata. Other reused settlement fields and all reused StopNode,
StopPlace, route, and pattern identities remain canonical across packages.

### Known scenario-model debt

The current development-seed data still contains route-owned alternative
patterns that the runtime interprets as sequential legs:

- Elche R10 base/event-IFA variants;
- Elche R11 Carrús/Sector V variants;
- Alicante 27A/27B/27C variants.

Do not add route-code-specific runtime exceptions. Correct these as scenario
model/data work by separating selectable variants, selecting one canonical
variant, or introducing a separately designed generic variant model.

## Browser lifecycle and representation status

The browser starts at an Open Screen and does not create Worker authority until a
verified scenario is chosen or an exact compatible save is restored. Successful
creation and restore enter normal unpaused pacing; last-played wall-clock metadata
is presentation-only and never advances simulation ticks.

The browser has a stable authority/representation boundary, a selectable
full-workspace SVG diagnostic, an R3F representation boundary, swappable
primary/minimap shell roles, and an authority-derived inspector. Route, physical
StopPlace, and Vehicle selections are browser-owned canonical identities; the SVG
is only one input adapter and never owns selection or simulation authority.

Both renderers consume one `RepresentationMode`: `mini` targets 5 fps and
`normal` targets 60 fps. Replaceable render projection is sampled with
latest-state coalescing at that presentation cadence; reliable publication and
authoritative tick advancement remain unthrottled. SVG uses the shared latest
projection throttle; R3F uses `frameloop="never"` and advances frames through
the same cadence policy rather than browser display refresh. The expanded information dock
uses one compact five-metric row and can collapse to its accessible heading row.

Passenger StopPlace diagnostics use silver for empty and black for waiting;
vehicle markers use canonical route presentation colours with a separate
selection outline and centered onboard counts. The diagnostic command
`yarn benchmark:scenario-startup` separates production startup-path work from
standalone diagnostic decomposition without machine-dependent timing thresholds.
StopPlace catchments and the passenger-demand plan are application preparation;
the passenger-demand runtime index is lazy first-passenger-advance work. Direct
itinerary diagnostics explain their pattern-local construction cost without
inflating the startup total. Passenger Direct Itinerary Plan V2 retains only
canonical direct pairs; unavailable distinct pairs are implicit and the runtime
uses sparse nested maps. Worker startup constructs passenger-aware itinerary
authority once inside the Worker. Restore validates a candidate while prior
authority remains live and swaps only after synchronization/export succeeds.
Simulation create/restore parses Passenger Demand Plan authority once at its
public boundary, then reuses that canonical value through trusted itinerary and
passenger-state composition. Public helpers and both Worker wire boundaries
remain strict.
Trusted passenger advancement also reuses one WeakMap-cached
`PassengerDemandRuntimeIndex` per canonical plan identity. The index now owns a
closure-hidden demand-cell lookup used by waiting activation, so steady-state
ticks neither reparse the canonical plan nor rebuild a full cell `Map`. The
strict public waiting-activation helper still performs complete plan parsing
before delegating to the same activation core. This derived O(plan cells)
lookup is runtime-only and is reconstructed from canonical plan authority after
restore; Snapshot V9 and Save V7 remain unchanged.

`yarn benchmark:simulation-runtime` measures deterministic headless repeated
single-tick advancement after an explicit untimed warmup. It is the simulation
denominator for the opt-in browser representation profiler. The finite
`yarn benchmark:representation-runtime` diagnostic records SVG commits, passenger
diagnostics, population renders/geometry rebuilds/commits, and manual R3F frame
advances under the unchanged mini 5 fps and normal 60 fps policies. Profiling is
off by default and its machine-specific output is not source authority.
Repeated runs compare complete Snapshot V9 authority outside the timed region,
publish a final snapshot SHA-256, and report population-cell and itinerary
structure alongside aggregate passenger metrics.

Passenger emission-cell evaluation uses the ADR 0021 rolling work window. The
validated runtime-only range is 1–12 ticks and W12 is the provisional
maximum-amortization fallback, not a universal optimum.
It schedules emissions on their exact original ticks; access and transit still
run every authoritative tick. The window is not persisted in Snapshot V9 or
Save V7, so restore may select a different value. Use
`yarn audit:passenger-work-windows` for exact cross-window checkpoint and event
equality, and `benchmark:simulation-runtime --passenger-work-window N` for
diagnostic timing and structural work counts. The frozen scheduler structurally
shares untouched future buckets; `yarn benchmark:passenger-emission` compares
the scheduled reducer with the same-process legacy full-cell reference. Device
auto-calibration remains deferred and may later select any supported integer
from 1 through 12.

Snapshot V9 regression ownership is decomposed into focused core, passenger
restore, transition, journey, and work-window suites with one small shared
deterministic fixture. The simulation exposes an optional environment-neutral
passenger runtime phase observer. The Node runtime benchmark enables it with
`--profile-passenger-phases` to time emission, access/arrival,
destination/waiting, vehicle transit, and destination-access/completion work.
No timing enters simulation authority, Snapshot V9, Save V7, client V4, or
Worker V4.
The waiting-activation detail remains available after optimization. Its plan
size and per-tick cell-evaluation counters are distinct: a trusted steady-state
activation reports zero plan-preparation cell evaluations even though the
canonical plan still contains all demand cells.
The accepted post-change W1/W12 profiles reduce trusted plan preparation to
approximately 0.007–0.018 ms/tick across Torrevieja, Cartagena, and Málaga.
Ordering/finalization is now the largest waiting-activation child, while the
broader destination/waiting residual is the largest enclosing cost. Those
coordinates remain diagnostic evidence, not additional optimization scope.

Browser-created demo vehicles currently assign a named uniform default of 120
authoritative ticks per edge. The movement model already accepts non-uniform
per-edge durations. Geographic edge length and authoritative travel duration are
distinct; no metres, speeds, traffic, or distance-derived timing model exists.

A production passenger-aware visualization is not complete. The inspector exposes
exact waiting, onboard, capacity, alighting, destination-access, completion, and
bounded current-tick events, while smooth vehicle interpolation, final visual
design, and performance acceptance remain product work.

## Validation command tiers

| Command                    | Purpose                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn validate`            | Normal development gate: format, lint, typecheck, tests, coverage, build, and browser E2E                                                                      |
| `yarn validate:portable`   | Complete portable gate: runtime/line-ending/architecture/manifest/project audits, tests, coverage, critical coverage, build/budgets, E2E, PWA, and subpath PWA |
| `yarn validate:repository` | Git/repository-only tracked-output and clean-tree checks                                                                                                       |
| `yarn build:libraries`     | Builds protocol, transport-domain, and simulation independently                                                                                                |

Use the scripts in root `package.json` as the executable source of truth.

## Foundation Template separation

`foundation-template.json` and `docs/template/` describe the reusable domain-free
Foundation Template snapshot. Current Torrevieja Tycoon HEAD is a transport-game
extension of that foundation and must not be described or tagged as the template
release itself.

## Documentation model

- Current contracts: this file, `AGENTS.md`, architecture principles,
  boundaries, state ownership, and the current roadmap.
- Accepted ADRs: immutable decision records with status and current-applicability
  metadata.
- Historical phase records/prompts: preserve original scope and deferrals; they
  do not describe current HEAD.
- Milestone chronology: `development/milestone-history.md`.
- Foundation Template reference: `docs/template/` and the template contract.
