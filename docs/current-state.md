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
presentation-only diagnostic overlay.
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
| Transport client contract         |                    V3 | Older envelopes are rejected                                                                               |
| Transport Worker contract         |                    V3 | Older envelopes are rejected                                                                               |
| Foundation Template snapshot/save | V1 reference contract | Belongs to the domain-free template snapshot, not current transport authority                              |

Machine-readable authority: `torrevieja-project.json`, simulation snapshot
constants, transport save-record constants, and transport client/Worker wire
constants.

Restore resolves the exact scenario coordinate and completes semantic preflight
before current authority is replaced. Failed restore is non-destructive.

## Scenario catalogue and distribution

- Default scenario: `torrevieja-legacy-abc-v1`.
- Public catalogue: 37 ordered entries, all currently marked
  `development-seed`.
- Scenario directories: 38. `torrevieja-mini-v1` is not a public catalogue
  entry.
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
