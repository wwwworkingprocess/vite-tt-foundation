# ADR 0015: Dynamic direct-itinerary activation

**Decision status:** Accepted
**Accepted in:** Phase 4E3B
**Current applicability:** Active waiting-cohort decision. Snapshot V6/Save V4 markers are superseded by ADRs 0016–0018.
**Current contract:** [`docs/current-state.md`](../../current-state.md)

## Decision

Canonical Torrevieja StopPlaces are physical scenario data. When passenger
demand is active, the simulation rebuilds the static direct-itinerary plan
from the exact scenario and demand plan. Destination-assigned passengers are
immediately resolved from a physical origin StopPlace to the plan's canonical
directional origin and destination StopNodes.

One bounded waiting cohort is retained per direct-itinerary and destination
cell key. Its first and last assignment ticks are bounds, not a passenger-age
histogram. Matching assignments merge with checked arithmetic; unavailable
direct journeys are consumed and counted explicitly.

The itinerary plan is derived input and is not embedded in authority.
Each authority builds one immutable runtime index from the validated plan;
tick processing uses its canonical omitted-diagonal pair index rather than
reparsing or scanning the complete plan per cohort.
Snapshot V6 and Transport Save V4 are the only supported pre-release
persistence contracts. Earlier snapshots and saves were intentionally
discarded at Phase 4E3B.

## Boundaries

No transfer routing or invented edge exists, and no vehicle is selected.
Refined waiting-age buckets are deferred. The next light Phase 4D seam exposes
the operating vehicle pattern and deterministic StopNode calls; boarding
follows in Phase 4E4. Metric or GIS calculations are not introduced.
