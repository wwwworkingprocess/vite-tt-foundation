# Authoritative vehicle movement — Phase 4C baseline

**Document status:** Historical phase architecture contract
**Applies to:** Final Phase 4C refinement
**Current aggregate contract:** Vehicle semantics introduced in V3 are retained
by Transport Snapshot V9 and Transport Save V7; client and Worker contracts are
V3. See [`../current-state.md`](../current-state.md).

Phase 4C added graph-native vehicles to the existing single transport authority.
New V3 vehicles owned a caller-supplied `VehicleId`, label, canonical `RouteId`,
ordered route-pattern legs, an exact per-edge integer plan per leg, and one
discriminated location state. Static stops and edges remained owned by the
canonical scenario graph and were never copied into snapshots.

Creation parks a vehicle at its pattern origin. Starting is a zero-tick
transition. Positive authoritative tick advancement departs at zero cost,
consumes integer progress on explicitly ordered directed edges, records exact
arrivals as stop states, completes only at a standalone non-loop terminal stop,
and wraps only across an explicit loop-closing edge. No reverse, geographic,
timing, or rendering inference is permitted. Split and batched advancement are
equivalent.

Transport Snapshot V3 and Transport Save V3 introduced preservation of the
ordered fleet, RouteId, ordered legs, active leg/pattern, completed-cycle count,
and exact movement state. V1 migrated deliberately to an empty V3 fleet. V2
migrated to explicit legacy single-pattern vehicles without inferred return
legs. Direct, structured-clone, and Worker adapters validated and deeply froze
the same authority. Rendering received integer progress/travel values only;
interpolation remained presentation work.

At a leg terminal, exact arrival remains at that stop. The next positive tick,
or remaining ticks in the same batch, performs a zero-tick handoff to the next
pattern's explicit origin. After the final leg the vehicle returns to leg zero.
Route C deliberately hands off from `tv-stop-0207` to `tv-stop-0209`; no edge,
proximity movement, dwell, or hidden travel time is inferred.

One Transport Save V3 record represented one exact authoritative scenario
timeline snapshot: scenario coordinate, simulation tick, complete ordered fleet,
movement plans, and exact movement states traveled together. It never combined
unrelated scenarios. The browser save library was a separate collection and
could hold records from multiple scenarios. Manual/autosave mode remained a
browser composition preference and was not stored in Transport Snapshot or Save
V3.

The final Phase 4C application-owned transport client and dedicated-Worker wire
contracts were V3. Older envelopes were rejected explicitly rather than
interpreted as carrying route-cycle vehicle authority.

The minimal SVG diagnostic read the integrity-checked package matching active
authority and immutable fleet projections. It mapped canonical StopPlace
coordinates and interpolated integer edge progress for display only; it owned no
clock, command path, or authoritative state. Selecting another catalogue
scenario could not change representation until authority was deliberately
replaced or restored.

Later phases added pattern-run/call and passenger authority without
reinterpreting these movement boundaries. Browser time, `Date`, Three.js, frame
deltas, GPS distance, timers, and random identifiers remain non-authoritative.
