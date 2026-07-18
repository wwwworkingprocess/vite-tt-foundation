# Simulation Time Model

## Status

Provisional architecture contract for Phase 3. The constants in this document are implementation decisions for the first platform and simulation foundation. Game-balance values may be changed later through an explicit architecture decision and save-version review.

## Purpose

Torrevieja Tycoon separates authoritative simulation time from playback pacing.

The simulation owns deterministic whole-tick processing. A host decides how quickly to request ticks. React, React Three Fiber, browser timers, animation frames, network latency, and machine performance cannot change simulation outcomes.

## Authoritative tick unit

One `SimulationTick` represents exactly five game seconds.

```text
1 tick         = 5 game seconds
12 ticks       = 1 game minute
720 ticks      = 1 game hour
17,280 ticks   = 1 game day
```

Required constants:

```ts
export const GAME_SECONDS_PER_TICK = 5 as const;
export const TICKS_PER_GAME_MINUTE = 12 as const;
export const TICKS_PER_GAME_HOUR = 720 as const;
export const TICKS_PER_GAME_DAY = 17_280 as const;
```

Authoritative simulation time is stored as a non-negative safe integer tick. The simulation does not store floating-point elapsed time.

```ts
type SimulationTick = number;
```

Runtime validation must reject negative, fractional, non-finite, and unsafe integer values.

## Derived game time

Calendar and clock fields are projections derived from the authoritative tick.

```ts
interface DerivedGameTime {
  readonly dayIndex: number;
  readonly tickOfDay: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: 0 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55;
}
```

Examples:

```text
tick 0       -> day 0, 00:00:00
tick 12      -> day 0, 00:01:00
tick 720     -> day 0, 01:00:00
tick 17,279  -> day 0, 23:59:55
tick 17,280  -> day 1, 00:00:00
```

Conversion must use integer arithmetic.

## Genesis date and bidirectional mapping

A scenario may define a `genesisDateTime`: the real-world UTC instant represented by tick zero.

The authoritative serialized form should be an integer UTC Unix epoch in milliseconds:

```ts
interface SimulationCalendar {
  readonly genesisUtcMs: number;
}
```

`genesisUtcMs` must be a finite safe integer aligned to an exact second. Local time zones are presentation concerns.

The mapping is:

```text
gameUtcMs = genesisUtcMs + simulationTick * 5,000
simulationTick = (gameUtcMs - genesisUtcMs) / 5,000
```

Reverse conversion succeeds only when:

- the instant is not before the genesis instant;
- the difference is exactly divisible by 5,000;
- the resulting tick is a non-negative safe integer.

Non-aligned instants are rejected rather than rounded. Presentation code may format the resulting UTC instant for a selected display time zone without changing authoritative time.

## Tick advancement

The simulation advances only through explicit whole-tick operations.

```ts
advanceTicks(state, count)
```

`count` must be a non-negative safe integer.

The simulation must not read or depend on:

- `Date.now()`;
- `performance.now()`;
- timers;
- animation frames;
- browser lifecycle state;
- elapsed host time;
- network timing.

The host schedules advancement. The simulation deterministically processes the requested whole ticks.

## Playback pacing

Playback speed is a host/application concern, not authoritative simulation state.

A playback rate describes the ratio of game seconds to pacing seconds.

The provisional normal rate is `20x`:

```text
20x = 20 game seconds per pacing second
    = 4 whole ticks per pacing second
```

Useful provisional rates are:

```text
20x -> 4 ticks per pacing second
50x -> 10 ticks per pacing second
60x -> 12 ticks per pacing second
```

The game may use a faster quiet-period rate, provisionally around `50x` or `60x`, such as during an overnight interval. Final periods and rates are game-balance configuration, not engine constants.

The host always requests whole ticks. It never asks the simulation to process a fractional tick. Scheduling precision and host pacing implementation remain outside the simulation package.

## Playback modes and effective rate

The application may distinguish the user-selected mode from the effective rate.

```ts
type PlaybackMode = 'paused' | 'normal' | 'fast' | 'maximum';

interface PlaybackDecision {
  readonly selectedMode: PlaybackMode;
  readonly baseRate: number;
  readonly multiplier: number;
  readonly effectiveRate: number;
  readonly reason:
    | 'paused'
    | 'selected-mode'
    | 'quiet-period'
    | 'temporary-speed-bonus'
    | 'attention-required';
}
```

The provisional formula is:

```text
effectiveRate = baseRate * activeSpeedMultiplier
```

Pause produces an effective rate of zero.

## Temporary speed bonus

A temporary bonus may multiply playback speed without changing simulation rules. The initial supported bonus is `2x`.

The bonus is host/application pacing state:

```ts
interface SpeedBonusState {
  readonly multiplier: 2;
  readonly remainingSimulationTicks: number;
}
```

`remainingSimulationTicks` is decremented by the number of authoritative simulation ticks actually advanced while the bonus is active. It is never decremented while paused.

The bonus ends immediately when the remaining value reaches zero. If a requested advancement would cross the boundary, the host divides the advancement so only the remaining bonus ticks receive the multiplier.

The bonus duration is therefore a fixed amount of game time, while its perceived duration depends on the effective playback rate.

Formula:

```text
perceived duration in seconds
  = bonus ticks * 5 / effective playback rate
```

Examples:

```text
720 bonus ticks = 1 game hour

at 20x total effective rate -> 180 seconds = 3 minutes
at 40x total effective rate ->  90 seconds = 1 minute 30 seconds
```

Therefore, when the normal base rate is `20x` and a `2x` bonus produces `40x`, a bonus intended to last three pacing minutes must be configured as `1,440` simulation ticks, not `720`.

This arithmetic is intentional and must be tested. Balance data chooses the tick budget; the engine does not infer a desired wall-clock duration.

The remaining bonus may be persisted by the application alongside a save because it is a player entitlement. It is not part of the deterministic transport simulation state and cannot alter the result of processing a given sequence of simulation ticks and commands.

## Command application order

The host serializes external commands for one simulation instance.

A command is applied at the current tick before the next tick advances:

```text
current tick N
-> apply validated command at tick N
-> assign command revision
-> advance to tick N + 1 when requested
```

A command result may record `appliedAtTick` and `appliedCommandRevision`.

Routine tick advancement must not make a user command stale.

## Separate coordinates

The architecture keeps these concepts separate:

```ts
type SimulationTick = number;
type CommandRevision = number;
type StreamOffset = number;
type TimelineId = string;
type RenderSnapshotSequence = number;
```

- `SimulationTick` is authoritative game time.
- `CommandRevision` orders accepted external command mutations.
- `StreamOffset` orders reliable client-visible messages.
- `TimelineId` distinguishes an authoritative history after creation, restoration, or replacement.
- `RenderSnapshotSequence` orders replaceable visual projections.

An optimistic command may carry `expectedCommandRevision`. It must not use the current simulation tick as a concurrency token.

## Reliable and replaceable output

Reliable domain/read-model messages use stream offsets and gap detection.

Render snapshots are replaceable projections. A newer compatible snapshot may supersede missed intermediate render snapshots without requiring synchronization.

Playback rate affects publication frequency only through host policy. It does not alter authoritative processing.

## Determinism invariants

For the same:

- initial simulation state;
- genesis value;
- rules and scenario configuration;
- random seed and random state;
- ordered commands;
- command application ticks;
- total number of processed ticks;

the final simulation state and authoritative events must be identical regardless of:

- playback rate;
- temporary speed bonuses;
- quiet-period acceleration;
- render frame rate;
- host scheduling cadence;
- whether ticks are requested individually or in equivalent batches.

A speed bonus changes only how quickly ticks are requested. It never changes movement per tick, demand per tick, costs, capacities, random-number consumption, or rule evaluation.

## Persistence ownership

The simulation snapshot contains authoritative tick and simulation state.

The application may persist related host metadata separately, including:

- selected playback mode;
- remaining temporary speed-bonus ticks;
- user pacing preferences.

The application must not persist as authoritative simulation data:

- host timestamps;
- timer identifiers;
- render interpolation state;
- partially elapsed tick fractions;
- animation frame data.

## Required TDD coverage

Phase 3 implementation begins with failing tests for:

- constant relationships;
- tick validation;
- zero conversion;
- minute, hour, and day boundaries;
- multiple-day conversion;
- tick-to-UTC conversion;
- UTC-to-tick exact conversion;
- rejection before genesis;
- rejection of non-aligned instants;
- `advanceTicks(0)`;
- rejection of invalid advancement counts;
- command-before-next-tick ordering;
- tick advancement not changing command revision;
- 20x, 50x, and 60x pacing calculations;
- 2x bonus effective-rate calculation;
- bonus countdown by actual advanced ticks;
- pause preserving bonus ticks;
- exact bonus-expiry boundary splitting;
- 720 ticks at 20x taking three pacing minutes;
- 720 ticks at 40x taking ninety pacing seconds;
- equivalent tick batching producing equivalent state;
- playback/bonus choices not changing authoritative simulation output.

Coverage thresholds are guardrails. Tests must assert behaviour and invariants rather than merely execute lines.

## Deferred decisions

- final playback modes and rates;
- final quiet-period start/end times;
- whether attention events pause or slow pacing;
- ad-provider integration and reward eligibility;
- how playback preferences and bonus entitlements appear in save metadata;
- display time zone and local calendar formatting;
- batching limits and host scheduling implementation;
- replay and timeline restoration policy.
