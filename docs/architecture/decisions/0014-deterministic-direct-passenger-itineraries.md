# ADR 0014: Deterministic direct passenger itineraries

## Status

Accepted for Phase 4E3A.

## Decision

Phase 4E3A adds a static Passenger Direct Itinerary Plan V1 in
`packages/simulation`. The plan is identified by the exact canonical scenario,
Passenger Demand Plan, and `single-pattern-direct` routing-policy coordinates.
It contains every ordered pair of distinct physical StopPlaces in the
normalized demand plan. The plan preserves that complete canonical StopPlace
identity as one unique lexically ordered `stopPlaceIds` list, including stops
with zero catchment weight. Pair completeness is validated against this
normative list rather than inferred from the pair entries. Each pair is
explicitly direct or unavailable.

Direct means one forward traversal of one canonical route pattern. Directional
origin and destination StopNodes are selected from their exact pattern
occurrences. Non-loop patterns never wrap. A `closesLoop` pattern may wrap only
through its canonical last-to-first edge. Occurrence indices disambiguate
repeated nodes and physical stops.

When several direct candidates exist, the plan selects the fewest edges,
followed by lexical RouteId, lexical pattern ID, occurrence indices, and
StopNode IDs. The algorithm preprocesses canonical patterns rather than
performing graph-wide search. It does not infer reverse edges, transfers,
pattern changes, or vehicle route-cycle handoffs. Unavailable means only that
no single-pattern direct itinerary exists under this policy.

Physical StopPlaces remain passenger origins and destinations. Same-origin
journeys are excluded. All values are immutable structured-clone-safe data.
Existing WGS84 data is referenced only through canonical stop identity; no
metre, GIS, or new spatial calculation is introduced.

## Consequences

The plan is static and is not integrated into dynamic passenger authority.
Destination-assigned groups remain awaiting itinerary. Snapshot V5 and
Transport Save V3 remain unchanged.

Dynamic activation, bounded waiting cohorts, queues, service selection,
boarding, capacity, transfers, fares, economics, UI, and geo-background work
remain deferred. Exact waiting-age and cohort semantics must be decided before
boarding because current destination groups retain only aggregate assignment
tick bounds.
