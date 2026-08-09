# Transport simulation authority — Phase 4B baseline

**Document status:** Historical phase architecture contract
**Applies to:** Phase 4B
**Current aggregate contract:** Transport Snapshot V9, Transport Save V7,
client V3, Worker V3. See [`../current-state.md`](../current-state.md).

## Phase 4B decision

Phase 4B bound exactly one validated canonical scenario to an authoritative
timeline. `packages/simulation` owned the immutable scenario, derived its
directed graph, and retained both unchanged while integer simulation ticks
advanced. It performed no fetching, hashing, persistence, Worker, timer, or
other platform I/O.

Exact compatibility used the scenario schema version, scenario ID, scenario
data version, and package content hash. The Phase 4B transport snapshot stored
that coordinate and dynamic tick only; it never embedded settlements, stops,
routes, graph, presentation, or provenance. Restore received the matching
canonical scenario separately and rejected any coordinate mismatch.

Domain-specific direct/clone-boundary client, save, resolver, and controller
contracts lived in `apps/web/src/transport-simulation`. The generic protocol
package remained scenario-neutral. Foundation Snapshot/Save V1 data had no
historical scenario identity and could not be silently interpreted as transport
authority.

Scenario selection affected only a new timeline. Restore resolved and validated
the exact saved scenario before the current client was torn down. Static
scenario data was not repeated in tick publications or synchronization results;
only its immutable coordinate was exposed.

## Phase 4B browser composition

Once a canonical scenario was selected, the browser constructed one
authoritative transport Worker stack. Application lifecycle, pacing,
confirmation, persistence, and restore composition used the same transport
client and the then-current Transport Save V1 repository. The scenario panel was
a loader/selector and never constructed a second authority.

Transport controller operations were serialized FIFO. Activation became ready
only after synchronization and snapshot export, while generation, client,
timeline, and terminal-close guards prevented stale completions from changing
the current projection.

Restore and replacement failure were non-destructive. Closing normalized
application persistence to its terminal projection, and late persistence
completions could not publish after terminal close.

## Historical scenario-distribution evidence

Phase 4B used two public packages, including `torrevieja-mini-v1`, to prove
cross-scenario selection, persistence, and offline restore. That two-package
precache was acceptance evidence for the phase, not a current distribution
claim.

Current product behavior includes every `scenarios/**/*.json` asset in the PWA
build and exposes the ordered catalogue described in
[`../current-state.md`](../current-state.md). A catalogue/default-plus-runtime-
cache model remains only a possible future optimization.

## Template separation

`foundation-template.json` remains the domain-free Phase 3 template contract.
Transport schema, client/Worker, scenario, and project budget markers belong to
`torrevieja-project.json`. Current product HEAD must not be tagged or described
as the Foundation Template v1.0.0 snapshot.

## Evolution after Phase 4B

Later ADRs added graph-native movement, route cycles, demand, direct itineraries,
waiting, exact calls, boarding, alighting, destination access, lineage, and
completion. Their aggregate current persistence markers are centralized in
[`../current-state.md`](../current-state.md); the Phase 4B V1 markers in this
historical baseline are not current compatibility promises.
