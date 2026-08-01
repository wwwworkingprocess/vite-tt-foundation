# ADR 0016: Light vehicle pattern runs and canonical StopNode calls

## Status

Accepted for light Phase 4D.

## Decision

The accepted continuous route cycle remains vehicle movement authority. One
traversal of one canonical route pattern is a **vehicle pattern run**, not an
authored timetable trip. Each vehicle owns a positive per-vehicle run sequence,
the authoritative tick at which that run began, and a positive StopNode-call
sequence.

A StopNode call is an instantaneous directional canonical occurrence event.
Initial vehicles call at their first StopNode. Completing a directed edge calls
its exact destination occurrence; no call is emitted mid-edge or from browser
time. Exact terminal arrival retains the existing terminal movement projection.
On the next positive tick, the zero-duration handoff begins the next pattern run
and calls its origin. Consequently Route C calls `tv-stop-0207` on terminal
arrival and calls `tv-stop-0209` on the following positive tick without an edge
between them. Closed-loop return to occurrence zero begins a new run.

Only calls from the current processed tick are retained. Intermediate calls in
a batched advancement update counters but are not stored as history. The
authoritative tick order remains passenger-demand advancement, vehicle
movement, canonical call production, then publication. Phase 4E4 may insert
boarding after call production and before publication.

Closed-loop fast-forward counts calls from checked cumulative edge-boundary
positions, excluding every event at or before the starting offset. Route-cycle
and closed-loop skipping preserve the existing run-start tick unless a new run
actually begins, and calculate the final run's start tick exactly when it does.
Each operation also retains the canonical tick when movement first started;
that timestamp, movement authority, and run timing determine current-tick calls
without consulting the serialized call suffix. No-call ticks preserve it.
Snapshot V7 stores vehicle operations in fleet order; each position must own
the same VehicleId. Restore derives the only valid run and call counters from
canonical fleet movement and reconstructs the exact possible current-tick call
suffix rather than treating serialized calls as evidence of their own truth.

Transport Snapshot V7 and Transport Save V5 are the sole current pre-release
contracts. They retain dynamic movement, passenger state, minimal pattern-run
state, call counters, and current-tick calls, but no scenario routes, itinerary
plan/index, population field, or call history. Older developer saves are
obsolete and are neither migrated nor activated.

Strict V7 operating-state and call validation increases the dedicated Worker
from the Phase 4E3B baseline of 138,986 bytes to 146,386 bytes. After removing
obsolete current-version schemas and avoiding duplicated route data, its
project-specific budget is narrowly adjusted from 145,000 to 148,000 bytes.
The application-entry, representation, and total-JavaScript budgets remain
unchanged.

## Consequences

Calls can be matched to directional waiting cohorts only by RouteId, pattern
ID, and origin StopNode ID. Physical StopPlace equality alone is insufficient.
Passengers are not boarded, and no capacity, dwell interval, timetable,
service, trip, duty, dispatch, browser clock, GIS calculation, UI, or rendering
authority is introduced.
