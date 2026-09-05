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

Added deterministic weighted destination-cell assignment, per-origin logical
cursors and affine permutations, bounded groups, unavailable totals, exact
full-cycle fidelity, and conservation.

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

The 76-entry public catalogue contains Torrevieja, Elche, Alicante, Benidorm,
Cartagena, Murcia, and Málaga families plus aggregate packages. Packages are
stored beneath city directories while catalogue manifest paths remain runtime
path authority. Package hashing, parsing, graph construction,
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
- lazy simulation and persistence control boundaries;
- explicit Open Screen lifecycle for verified new-game creation and exact save
  continuation;
- settlement-metadata-driven city/scenario entry;
- renderer-independent Route, StopPlace, and Vehicle selection;
- exact route, stop, vehicle, and passenger authority inspectors.
- shared mini (5 fps) and normal (60 fps) presentation cadence with latest-state
  coalescing;
- compact collapsible information dock and route-coloured vehicle diagnostics;
- reusable per-scenario startup timing diagnostics;
- renderer-neutral normalized transport Map projection shared by DOM2D and
  Canvas2D, with renderer-specific materialization and interaction retained;
- primary-only representation view actions, currently used by DOM2D Map's
  population and passenger toggles without exposing controls in the mini slot.

Remaining product visualization work:

- production graph rendering and styling;
- smooth display interpolation;
- performance acceptance for richer scenes.

## Completed — Live passenger diagnostic/game UI

The current waiting, onboard, capacity, alighting, destination-access, and
completion authority is exposed through contextual read-only diagnostics without
duplicating simulation rules or retaining unbounded event history.

## Phase 4F — Economics and objectives

The population-field integration prerequisite is complete: supported public
scenarios resolve immutable runtime population crops, deterministic StopPlace
catchments, and the development-seed Production Passenger Demand Policy V1.
This activation does not add or tune economics.

The live passenger authority is now visible and inspectable. Exact starting
money, integer currency units, fare calculation, operating costs, accounting
frequency, objective definitions, and win/fail conditions still require a
separate accepted architecture/task decision before implementation.

Before Phase 4F, derived direct-itinerary authority was migrated to sparse Plan
V2 and redundant browser/restore construction passes were removed. A headless
single-tick simulation benchmark now records the evidence needed to select the
next measured runtime optimization without changing passenger semantics.
An opt-in finite browser profiler now separates observable SVG, passenger
diagnostic, population-overlay, and manual R3F frame work. Its evidence is an
input to a later optimization decision; this milestone does not change cadence
or passenger/population presentation.

The passenger-emission work-window optimization is complete: a non-persisted
runtime window from 1 through 12 amortizes canonical cell evaluation while
retaining exact per-tick passenger authority. Window 12 is the provisional
maximum-amortization fallback, not a claim of universal speed. Bounded
scheduler-only apps/web calibration now selects any materially faster integer
1..12 for the active device and scenario and recalibrates on restore. The
headless runtime benchmark
now offers opt-in coarse passenger phase profiling for Torrevieja, Cartagena,
and Málaga W1/W12 comparisons, with exact profiled/unprofiled authority
equality. Phase timings exclude setup, asset loading, demand-plan construction,
snapshots, hashing, and representation. Sparse Direct Itinerary Plan V2,
work-window amortization, the trusted demand-cell runtime index, StopPlace
structural sharing, and adaptive work-window calibration conclude the urgent
performance-optimization epic.

The first evidence-driven post-window optimization is complete. The strict
public waiting-activation boundary remains unchanged, while trusted simulation
advancement reuses a closure-hidden demand-cell lookup owned by the existing
WeakMap-cached `PassengerDemandRuntimeIndex`. This moves one O(plan cells)
lookup construction to canonical-plan first use and removes repeated plan
parsing and transient full-cell maps from steady-state ticks. The derived index
is rebuilt after restore and is absent from Snapshot V9 and Save V7. Profiling
remains available to identify the next measured cost; no cohort-validation,
sorting, freezing, or assignment optimization is included.

Selected StopPlace Details V1 is complete. The primary representation's scoped
modal now projects
physical-stop identity, canonical serving routes and patterns, exact ordered
occurrences, selected calls, loop status, and topology-derived interchange
badges without recomputing static topology on live passenger updates. The dock
retains compact selection context and reopens the details modal. DOM 2D `Map`,
Canvas 2D `Map` with directed route context, canonical StopPlace/Vehicle
selection, population, and passenger diagnostics, and D3D `Main` establish the three-family,
two-mounted-slot lifecycle; mini swapping remains an explicit arm/confirm
interaction. Whole-route interaction, a universal view capability model, D3D
Map, and additional D3D scenes
remain deferred. Canonical
timetable/service-calendar authority remains a separate future data/schema
milestone. Phase 4F remains deferred.

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
Renderer-independent selection, authority inspection, and live passenger
diagnostics are complete. The remaining phase is production-quality graph/R3F
rendering, smooth visual interpolation, richer visual presentation, and
richer-scene performance acceptance. It must reuse the existing selection and
inspector contract, consume immutable authority, and may be sequenced around
Phase 4F through an explicit task decision.

## Phase 6 — Torrevieja Tycoon vertical slice

Combine one coherent scenario, the first deterministic management/economics
loop, objectives, and a polished representation. Detailed mechanics require a
separate architecture decision before implementation.

## Phase 7 and beyond — Ruleset growth

Build a complete Easy game first, then extend the same engine through Normal and
Realistic rulesets. The modes remain configurations of one engine, not separate
codebases.
