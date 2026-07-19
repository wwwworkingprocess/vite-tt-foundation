# Transport simulation authority

Phase 4B binds exactly one validated canonical scenario to an authoritative
timeline. `packages/simulation` owns the immutable scenario, derives its
directed graph, and retains both unchanged while integer simulation ticks
advance. It performs no fetching, hashing, persistence, Worker, timer, or other
platform I/O.

Exact compatibility uses the scenario schema version, scenario ID, scenario
data version, and package content hash. A transport snapshot stores that
coordinate and the dynamic tick only; it never embeds settlements, stops,
routes, graph, presentation, or provenance. Restore therefore receives the
matching canonical scenario separately and rejects any coordinate mismatch.

Domain-specific direct/clone-boundary client, save, resolver, and controller
contracts live in `apps/web/src/transport-simulation`. The generic protocol
package remains scenario-neutral. Existing Foundation Snapshot/Save V1 values
remain valid legacy data but cannot be automatically migrated because they
contain no historical scenario identity.

Scenario selection affects only a new timeline. Restore resolves and validates
the exact saved scenario before the current client is torn down. Static
scenario data is not repeated in tick publications or synchronization results;
only its immutable coordinate is exposed.
