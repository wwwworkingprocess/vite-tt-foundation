# Development Roadmap

**Document status:** Current roadmap and milestone-status summary

## Reading the Phase 4 labels

The completed labels preserve the order in which the project was developed. The
sequence is intentionally not lexical: passenger foundation work began as
4E0–4E3B, then a deliberately light 4D inserted exact vehicle pattern runs and
StopNode calls required for boarding, followed by 4E4 and 4E5. Completed phases
must not be renumbered retroactively.

Detailed historical facts live in
[`milestone-history.md`](milestone-history.md); current contract values live in
[`../current-state.md`](../current-state.md).

## Phase 0 — Architecture contract

**Status:** Complete.

Created the repository root, durable documentation, contributor instructions,
and bounded phase prompts.

## Phase 1 — Strong project template

**Status:** Complete.

Established the strict Yarn workspace, pinned toolchain, package boundaries,
quality tooling, and smoke implementations.

## Phase 2 — Socket.IO-readiness research

**Status:** Complete architecture research; networking remains deferred.

Defined adapter-neutral command, result, observation, synchronization, and
failure-recovery concepts without introducing Socket.IO runtime dependencies.

## Phase 3 — Blank end-to-end platform

**Status:** Complete platform foundation; Foundation Template evidence remains
reference material separate from product HEAD.

Implemented deterministic time, in-memory authority, direct/Worker adapters,
versioned snapshots and persistence, application projection/lifecycle, browser
pacing, PWA/offline verification, R3F mounting, architecture audits, and build
budgets using a deliberately trivial model.

## Phase 4A — Canonical scenario domain

**Status:** Complete.

Introduced strict split scenario packages, canonical StopNode/StopPlace/route
identity, immutable parsing, explicit ordered-pattern directed graphs, and
browser-owned integrity loading.

## Phase 4B — Scenario-bound authority and persistence

**Status:** Complete.

Bound one exact canonical scenario and graph to one authoritative timeline,
introduced exact scenario-coordinate snapshot/save compatibility, and proved
direct/clone/Worker lifecycle plus non-destructive cross-scenario restore.

## Phase 4C — Graph-native vehicle movement

**Status:** Complete.

Added deterministic per-edge movement, explicit RouteId assignment, ordered
route-cycle legs, zero-tick handoffs, standalone terminal behavior, split/batch
equivalence, persistence, and read-only SVG diagnostics.

## Phase 4E0 — Population grid and StopPlace catchments

**Status:** Complete.

Added the transport-domain City Population Grid V1 and deterministic WGS84
angular StopPlace catchments with explicit unserved coverage.

## Phase 4E1 — Passenger emission and origin StopPlace access

**Status:** Complete.

Added fixed-point deterministic passenger emission, bounded source groups,
implicit access timing, explicit unserved totals, and exact demand-plan identity.

## Phase 4E2 — Destination assignment

**Status:** Complete.

Added deterministic weighted cyclic destination-cell assignment, per-origin
cursors, bounded groups, unavailable totals, and exact conservation.

## Phase 4E3A — Static direct-itinerary plan

**Status:** Complete.

Added one deterministic single-pattern direct/unavailable result for every
ordered distinct physical StopPlace pair, preserving directional StopNodes and
repeated occurrences. Non-loop wrapping and transfers remain forbidden.

## Phase 4E3B — Dynamic itinerary activation and waiting cohorts

**Status:** Complete.

Activated destination intent into bounded directional waiting cohorts and
counted unavailable direct journeys explicitly.

## Light Phase 4D — Pattern runs and exact StopNode calls

**Status:** Complete.

Preserved continuous route-cycle movement while adding per-vehicle pattern-run
sequences and exact current-tick directional StopNode calls. Terminal arrival
and the next positive-tick origin handoff remain distinct.

## Phase 4E4 — Boarding and capacity

**Status:** Complete.

Added deterministic call-matched boarding, immutable vehicle capacity, partial
boarding, historical waiting generations, bounded onboard authority, exact
ordering, and conservation.

## Phase 4E5 — Alighting, destination access, and journey completion

**Status:** Current implemented authority.

Exact destination calls alight before boarding, released capacity is reusable at
the same call, destination access completes at its deterministic angular-grid
tick, and bounded lineage/current events/cumulative completion authority are
preserved in current persistence.

Current aggregate contract values are listed in
[`../current-state.md`](../current-state.md).

## Scenario catalogue integration and hardening

**Status:** Integrated as development-seed data; semantic cleanup remains for
known alternative-route variants.

The public catalogue contains Torrevieja, Elche, Elche-radial, and Alicante
families plus aggregate packages. Package hashing, parsing, graph construction,
root/subpath/PWA delivery, route creation, and circular-route operation are
covered. All entries remain `development-seed`, and known R10/R11/Alicante-27
variant modeling debt is recorded in the current-state ledger.

## Browser shell and representation foundation

**Status:** Foundation complete; product visualization incomplete.

Completed:

- visualization-first application shell;
- accessible project, simulation, and session dialogs;
- full-workspace SVG diagnostic;
- R3F mounting/lifecycle boundary;
- primary/minimap role swapping without authority replacement;
- lazy simulation and persistence control boundaries.

Remaining product visualization work:

- production graph rendering and styling;
- smooth display interpolation;
- live passenger/occupancy diagnostics;
- selection and inspection;
- performance acceptance for richer scenes.

## Next — Live passenger diagnostic/game UI

Expose the current waiting, onboard, capacity, alighting, destination-access,
and completion authority as useful diagnostics and initial gameplay feedback.
Presentation must remain read-only and must not duplicate simulation rules.

## Phase 4F — Economics and objectives

Add the first deterministic management/economics layer after live passenger
authority is visible and inspectable. Exact scope and non-goals require a
separate architecture/task decision.

## Later transport growth

Deferred work includes:

- transfers and multi-pattern routing;
- services, timetables, dispatch, dwell, and calendars;
- traffic, incidents, energy, maintenance, and richer costs;
- route-variant selection as a generic model if data-only separation is not
  sufficient;
- campaign/city progression and scenario filtering.

## Phase 5 — Production representation and inspection

**Status:** Partially proven infrastructure; product scope remains.

The SVG/R3F boundary, mounting, lifecycle, and view swapping already exist. The
remaining phase is production-quality graph rendering, smooth visual
interpolation, live passenger/occupancy display, selection/inspection, and
performance acceptance. This phase must consume immutable authority and may be
sequenced around Phase 4F through an explicit task decision.

## Phase 6 — Torrevieja Tycoon vertical slice

Combine one coherent scenario, the first deterministic management/economics
loop, objectives, and a polished representation. Detailed mechanics require a
separate architecture decision before implementation.

## Phase 7 and beyond — Ruleset growth

Build a complete Easy game first, then extend the same engine through Normal and
Realistic rulesets. The modes remain configurations of one engine, not separate
codebases.
