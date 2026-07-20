# ADR 0009: Graph-native deterministic vehicle movement

Status: accepted for Phase 4C.

## Decision

Vehicles are ordered simulation-owned values assigned to one canonical route pattern. Their movement plan stores a positive safe-integer travel duration for every explicit pattern edge. State is a deeply immutable union distinguishing parked stop, running stop, running edge, and completed stop. The existing tick command advances the global clock and every running vehicle atomically.

Exact edge arrival remains at the reached stop when no ticks remain. Remaining batch ticks depart immediately on the next explicit edge. Non-loop patterns complete; loop patterns continue only through their declared closure. Parallel directed edges retain their identities.

Snapshot and save compatibility advances to V2. V1 is not reinterpreted: a named pure migration preserves its scenario coordinate and tick and creates an empty fleet.

## Consequences

Movement is deterministic, batch-equivalent, adapter-neutral, and independent of rendering. Static scenario data is not duplicated in dynamic state. Date/time, frame delta, Three.js values, coordinate-derived travel, random IDs, schedules, dwell, passengers, economics, and traffic are outside this decision.
