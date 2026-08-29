# ADR 0021: Passenger emission work window

- Status: Accepted
- Date: 2026-08-22
- Applies to: simulation runtime composition before Phase 4F

## Decision

Passenger emission uses a deterministic rolling work window from 1 through 12
ticks. Canonical cell index modulo the selected window assigns replenishment
work to bounded shards. Each evaluated cell schedules its exact emission count
at each original authoritative tick; due records are consumed in canonical cell
order before the existing access, arrival, destination, waiting, and transit
steps.

The work window is readonly runtime tuning, not gameplay authority. It is absent
from PassengerDemandPlan V1, Snapshot V9, and Save V7. New-game and restore
composition derive the bounded scheduler from the exact plan, tick, and cell
credits. Snapshot creation materializes exact current cell credits. A snapshot
created with one window may therefore continue with any other supported window
without changing authority.

Scheduler authority uses frozen plain tuple/array data. No mutable Map or Set
escapes into simulation state. Advancement structurally shares untouched frozen
buckets, while boundedness high-water diagnostics are derived by the audit and
do not impose a production record scan.

The simulation default and production fallback remain W12, the
maximum-amortization fallback. It is not universally fastest. Apps/web runtime
composition now performs bounded scheduler-only calibration using the active
scenario demand plan and initial or restored passenger credits. It may choose
any integer from 1 through 12 when a challenger is materially faster; near ties,
unavailable timing, incomplete evidence, and measurement failures retain W12.
The timing and selected window are device-, scenario-, and session-local,
non-authoritative, and unpersisted. Restore recalibrates for its current runtime.
Production calibration executes inside the simulation Worker through direct
client composition without changing the V4 client or Worker wire contracts.
One untimed warmup precedes 48-scheduler-tick candidate batches. W12 receives
two timed reference probes to reduce cold-start noise. A 250 ms between-batch
ceiling bounds additional work; a single in-flight batch may finish beyond it.
Challengers must beat the better W12 reference by at least 5%, and candidates
within 5% of the fastest challenger prefer the larger work window.

## Rejected alternative

Skipping generation between window boundaries and emitting a multiplied burst
would change spawn, access, arrival, waiting, boarding, and completion ticks.
That is gameplay downsampling and is not permitted.

## Verification

`yarn audit:passenger-work-windows` compares Snapshot V9 checkpoint hashes and
ordered origin-arrival transcripts for windows 1 through 12 on the Torrevieja,
Cartagena, and Málaga performance scenarios. The runtime benchmark accepts
`--passenger-work-window 1..12` and reports scheduler work counts; timing is
diagnostic only.
`yarn benchmark:passenger-emission` also compares W1/W4/W8/W12 against the
same-process trusted legacy full-cell reducer after proving exact passenger
authority equality.
