# Scenario packages and directed graph — Phase 4A baseline

**Document status:** Historical phase architecture contract
**Applies to:** Phase 4A
**Current state:** See [`../current-state.md`](../current-state.md) and ADR 0008.

Phase 4A introduced `packages/transport-domain`, an ES2023-only library for
strict scenario DTO parsing, cross-file validation, immutable canonical values,
and deterministic directed-graph queries. Browser fetching, hashing, catalogue
selection, and loading state remained in `apps/web/src/scenarios`.

A catalogue is a lightweight ordered list of descriptors. A scenario package is
the atomic manifest plus required settlements, stops, and routes and optional
presentation/provenance metadata. A scenario can reference several settlements;
scenario and settlement identity are never interchangeable, and patterns may
cross settlement boundaries.

Canonical StopNodes are stable directional graph vertices. Raw OSM platforms
and stop positions remain source-reference metadata and never determine
canonical identity. Ordered pattern entries derive only consecutive directed
edges; the last-to-first edge exists only for an explicit `closesLoop`, reverse
edges are never inferred, and parallel edges retain pattern and sequence
identity.

The browser verifies every declared asset hash before domain parsing and uses
base-aware paths for root and repository-subpath deployments. The domain package
has no browser, Node, persistence, clock, Worker, protocol, or simulation
dependency.

During Phase 4A, protocol and simulation were intentionally forbidden from
depending on transport-domain because authoritative scenario integration had not
been designed. Phase 4B explicitly revised only the simulation-side direction:
`packages/simulation` now depends on `packages/transport-domain` for canonical
scenario-bound authority. Browser acquisition and integrity verification remain
in `apps/web`.

Catalogue and manifest titles deliberately mirror and are validated together,
as are scenario identity, data version, status, primary settlement, ordered
settlement IDs, and content hash.

Torrevieja was the first supplied scenario, not a hardcoded engine assumption.
The current catalogue and known scenario-model debt are recorded in
[`../current-state.md`](../current-state.md); this Phase 4A file must not be used
as a current catalogue inventory.
