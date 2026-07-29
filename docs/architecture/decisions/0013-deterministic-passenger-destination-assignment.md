# ADR 0013: Deterministic passenger destination assignment

## Status

Accepted for Phase 4E2.

## Decision

Served Passenger Demand Plan cells are destination attractors. Their initial
attraction weight is their unchanged population weight. For passengers at an
origin StopPlace, cells assigned to that same StopPlace and all unserved cells
are excluded. Graph reachability, StopNodes, routes, services, itineraries,
transfers, and vehicle presence do not influence this first spatial intent
model.

Each physical origin StopPlace owns a snapshotted integer cursor over its
row-major weighted candidate cycle. Allocation uses full-cycle arithmetic plus
cyclic interval overlap; it operates by passenger count without randomness,
floating probabilities, or a per-passenger loop. Split and batched allocation
therefore preserve identical totals and cursor positions.

Assignments aggregate by origin StopPlace and destination cell. The
destination cell is retained for a later implicit final-access phase. An origin
with no non-trivial candidate consumes its arrival backlog into an explicit
destination-unavailable counter rather than silently dropping passengers or
creating a same-origin journey.

Transport Snapshot V5 stores the cursors, bounded destination groups, their
deterministic sequence, and conservation counters. Active V4 snapshots migrate
without inventing destinations: their arrival backlog and Phase 4E1 state are
preserved, zero cursors are introduced, and the first later tick processes the
backlog.

All spatial meaning remains the existing WGS84 angular/grid-cell convention.
No metre conversion, GIS dependency, or rendered coordinate enters authority.

## Consequences

- Destination groups are awaiting itinerary resolution, not waiting for a
  particular route, StopNode, or vehicle.
- No-destination arrivals remain distinct from demand unserved at its source.
- Direct, structured-clone, and Worker adapters carry the same immutable
  projection and Snapshot V5 authority.
- Itinerary selection, directional StopNode resolution, waiting queues,
  boarding, capacity, fares, UI, geo-background work, and economics remain
  deferred.
