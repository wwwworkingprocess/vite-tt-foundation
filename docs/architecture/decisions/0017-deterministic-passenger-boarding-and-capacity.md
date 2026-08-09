# ADR 0017: Deterministic passenger boarding and capacity

**Decision status:** Accepted
**Accepted in:** Phase 4E4
**Current applicability:** Active boarding/capacity decision. Snapshot V8/Save V6 are superseded by ADR 0018.
**Current contract:** [`docs/current-state.md`](../../current-state.md)

## Decision

Passenger boarding is simulation authority and occurs only at canonical
current-tick directional StopNode calls. Route, pattern, StopNode, and repeated
occurrence identity must all match a directional waiting cohort; physical
StopPlace equality alone is insufficient.

Vehicles own immutable positive safe-integer passenger capacities, defaulting
provisionally to 80. Calls are processed by vehicle ID and call sequence.
Eligible cohorts board oldest assignment tick first, then by waiting-cohort ID.
Partial boarding preserves the waiting identity and approximate assignment-time
bounds. Boarding is group-based rather than one object per passenger.

Once an onboard group references a waiting-cohort ID, that cohort generation
becomes historical and its itinerary and assignment-time bounds are immutable.
Later passengers with the same itinerary and destination-cell key use one newer
mergeable generation; repeated arrivals merge into that generation until it too
boards. Waiting cohorts retain itinerary-key order, followed by
`firstAssignedTick` and numeric waiting-cohort sequence. When historical and
current generations coexist, the older generation therefore boards first.

Without alighting, historical waiting generations are bounded by source IDs
represented in onboard authority, and every such source represents at least one
onboard passenger. They are consequently bounded by total fleet capacity, with
at most one additional mergeable generation per itinerary/cell key. Phase 4E5
may deliberately revise this retention rule when completed onboard groups are
removed.

Onboard groups retain their source cohort and exact future destination identity.
A wrapped closed-loop itinerary targets the next pattern-run sequence. Current
boarding events are bounded, current-tick, already-processed output and never a
trigger for replay.

Snapshot V8 and Transport Save V6 were the Phase 4E4 pre-release persistence
contracts. ADR 0018 supersedes them with Snapshot V9 and Transport Save V7;
older developer data is obsolete without migration.

## Deferred boundary

This decision introduces no dwell model. Passengers do not alight or complete
journeys yet, and transfers, UI, rendering, geo-background work, economics, and
road traffic remain deferred. Phase 4E5 will consume the stored alighting
identity to alight groups and complete journeys.
