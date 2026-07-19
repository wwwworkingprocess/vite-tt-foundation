# Scenario packages and directed graph

Phase 4A introduces `packages/transport-domain`, an ES2023-only library for strict scenario DTO parsing, cross-file validation, immutable canonical values, and deterministic directed-graph queries. Browser fetching, hashing, catalogue selection, and loading state remain in `apps/web/src/scenarios`.

A catalogue is a lightweight ordered list of descriptors. A scenario package is the atomic manifest plus required settlements, stops, and routes and optional presentation/provenance metadata. A scenario can reference several settlements; scenario and settlement identity are never interchangeable, and patterns may cross settlement boundaries.

Canonical StopNodes are stable graph vertices. Raw OSM platforms and stop positions remain source-reference metadata and never determine canonical identity. Ordered pattern entries derive only consecutive directed edges; the last-to-first edge exists only for an explicit `closesLoop`, and reverse edges are never inferred. Parallel edges retain pattern and sequence identity.

The browser verifies every declared asset hash before domain parsing and uses base-aware paths for root and repository-subpath deployments. The domain package has no browser, Node, persistence, clock, Worker, protocol, or simulation dependency.

Torrevieja is the first supplied scenario, not a hardcoded engine assumption. Its included A2 slices are reviewed development seed data, not a complete city network. Complete route curation, raw OSM pairing, fuzzy matching, geocoding, and scraping remain external data-preparation work. Phase 4B will decide authoritative simulation, snapshot, save, protocol, and Worker integration.
