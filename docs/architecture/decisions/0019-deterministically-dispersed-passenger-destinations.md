# ADR 0019: Deterministically dispersed passenger destinations

**Decision status:** Accepted
**Accepted before:** Phase 4F
**Current applicability:** Active; supersedes only ADR 0013's contiguous row-major traversal.

## Decision

Passenger destination intent remains spatial and independent of routes, direct
itinerary availability, vehicles, and service. Each physical origin StopPlace
derives an immutable affine permutation from the demand-model content hash and
canonical StopPlace ID. Its phase is within the eligible weighted cycle and its
stride is coprime with that cycle, so every weighted unit is visited exactly
once per complete logical cycle.

For normal production-sized cycles up to the unsigned 32-bit range, both phase
and coprime stride provide local dispersion. Extremely large synthetic cycles
above that range use a deterministic phase-offset stride-one fallback. The
fallback retains exact full-cycle weights, replay, split/batch equivalence,
safe arithmetic, and bounded large-count execution, but does not claim the same
local stride dispersion. Current production population weights are far below
this boundary.

The snapshotted destination cursor remains bounded logical progress. Phase,
stride, cumulative indexes, and exclusion indexes are deterministic derived
values and are not persisted. Modular addition and multiplication avoid unsafe
intermediate arithmetic. Full cycles are allocated algebraically; incomplete
cycles use compact cumulative indexes without expanding population weights.

Served cells assigned to the origin StopPlace remain excluded. The retained
runtime index is linear in served cells and StopPlaces and contains no complete
candidate copy per origin. This is required for the forthcoming larger
Cartagena population field.

The permutation is deterministic dispersion, not randomness. Cryptography,
elliptic curves, a mutable PRNG, wall-clock input, and route-aware destination
filtering are unnecessary and forbidden.

## Consequences

Exact full-cycle population-weight fidelity, split/batch equivalence, passenger
conservation, Snapshot V9, Save V7, client V4, and Worker V4 remain unchanged.
Unavailable direct journeys remain valid unmet demand and continue to be
counted by the itinerary-activation stage.
