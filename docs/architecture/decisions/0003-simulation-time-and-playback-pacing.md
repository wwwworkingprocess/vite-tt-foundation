# ADR 0003: Simulation time and playback pacing

## Status

Accepted for Phase 3 foundation work.

## Context

The simulation needs a deterministic time coordinate suitable for bus movement, timetables, passenger demand, tests, save files, replay, and future remote hosting. Playback must be adjustable without making browser timing or rendering authoritative.

The product also anticipates temporary speed bonuses and quiet-period acceleration. These must affect only pacing, never simulation rules or outcomes.

## Decision

1. One `SimulationTick` represents exactly five game seconds.
2. Authoritative time is a non-negative safe integer tick.
3. There are 12 ticks per game minute, 720 per game hour, and 17,280 per game day.
4. A scenario may provide `genesisUtcMs`, the UTC instant represented by tick zero. Tick/instant conversion is exact and rejects non-aligned instants.
5. The simulation advances only through explicit whole-tick requests and never reads host clocks or timers.
6. The host owns pause, playback mode, effective playback rate, and scheduling.
7. The provisional normal rate is 20x. Quiet periods may use configurable 50x or 60x rates.
8. Temporary speed bonuses are host/application pacing state. The initial multiplier is 2x and its remaining duration is expressed as actual simulation ticks advanced while active.
9. Playback speed and bonuses do not belong to authoritative transport simulation state. Remaining player-entitlement bonus ticks may be persisted separately by the application.
10. `SimulationTick`, `CommandRevision`, `StreamOffset`, `TimelineId`, and `RenderSnapshotSequence` are separate concepts.
11. Routine tick advancement never makes a command stale. Optimistic concurrency uses `expectedCommandRevision`, not tick.
12. Reliable stream messages require continuity; render snapshots are replaceable.
13. Commands are applied at the current tick before the next tick advances.
14. Actual simulation behaviour and time utilities are developed test-first.

The detailed contract is maintained in [`../time-model.md`](../time-model.md).

## Consequences

### Benefits

- Five-second ticks divide cleanly into minutes, hours, and days.
- The intended 20x, 50x, and 60x playback rates map to whole ticks per pacing second.
- Timetables and durations use integer arithmetic.
- Tick zero can map exactly to a UTC scenario date.
- Playback changes cannot alter deterministic outcomes.
- Speed bonuses have explicit, testable arithmetic.
- The model works in tests, workers, browsers, servers, and command-line tools.

### Costs

- Events requiring sub-five-second fidelity must be represented through progress within a tick or a later deliberate time-model revision.
- Host scheduling still needs to decide when whole ticks are due, but that policy remains outside the simulation.
- Player-facing bonus durations must be balanced using the formula in the time-model document rather than assumed from the raw tick count.

## Clarifying example

A 720-tick bonus represents one game hour.

- At an effective rate of 20x, it lasts three pacing minutes.
- At an effective rate of 40x, it lasts ninety pacing seconds.

If normal playback is 20x and a 2x bonus should last three pacing minutes, its configured budget is 1,440 ticks.

## Alternatives rejected

### Six-second tick

Rejected for the foundation because the intended 20x pacing produces a fractional number of ticks per pacing second and minute/hour divisibility is less convenient for the selected rates.

### Floating-point authoritative time

Rejected because it introduces avoidable comparison, serialization, replay, and determinism risks.

### Playback speed inside the simulation

Rejected because host pacing is not a game-rule outcome and would couple deterministic state to platform scheduling.

### Bonus duration stored as wall-clock time

Rejected because wall-clock duration would make pause, backgrounding, offline use, and different host implementations ambiguous.

## Deferred decisions

See the deferred section in [`../time-model.md`](../time-model.md).
