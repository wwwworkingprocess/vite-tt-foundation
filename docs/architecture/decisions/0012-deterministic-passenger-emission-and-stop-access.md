# ADR 0012: Deterministic passenger emission and implicit stop access

## Status

Accepted for Phase 4E1.

## Decision

The simulation consumes an immutable Passenger Demand Plan V1 derived outside
the authority from one exact scenario coordinate, population grid, and
scenario-specific StopPlace catchments. The plan carries a stable content hash
and explicit positive-integer emission and access policies. It is static input,
not snapshot payload.

Each active population cell owns an integer fixed-point credit remainder.
Advancing authoritative simulation ticks adds
`populationWeight × emissionCreditsPerWeightPerTick`; division by
`creditsPerPassenger` emits deterministic passenger counts and preserves the
remainder. Served emissions create ordered passenger groups. Unserved emissions
remain explicit source totals and never enter access or StopPlace arrival state.

Stop access is implicit. A served group receives an integer duration from its
precomputed WGS84 grid-cell angular distance band and `accessTicksPerCell`.
There is no walking entity, pathfinding, metre conversion, geodesic calculation,
timer, or render authority. Arrivals aggregate by physical StopPlace and remain
awaiting future destination assignment. Directional StopNodes are intentionally
not selected yet.

Transport Snapshot V4 stores only dynamic passenger state and an exact demand
plan coordinate. Restoring active demand requires the host to resolve and
validate the matching plan before authority is exposed. V1, V2, and V3 snapshot
migrations explicitly produce disabled passenger demand.

## Consequences

- Batched advancement is equivalent to tick-by-tick reduction.
- Passenger counts conserve across source, access, and StopPlace-arrival
  buckets with checked safe-integer arithmetic.
- Direct, structured-clone, and Worker adapters expose the same deeply frozen
  compact demand projection.
- The production authority adds the strict plan parser and reducer to the
  dedicated Worker. The reviewed project-only budgets are 445,000 bytes for
  the application entry and 130,000 bytes for the Worker; the representation
  and total-JavaScript ceilings are unchanged.
- Demand generation is available without browser UI or public population data.
- Destination assignment, waiting queues, boarding, capacity, services,
  schedules, economics, rendering, and geo-background work remain deferred.
