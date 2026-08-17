# Browser Pacing Model

> **Scope note:** This is the Phase 3E historical implementation baseline. Its
> browser-time/simulation-authority separation remains active; phase-specific
> non-goals are historical. See [`../current-state.md`](../current-state.md).

## Status

Implemented architecture contract for Phase 3E.

Phase 3E advances the foundation simulation through the accepted
application controller and Worker client. It adds no transport-game
mechanics.

## Layers

```text
minimal React controls
        |
        v
FoundationPacingController
        |
        +--> read-only pacing projection (zustand/vanilla)
        |
        +--> FoundationApplicationController.sendCommand(...)
                    |
                    v
             Worker/direct client
                    |
                    v
             authoritative host
                    |
                    v
                simulation
```

A separate browser driver supplies monotonic elapsed intervals to the
pacing controller.

## Pure pacing planner

Create an environment-neutral web-application module under a pacing
folder, for example:

```text
apps/web/src/pacing/pacing-plan.ts
```

Suggested inputs:

```ts
interface PacingPlanInput {
  readonly simulationTick: SimulationTick;
  readonly elapsedPacingMicroseconds: number;
  readonly creditGameMicroseconds: number;
  readonly mode: PlaybackMode;
  readonly profile: PlaybackProfile;
  readonly remainingDoubleSpeedBonusTicks: number;
}
```

Suggested result:

```ts
interface PacingPlan {
  readonly advancedTicks: number;
  readonly bonusTicksAdvanced: number;
  readonly regularTicksAdvanced: number;
  readonly nextSimulationTick: SimulationTick;
  readonly nextCreditGameMicroseconds: number;
  readonly remainingDoubleSpeedBonusTicks: number;
}
```

Required invariants:

```text
bonusTicksAdvanced + regularTicksAdvanced = advancedTicks

nextSimulationTick =
  simulationTick + advancedTicks

0 <= nextCreditGameMicroseconds < 5,000,000

remaining bonus never increases during planning

advancedTicks is always a non-negative safe integer
```

The planner is pure and does not create commands.

## Playback profile

```ts
type PlaybackMode = 'paused' | 'normal' | 'fast' | 'maximum';

interface PlaybackProfile {
  readonly normalRate: 20;
  readonly fastRate: 50;
  readonly maximumRate: 60;
  readonly quietNormalRate: 60;
  readonly quietStartTickOfDay: number;
  readonly quietEndTickOfDay: number;
}
```

The implementation may use validated general positive integer values while
shipping the provisional defaults above.

The quiet window must support both ordinary and midnight-wrapping ranges.

## Pacing projection

Use `zustand/vanilla` with a private writable store and public read-only
projection.

Suggested state:

```ts
interface FoundationPacingState {
  readonly status: 'idle' | 'running' | 'paused' | 'failed' | 'closed';
  readonly mode: PlaybackMode;
  readonly selectedRate: number;
  readonly effectiveRate: number;
  readonly creditGameMicroseconds: number;
  readonly remainingDoubleSpeedBonusTicks: number;
  readonly advancedTicksTotal: number;
  readonly message?: string;
}
```

The store is not authoritative simulation state.

Consumers receive only:

```ts
getState();
subscribe();
```

## Pacing controller

Suggested operations:

```ts
setMode(mode: PlaybackMode): Promise<void>;
grantDoubleSpeedBonus(durationTicks: number): Promise<void>;
advanceByElapsedMicroseconds(elapsed: number): Promise<void>;
resetForCurrentSession(): Promise<void>;
close(): Promise<void>;
```

The concrete surface may vary.

Rules:

- all operations are FIFO serialized;
- a ready application session is required for non-paused advancement;
- timeline change resets mode to paused, credit to zero, bonus to zero,
  and command sequence to one;
- pause does not discard existing pacing credit unless a timeline reset
  occurs;
- zero due ticks commit only the new credit;
- non-zero due ticks produce exactly one batched advance command;
- plan/bonus state commits only after an applied result;
- failed/mismatched command pauses and marks failure;
- no automatic retry;
- close is idempotent and terminal.

## Command construction

The pacing controller creates one foundation command envelope per non-zero
plan.

Phase 3E may use deterministic per-timeline sequence identifiers such as:

```text
commandId:     pacing-1
correlationId: pacing-correlation-1
clientId:      foundation-pacing-client
sessionId:     foundation-pacing-session
```

The sequence resets when the timeline changes because the restored/new
host has a new idempotency scope.

Do not include `expectedCommandRevision` for automatic pacing commands.
The application controller already serializes authoritative operations,
and normal tick advancement must not be made stale by unrelated elapsed
time.

## Session changes

The pacing controller observes the read-only application projection.

When the active ready timeline changes or the application becomes failed
or closed:

- invalidate the current pacing generation;
- pause;
- reset credit;
- clear the runtime bonus;
- ignore completion from an older pacing generation;
- stop the browser driver when appropriate.

## Browser driver

Suggested port:

```ts
interface PacingDriver {
  start(onElapsed: (microseconds: number) => Promise<void>): void;
  stop(): void;
  close(): void;
}
```

The production driver uses:

- `requestAnimationFrame`;
- `performance.now()`;
- `document.visibilitychange`.

Requirements:

- one callback in flight;
- no overlapping animation loops;
- no catch-up for hidden time;
- baseline reset after visibility change;
- elapsed values are positive safe integer microseconds;
- one pulse is capped by a configurable safety maximum;
- close cancels frames, removes visibility listener, and awaits/ignores
  late completion safely.

Browser APIs remain in the adapter file only.

## Minimal controls

Add a small accessible foundation pacing panel:

- Pause;
- Normal 20×;
- Fast 50×;
- Maximum 60×;
- grant a clearly labelled foundation/demo 2× bonus;
- display current tick;
- selected and effective rate;
- remaining bonus ticks;
- pacing failure state;
- explicit cleanup remains available.

This is platform instrumentation, not gameplay UI.

The demo bonus button uses a small injected/configured tick grant. It is
not an advertisement integration.

## Required tests

### Pure planner

- 1 second at 20× -> 4 ticks;
- 1 second at 50× -> 10 ticks;
- 1 second at 60× -> 12 ticks;
- 1 second at 120× -> 24 ticks;
- partial credit across pulses;
- pause advances zero and preserves credit;
- day rollover;
- quiet-window start/end;
- wrapping quiet range;
- bonus conservation;
- exact bonus expiry inside one interval;
- 2 bonus ticks at 20× base over 1 second -> 5 total ticks;
- batching equivalence across different pulse partitions;
- safe-integer and invalid-input rejection.

### Pacing controller

- no command when zero ticks are due;
- one batched command for non-zero plan;
- applied result commits credit and bonus consumption;
- rejected/malformed result does not commit;
- mode and bonus operations serialize with in-flight pulse;
- bonus grants add safely;
- session/timeline change resets runtime pacing;
- old-session result cannot commit;
- close during command is terminal;
- public projection is read-only and deeply immutable.

### Browser driver

- one animation callback in flight;
- hidden page stops and resets baseline;
- visible page resumes without catch-up;
- stop and restart do not create duplicate loops;
- close removes listeners/cancels frames;
- late callback after close is ignored;
- elapsed interval is capped and converted to integer microseconds.

### Browser integration

Cypress with the real Worker verifies:

- ready session;
- selecting a speed advances ticks;
- pause stabilizes the tick;
- demo bonus displays 2× effective rate and decrements remaining ticks;
- no fatal page/Worker error;
- cleanup stops pacing and terminates resources.

## Current representation-cadence addendum

Browser simulation pacing and representation pacing remain separate. Both SVG
and R3F consume the shared `mini | normal` representation mode: mini targets 5
fps (200 ms) and normal targets 60 fps (1000/60 ms). The browser retains only
the latest pending replaceable projection, so intermediate visual states may be
coalesced but an older state cannot render after a newer one. Reliable
publication, commands, save/restore, and authoritative whole-tick advancement
are never throttled by this policy. This explicit boundary enables later
simulation-versus-representation profiling; it does not claim a 12x CPU change.
SVG samples latest projections through that shared throttle. R3F uses a
`frameloop="never"` Canvas and a representation-only manual frame driver using
the same policy, so neither mini nor normal cadence follows arbitrary display
refresh or invalidation frequency.

## Deferred work

- bonus persistence;
- ad integration;
- background/offline catch-up;
- autosave;
- real game-event interruption policy;
- route schedules and vehicle simulation;
- user settings UI;
- sound and animation polish;
- server authority.
