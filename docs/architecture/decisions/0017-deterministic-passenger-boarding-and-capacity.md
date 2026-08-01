# ADR 0017: Deterministic passenger boarding and capacity

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

Onboard groups retain their source cohort and exact future destination identity.
A wrapped closed-loop itinerary targets the next pattern-run sequence. Current
boarding events are bounded, current-tick, already-processed output and never a
trigger for replay.

Snapshot V8 and Transport Save V6 are the only current pre-release persistence
contracts; older developer data is obsolete without migration.

## Deferred boundary

This decision introduces no dwell model. Passengers do not alight or complete
journeys yet, and transfers, UI, rendering, geo-background work, economics, and
road traffic remain deferred. Phase 4E5 will consume the stored alighting
identity to alight groups and complete journeys.
