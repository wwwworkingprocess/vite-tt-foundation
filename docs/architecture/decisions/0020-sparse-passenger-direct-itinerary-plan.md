# ADR 0020: Sparse Passenger Direct Itinerary Plan V2

**Decision status:** Accepted
**Accepted before:** Phase 4F
**Current applicability:** Active; supersedes ADR 0014's dense Plan V1 representation while preserving its routing semantics.

## Decision

Passenger Direct Itinerary Plan V2 retains the canonical StopPlace identity and
complete ordered-pair counts, but stores only pairs for which the existing
`single-pattern-direct` policy finds a direct itinerary. A valid distinct pair
absent from `directEntries` is implicitly unavailable. Plan V1 is obsolete and
is rejected at the V2 boundary.

Direct entries retain route, pattern, directional origin/destination StopNodes,
occurrence indices, wrap identity, and edge count. They no longer duplicate the
complete `stopNodeIds` traversal: those nodes remain canonical pattern authority.
Entries are ordered by lexical origin StopPlace then lexical destination
StopPlace. Candidate selection still uses, in order, edge count, RouteId,
pattern ID, occurrence indices, and directional StopNode IDs.

Construction examines ordered occurrences within each canonical pattern and
uses Set membership for eligible StopPlaces. Its candidate work is approximately
`O(sum(patternLength²))`. With `N` itinerary StopPlaces and `D` actual direct
pairs, retained plan authority is `O(N + D)`, rather than retaining every
`N × (N - 1)` result.

Trusted simulation construction produces the immutable plan and nested sparse
runtime maps in one traversal. Average direct lookup is `O(1)`; a missing valid
pair means unavailable. Untrusted Plan V2 input is parsed strictly, rebuilt from
the exact scenario and demand plan, and compared field by field without a
canonical-JSON copy.

## Consequences

Snapshot V9 and Save V7 do not persist this derived plan and remain unchanged.
Client V4, Worker V4, Passenger Demand Plan V1, destination permutations, and
passenger outcomes remain unchanged. This decision introduces neither transfer
routing nor a general pathfinder, WASM, transferable authority, or new scenario
data.

## Migration evidence

The V1-to-V2 migration records compact per-scenario SHA-256 goldens for the
76-scenario V1 migration baseline. Future scenarios begin under Plan V2 and do
not extend this historical cohort. Each digest covers the ordered direct-pair winner identity
(route, pattern, StopNode occurrences, wrap flag, and edge count), while
deliberately excluding removed V1 path arrays and unavailable records. The
earlier reported `559b4b...` aggregate covered structural counts; the durable
exact-winner global digest is
`1168c8b229b553e929545dd9f7ef5a7643c5f3ac6fd46cfb0daa15d95dabb82b`.
