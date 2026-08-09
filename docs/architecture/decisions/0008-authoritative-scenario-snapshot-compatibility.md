# ADR 0008 — Authoritative scenario and snapshot compatibility

**Decision status:** Accepted
**Accepted in:** Phase 4B
**Current applicability:** Active exact-scenario compatibility decision. Historical V1 markers have evolved.
**Current contract:** [`docs/current-state.md`](../../current-state.md)

## Decision

`packages/simulation` may depend on `packages/transport-domain`. One timeline
owns one canonical scenario and its deterministically derived graph. A new
`transport-simulation-snapshot` schema stores only the dynamic tick and the
four-part scenario coordinate: schema version, scenario ID, data version, and
content hash.

Restore requires the separately supplied exact canonical scenario and fails
closed on any coordinate mismatch. Domain-specific client and persistence
contracts remain application-owned; `packages/protocol` stays generic.
Foundation Snapshot/Save V1 remains parseable legacy data, is listable as
incompatible, and is never silently migrated to the currently selected
scenario.

## Consequences

Saves stay small and deterministic, and corrected scenario packages cannot
silently change restored worlds. Exact restores require that the matching
scenario package remains available. No vehicle, movement, passenger, economy,
map, or network mechanics are introduced by this decision.

The browser runs one authoritative session stack. Scenario selection supplies
the immutable scenario to the existing application/pacing/persistence
composition; a standalone parallel Foundation session is not created.
