# Authoritative vehicle movement

Phase 4C adds graph-native vehicles to the existing single transport authority. New V3 vehicles own a caller-supplied `VehicleId`, label, canonical `RouteId`, ordered route-pattern legs, an exact per-edge integer plan per leg, and one discriminated location state. Static stops and edges remain owned by the canonical scenario graph and are never copied into snapshots.

Creation parks a vehicle at its pattern origin. Starting is a zero-tick transition. Positive authoritative tick advancement departs at zero cost, consumes integer progress on explicitly ordered directed edges, records exact arrivals as stop states, completes only at a non-loop terminal stop, and wraps only across an explicit loop-closing edge. No reverse, geographic, timing, or rendering inference is permitted. Split and batched advancement are equivalent.

Transport Snapshot V3 and Transport Save V3 preserve the ordered fleet, RouteId, ordered legs, active leg/pattern, completed-cycle count, and exact movement state. V1 migrates deliberately to an empty V3 fleet. V2 migrates to explicit legacy single-pattern vehicles without inferred return legs. Direct, structured-clone, and Worker adapters validate and deeply freeze the same authority. Rendering receives integer progress/travel values only; interpolation is presentation work.

At a leg terminal, exact arrival remains at that stop. The next positive tick,
or remaining ticks in the same batch, performs a zero-tick handoff to the next
pattern's explicit origin. After the final leg the vehicle returns to leg zero.
Route C deliberately hands off from `tv-stop-0207` to `tv-stop-0209`; no edge,
proximity movement, dwell, or hidden travel time is inferred.

One Transport Save V2 record is one exact authoritative scenario timeline
snapshot: its scenario coordinate, simulation tick, complete ordered fleet,
movement plans, and exact movement states travel together. It never combines
unrelated scenarios. The browser save library is a separate collection and may
hold records from any number of scenarios. New manual and autosave targets are
therefore scoped by the complete active scenario coordinate; earlier global-slot
records remain listed and explicitly restorable for compatibility.
Scoped IDs use a bounded deterministic fingerprint of one canonical,
length-delimited coordinate serialization. Quick-slot availability considers
only exact scoped targets, while compatible global records remain library-only
restore choices. Manual/autosave mode is browser composition preference across
stack replacement and is not stored in Transport Snapshot or Save V2.

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
