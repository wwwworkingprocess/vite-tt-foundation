# ADR 0005: Browser pacing and tick-counted speed bonus

**Decision status:** Accepted
**Accepted in:** Phase 3E
**Current applicability:** Active.
**Current contract:** [`docs/current-state.md`](../../current-state.md)

## Context

The simulation owns whole five-game-second ticks. It must not read a
browser clock or know how quickly a player is experiencing the game.

The application now needs to request deterministic tick advancement at
selectable pacing rates, including:

- pause;
- normal 20× pacing;
- accelerated 50× and 60× pacing;
- provisional quiet-period acceleration;
- a temporary 2× bonus whose duration is expressed in simulation ticks.

A bonus can expire partway through one pacing interval. The scheduler must
not over-advance or create fractional simulation ticks.

## Decision

### Whole simulation ticks only

The authoritative simulation continues to advance only by non-negative
whole tick counts.

One tick remains exactly five game seconds:

```text
12 ticks/minute
720 ticks/hour
17,280 ticks/day
```

No fractional simulation tick enters state, commands, snapshots, or
protocol messages.

### Host-side integer pacing credit

The pacing layer uses an integer monotonic scheduling input measured in
pacing microseconds.

One simulation tick costs:

```text
5,000,000 game-microsecond credits
```

For an integer playback rate `R`, one pacing microsecond contributes `R`
game-microsecond credits.

Examples:

```text
20×  -> 4 ticks per pacing second
50×  -> 10 ticks per pacing second
60×  -> 12 ticks per pacing second
120× -> 24 ticks per pacing second
```

Any incomplete credit remains application-owned scheduler state. It is
not a fractional simulation tick.

The pure planner processes the interval tick-by-tick so a rate change at:

- a quiet-period boundary;
- bonus expiry;
- day rollover;

is applied to the correct next tick.

### Playback modes

The provisional profile is:

```text
paused   0×
normal  20×
fast    50×
maximum 60×
```

Normal mode may use a configurable quiet-period rate. The provisional
profile uses:

```text
quiet window: 02:00 inclusive to 05:00 exclusive
quiet normal rate: 60×
```

Fast and maximum are explicit overrides and do not receive automatic
quiet-period substitution.

Balance values remain configurable application policy, not simulation
rules.

### Temporary 2× bonus

Phase 3E supports one fixed bonus multiplier:

```text
2× effective playback rate
```

Its duration is a positive whole count of simulation ticks.

The bonus:

- decrements only for ticks actually advanced while it is active;
- does not decrement while paused or while no tick is due;
- may span playback-mode and quiet-period changes;
- expires exactly after its final bonus tick;
- never changes simulation rules or distance advanced per tick.

Additional grants add remaining bonus ticks, subject to safe-integer
validation.

The application commits bonus consumption only after the authoritative
advance command succeeds.

### Mid-interval expiry

The planner must support:

```text
base rate: 20× = 4 ticks/pacing second
bonus rate: 40× = 8 ticks/pacing second
bonus remaining: 2 ticks
elapsed interval: 1 pacing second
```

Correct result:

```text
2 bonus ticks consume 0.25 pacing seconds
3 regular ticks consume the remaining 0.75 pacing seconds
total advancement: 5 ticks
```

It must not advance eight ticks and merely relabel six as regular.

### Duration examples

With five-second ticks:

```text
720 ticks at 20× = 180 pacing seconds
720 ticks at 40× = 90 pacing seconds
1,440 ticks at 40× = 180 pacing seconds
```

Therefore a 2× bonus intended to remain active for three pacing minutes at
a normal 20× base rate contains 1,440 bonus ticks.

### Scheduling boundary

The browser driver owns:

- `requestAnimationFrame`;
- monotonic `performance.now()` sampling;
- page-visibility handling;
- starting and stopping pulses.

These values are scheduling inputs only. They are not game datetime.

The driver:

- permits at most one pulse operation in flight;
- converts elapsed intervals to integer microseconds;
- resets its baseline when the document becomes hidden;
- performs no hidden-page catch-up;
- resumes with a fresh baseline when visible;
- removes all browser listeners and animation frames on close.

### Command boundary

The pacing controller requests advancement through the existing
application controller using the existing foundation advance command.

Pacing command IDs are deterministic application-local sequence IDs. They
are not random and do not enter simulation state.

A planned step is committed only when the command result is applied and
its resulting tick matches the expected tick.

A rejection, protocol error, lifecycle change, or mismatched result:

- does not consume bonus ticks;
- does not commit the planned pacing credit;
- pauses pacing;
- exposes a failed pacing projection;
- is not retried automatically.

### Operation ordering

Playback-mode changes, bonus grants, elapsed pulses, pause, and close are
serialized through one pacing-operation queue.

This gives deterministic semantics for clicks or grants occurring while a
tick command is in flight.

A session/timeline generation check prevents a result from an old session
committing into a restored session.

### Runtime-only pacing state

Phase 3E does not change the version-one simulation save schema.

Selected mode, pacing credit, and bonus remainder reset to paused/zero
when:

- a new session becomes active;
- a restore creates a new timeline;
- the pacing controller is closed.

Persistence of bonus entitlement or playback preferences remains a later
product decision.

## Consequences

### Benefits

- no fractional authoritative tick;
- exact bonus-tick conservation;
- quiet boundaries and bonus expiry are deterministic;
- Worker command latency does not create overlapping advancement;
- browser suspension cannot create a huge catch-up burst;
- simulation, persistence, and pacing remain separate.

### Costs

- runtime pacing state is not restored from saves;
- active-page pacing pauses while the page is hidden;
- no automatic recovery follows a failed pacing command;
- the browser driver needs focused visibility and cleanup tests.

## Deferred decisions

- ad-provider integration and entitlement proof;
- persistence of playback/bonus metadata;
- background or offline catch-up;
- autosave interaction;
- user-configurable speed profiles;
- mobile battery policy;
- scheduler batching/performance optimization for real game mechanics;
- multiplayer/server authority.
