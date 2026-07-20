# Authoritative vehicle movement

Phase 4C adds graph-native vehicles to the existing single transport authority. A vehicle owns a caller-supplied `VehicleId`, label, route-pattern assignment, exact per-edge integer travel-tick plan, and one discriminated location state. Static stops and edges remain owned by the canonical scenario graph and are never copied into snapshots.

Creation parks a vehicle at its pattern origin. Starting is a zero-tick transition. Positive authoritative tick advancement departs at zero cost, consumes integer progress on explicitly ordered directed edges, records exact arrivals as stop states, completes only at a non-loop terminal stop, and wraps only across an explicit loop-closing edge. No reverse, geographic, timing, or rendering inference is permitted. Split and batched advancement are equivalent.

Transport Snapshot V2 and Transport Save V2 preserve the ordered fleet and exact movement state. V1 remains separately parseable and is migrated deliberately to V2 with an empty fleet by the restore workflow. Direct, structured-clone, and Worker adapters validate and deeply freeze the same authority. Rendering receives integer progress/travel values only; interpolation is presentation work.

The Phase 4C application-owned transport client and dedicated-Worker wire
contracts are version 2. Version 1 envelopes are rejected explicitly rather
than interpreted as carrying vehicle and fleet fields.

The minimal SVG diagnostic reads the integrity-checked package matching the
active authoritative scenario coordinate plus immutable fleet projections.
It maps canonical stop coordinates and interpolates integer edge progress for
display only; it owns no clock, command path, or authoritative state. Selecting
another catalogue scenario cannot change this representation until authority
is deliberately replaced or restored.

Phase 4D may introduce service and dispatch concepts. It must not reinterpret Phase 4C movement boundaries or make browser time, `Date`, Three.js, frame deltas, GPS distance, timers, or random identifiers authoritative.
