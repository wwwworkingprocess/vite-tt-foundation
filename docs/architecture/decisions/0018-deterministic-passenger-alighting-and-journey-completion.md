# ADR 0018: Deterministic passenger alighting and journey completion

**Decision status:** Accepted
**Accepted in:** Phase 4E5
**Current applicability:** Active and current aggregate passenger/persistence decision.
**Current contract:** [`docs/current-state.md`](../../current-state.md)

## Decision

Passenger alighting is simulation authority. An onboard group alights only at
the exact canonical call matching its vehicle, route, pattern, directional
StopNode, repeated occurrence, target pattern run, and a call sequence later
than boarding. Physical StopPlace equality is insufficient. Each canonical
call processes alighting before boarding, so released capacity is available at
that same call. Route C therefore preserves distinct `tv-stop-0207` and
`tv-stop-0209` calls, and wrapped loop journeys target their next pattern run.

Alighted groups enter bounded destination-access authority. Destination access
reuses the existing WGS84 angular-grid distance-band timing policy; it creates
no walking entity and performs no metre conversion. Zero-distance access
completes on the alighting tick. Positive access completes only at its exact
checked completion tick.

Completed history is represented by cumulative counters and bounded
current-tick completion events, not an unbounded log. Assignment timestamps
provide minimum and maximum completion-duration bounds rather than individual
passenger histories. One bounded waiting-generation watermark per canonical
cohort key preserves retired source identity after onboard groups disappear.

Snapshot restoration rejects onboard ownership once the exact destination
occurrence has passed in its target pattern run. Active onboard authority keeps
the production comparator order even when historical alighting leaves numeric
ID gaps, and one source onboard ID may occupy only one current lifecycle
location: onboard, destination access, or current completion output.

Snapshot V9 also proves the complete boarding-to-alighting run lineage. An
active onboard group can span only its canonical boarding run and, for a
wrapped loop, the immediately following target run. Destination-access and
completion authority retain the exact alighting run and StopNode-call sequence:
the latter equals the boarding call plus the itinerary edge count. These
historical values must not lie ahead of the vehicle's current canonical
pattern-run and call authority.

Historical coordinates are also proven absolutely. The vehicle assignment
determines the canonical pattern for every issued run, and the initial origin,
edge arrivals, closed-loop restarts, and route-leg handoff origins determine
the exact StopNode-call sequence for every run occurrence. Coordinated backward
shifts of boarding and alighting runs or calls are therefore invalid even when
their relative edge-count relationship remains conserved.

Snapshot V9 and Transport Save V7 are the sole current pre-release contracts.
Earlier developer snapshots and saves are obsolete without migration. The
snapshot stores active ownership, sequences, counters, and current events, but
does not duplicate static scenario, population, or itinerary matrices.

## Consequences and deferred boundary

Phase 4E5 completes the first deterministic passenger chain from population
emission through vehicle travel and final destination access. Transfers,
multi-pattern routing, detailed walking, passenger rendering, UI, service
quality, fares, economics, traffic, and timetable refinement remain deferred.

The current-authority parsers and deterministic replay run in both the direct
application adapter and the dedicated Worker. After removing superseded
production contract paths and reusing boarding and access-timing authorities,
the measured Phase 4E5 artifacts require project-specific limits of 490,000
bytes for the application entry and 190,000 bytes for the transport Worker.
The representation and total-JavaScript limits remain unchanged.
