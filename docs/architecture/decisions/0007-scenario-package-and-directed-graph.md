# ADR 0007: Scenario package and directed graph

**Decision status:** Accepted
**Accepted in:** Phase 4A
**Current applicability:** Active package/graph decision. The Phase 4A simulation dependency restriction is superseded by ADR 0008.
**Current contract:** [`docs/current-state.md`](../../current-state.md)

## Decision

Scenario definitions live in an environment-neutral `transport-domain` package. Split versioned JSON assets are selected and integrity-checked by the web application, then parsed into deeply immutable canonical values. Graph edges are derived deterministically from explicit ordered patterns only.

Catalogue order, scenario file order, pattern order, and edge sequence are preserved. No reverse, proximity, settlement, or missing-segment edge is inferred.

## Consequences

The generic Phase 3 simulation, protocol, host, persistence, pacing, and Worker contracts remain unchanged. Phase 4A proves data and graph semantics without making the selected scenario authoritative. Phase 4B must explicitly version any later integration.
