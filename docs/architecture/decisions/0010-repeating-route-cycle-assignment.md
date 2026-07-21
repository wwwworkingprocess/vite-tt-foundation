# ADR 0010: Repeating route-cycle vehicle assignment

Status: accepted for final Phase 4C refinement.

## Decision

New vehicles are assigned to one canonical `RouteId` and the route's ordered
pattern legs. Every leg retains its own exact integer edge-travel plan. A
vehicle advances outbound, performs a zero-tick terminal handoff to the next
pattern's explicit first stop, completes the return leg, and repeats from leg
zero indefinitely. Pattern order comes only from canonical `route.patterns`.

The handoff is authoritative state transition, not a graph edge. In Route C,
the outbound terminal `tv-stop-0207` and return origin `tv-stop-0209` are
distinct platforms; the SVG may visibly jump between them. Dwell, layover,
dispatch, timetables, services, and trips remain deferred to Phase 4D.

Transport Snapshot and Save V3 preserve `RouteId`, ordered legs, the active
leg/pattern, exact movement cursor, and completed-cycle count. V2 vehicles are
migrated explicitly as legacy single-pattern assignments and never receive an
inferred return pattern. Client and Worker contracts advance to V3. Rendering
remains a read-only projection of canonical scenario data plus authority.
