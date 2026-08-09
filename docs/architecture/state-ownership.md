# State Ownership

**Document status:** Current architecture contract

State is divided into three categories. Technical representations may evolve,
but ownership must remain explicit and each value must have one authoritative
owner.

## 1. Authoritative simulation state

Owned by `packages/simulation` after canonical scenario input is supplied.

Current examples include:

- simulation tick;
- exact scenario coordinate and immutable canonical scenario/graph;
- ordered fleet, route-cycle movement, capacities, pattern runs, and exact
  current StopNode calls;
- passenger demand credit/cursors, access groups, waiting cohorts, onboard
  groups, destination access, lineage watermarks, and completion counters;
- bounded current-tick boarding, alighting, and completion events.

Future examples may include services, objectives, finances, incidents, and
ruleset configuration when their phases begin.

Authoritative state changes only through validated simulation commands and
whole-tick advancement. The web may receive frozen snapshots/read models but
must not mutate them as a substitute for commands.

## 2. Application integration state

Owned by `apps/web`.

Examples:

- application boot, loading, ready, failure, and terminal lifecycle;
- selected/requested scenario versus currently active authority;
- active save target, save summaries, persistence progress, and last result;
- Worker/client connection and synchronization state;
- pacing plan, browser scheduling credit, and visibility integration;
- PWA installation/update state;
- current application screen or route.

This state coordinates adapters and user workflows but does not determine
simulation outcomes.

A requested scenario selection is not active authority until the established
load/start or restore lifecycle succeeds. Replacement and restore failures are
non-destructive.

## 3. Presentation state

Owned by React component state or focused Zustand stores in `apps/web`.

Examples:

- dialog visibility;
- selected/hovered entity;
- active inspection panel;
- primary/minimap role;
- camera target and camera mode;
- current map overlay and scenario viewport;
- tooltip visibility;
- graphics, audio, language, and accessibility preferences.

Presentation state may influence which command a user chooses, but it never
silently alters authority.

The SVG diagnostic and R3F boundary may exchange primary/minimap roles without
replacing the Worker, controller, scenario, fleet, persistence, or simulation
authority. Lazy simulation/session controls receive immutable projections and
callbacks; they do not own subscriptions, repositories, controllers, or mirrored
fleet/save authority.

Scenario package settlement `center` and `bounds` currently belong to the
package-local viewport/presentation contract. They do not change canonical city
or transport identity and must not become movement or routing authority.

## Persistence policy

Persist by explicit allow-list, not by serializing complete stores.

- Simulation snapshots: defined/validated by `packages/simulation`, stored by an
  application `SaveRepository` adapter.
- Transport save records: application-owned envelopes containing an exact
  scenario coordinate and current simulation snapshot.
- User preferences: stored separately through focused adapters when required.
- Transient application state: not persisted unless a specific workflow needs
  it.
- Presentation state: generally transient; selected preferences are persisted
  deliberately.

## Current snapshot responsibilities

The current Transport Snapshot V9 is simulation-owned. It stores the exact
scenario coordinate plus dynamic authority required for deterministic
continuation, including tick, fleet, passenger authority, vehicle operations,
capacities, and bounded current events. Canonical static scenario assets are
supplied separately and are not duplicated in the snapshot.

The host chooses when and where to store snapshots. Restore validates syntax and
semantics against the exact scenario and derived plans before replacing current
authority.

Current version and compatibility policy is centralized in
[`../current-state.md`](../current-state.md).

## Zustand restrictions

Zustand is a client-side reactive projection mechanism, not the simulation
engine.

Do not:

- place authoritative mutable simulation objects in broadly writable stores;
- implement game rules in Zustand actions;
- drive simulation ticks from a Zustand timer;
- persist the complete Zustand state tree by default;
- let a presentation projection become restore or command authority.
