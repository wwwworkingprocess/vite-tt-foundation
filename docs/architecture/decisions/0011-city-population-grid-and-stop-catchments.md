# ADR 0011: City population grid and stop catchments

**Decision status:** Accepted
**Accepted in:** Phase 4E0
**Current applicability:** Active.
**Current contract:** [`docs/current-state.md`](../../current-state.md)

## Decision

The transport domain owns a strict City Population Grid V1. Its weights are
relative demand potential: zero is inert and a positive safe integer is an
active emitter weight, not necessarily a literal resident count.

Each native cell is exactly `0.001°` latitude by `0.001°` longitude. Row zero,
column zero is the authored origin cell centre; rows proceed north-to-south and
columns west-to-east. All catchment calculations remain WGS84 angular
calculations in normalized grid-cell units. No meter conversion, longitude
correction, projected coordinate system, or GIS dependency is used.

The existing shared display projection maps longitude to X and inverted
latitude to Y. A future square-like authoring or visualization tile may group
two adjacent native cells along whichever projected per-cell display axis is
shorter for the current bounds. Such grouping is presentation convenience
only; cell identity, weight, distance, and assignment remain native-cell
properties.

Canonical StopPlaces are the physical catchment magnets. Directional StopNodes
only establish that a StopPlace is used by the scenario; they do not compete as
independent magnets. Equal-distance assignments use the lexically smallest
StopPlaceId, and the maximum access distance is an explicit dimensionless
grid-cell distance. Coverage is reported using conserved integer weights and
integer basis points.

A StopPlace becomes a catchment magnet only through a StopNode referenced by
at least one canonical route pattern; merely existing in `stops.json` is
insufficient. Route-pattern membership is the Phase 4E0 serviceability boundary.

The same city field can therefore produce different catchments for different
canonical scenarios without changing either input.

## Consequences

This phase implements only the static population field and scenario-derived
stop catchments. It does not add dynamic passengers, browser integration, or
real city assets. The legacy AddressBook and Building ideas are conceptual
inspiration only; no mutable classes, timers, randomness, browser calls, or
meter-based calculations are adopted.

Later milestones may build, in order, deterministic emission credit, implicit
straight-line access to stops, destination assignment, waiting queues,
coverage objectives, economics, and city progression. StopNode direction is
resolved during that later itinerary work. None of those systems is implemented
by this decision.
