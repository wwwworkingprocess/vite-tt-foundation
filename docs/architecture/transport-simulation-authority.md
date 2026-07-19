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

## Browser session composition

Once a canonical scenario is selected, the browser constructs one
authoritative transport Worker stack. The existing application lifecycle,
pacing driver/controller, confirmation boundary, manual/autosave policy, and
fresh-timeline restore composition all use that same transport client and
Transport Save V1 repository. The scenario panel is a loader and selector; it
does not construct a second authority. Foundation Save V1 records in the same
repository remain visible as legacy-incompatible data and may be explicitly
overwritten, but never restored as transport state.

Transport controller operations are serialized FIFO. Activation is ready only
after full synchronization and snapshot export, while generation, client,
timeline, and terminal-close guards prevent stale completions from changing
the current projection.

## Template separation

`foundation-template.json` remains the domain-free Phase 3 template contract.
Transport schema, client/Worker contract, and expanded build-budget markers
belong to `torrevieja-project.json`. The intended reusable Foundation Template
snapshot is commit `7ad5320d162c1eb772d369bb7fd8250d1aa4fcd3`; current Phase 4
HEAD must not be tagged as Foundation Template v1.0.0.
