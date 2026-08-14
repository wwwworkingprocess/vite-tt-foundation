# Architecture Decision Record Index

**Document status:** Current ADR index

ADR bodies preserve the decision and context of the phase in which they were
accepted. A decision can remain active while its historical persistence/version
markers are superseded. Current aggregate versions are centralized in
[`../../current-state.md`](../../current-state.md).

| ADR                                                                      | Decision                                      | Accepted in        | Current applicability                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| [0001](0001-foundation-toolchain.md)                                     | Foundation toolchain                          | Phase 1            | Active; exact versions remain source-controlled in manifests/lockfile                |
| [0002](0002-simulation-host-transport-readiness.md)                      | Simulation host transport readiness           | Phase 2            | Active adapter-neutral principles; Socket.IO runtime remains deferred                |
| [0003](0003-simulation-time-and-playback-pacing.md)                      | Simulation time and playback pacing           | Phase 3 foundation | Active                                                                               |
| [0004](0004-save-restore-and-timeline.md)                                | Save, restore, and timeline semantics         | Phase 3D           | Active lifecycle semantics; Foundation version prose is historical                   |
| [0005](0005-browser-pacing-and-speed-bonus.md)                           | Browser pacing and tick-counted bonus         | Phase 3E           | Active                                                                               |
| [0006](0006-reusable-foundation-template.md)                             | Reusable Foundation Template                  | Phase 3F           | Reference-template decision; not product HEAD status                                 |
| [0007](0007-scenario-package-and-directed-graph.md)                      | Scenario package and directed graph           | Phase 4A           | Active data/graph decision; simulation dependency restriction superseded by ADR 0008 |
| [0008](0008-authoritative-scenario-snapshot-compatibility.md)            | Authoritative scenario/snapshot compatibility | Phase 4B           | Active                                                                               |
| [0009](0009-graph-native-vehicle-movement.md)                            | Graph-native vehicle movement                 | Phase 4C           | Active movement semantics; V2 markers historical                                     |
| [0010](0010-repeating-route-cycle-assignment.md)                         | Repeating route-cycle assignment              | Final Phase 4C     | Active                                                                               |
| [0011](0011-city-population-grid-and-stop-catchments.md)                 | Population grid and catchments                | Phase 4E0          | Active                                                                               |
| [0012](0012-deterministic-passenger-emission-and-stop-access.md)         | Passenger emission and StopPlace access       | Phase 4E1          | Active; V4 markers historical                                                        |
| [0013](0013-deterministic-passenger-destination-assignment.md)           | Destination assignment                        | Phase 4E2          | Active; V5 markers historical                                                        |
| [0014](0014-deterministic-direct-passenger-itineraries.md)               | Direct passenger itineraries                  | Phase 4E3A         | Active                                                                               |
| [0015](0015-dynamic-direct-itinerary-activation.md)                      | Dynamic itinerary activation/waiting cohorts  | Phase 4E3B         | Active decision; V6/Save V4 markers superseded by 0016–0018                          |
| [0016](0016-light-vehicle-pattern-runs-and-stop-calls.md)                | Pattern runs and canonical calls              | Light Phase 4D     | Active decision; V7/Save V5 markers superseded by 0017–0018                          |
| [0017](0017-deterministic-passenger-boarding-and-capacity.md)            | Boarding and capacity                         | Phase 4E4          | Active decision; V8/Save V6 superseded by 0018                                       |
| [0018](0018-deterministic-passenger-alighting-and-journey-completion.md) | Alighting and journey completion              | Phase 4E5          | Active and current aggregate persistence decision                                    |
| [0019](0019-deterministically-dispersed-passenger-destinations.md)       | Deterministically dispersed destinations      | Before Phase 4F    | Active destination-dispersion decision; supersedes only 0013's contiguous traversal  |

## ADR editing rule

- Correct typographical errors and metadata.
- Do not rewrite accepted decision bodies to erase historical context.
- Record a later change through a new ADR or explicit supersession/applicability
  metadata.
- Consult current source and `docs/current-state.md` for current versions and
  compatibility.
