# State Ownership

State is divided into three categories. The categories may be represented by different technical tools, but their ownership must remain explicit.

## 1. Authoritative simulation state

Owned by `packages/simulation`.

Examples:

- simulation tick and game time;
- deterministic random-generator state;
- network graph and route/service state;
- vehicles, vehicle progress, capacity, and delay;
- passenger demand and journeys;
- incidents and scenario objectives;
- finances and operating metrics;
- selected ruleset and immutable campaign configuration.

This state determines game outcomes. It changes only through simulation commands and time advancement.

The web client may receive snapshots or read models, but it must not mutate them as a substitute for commands.

## 2. Application integration state

Owned by `apps/web`.

Examples:

- application boot and loading state;
- active save slot;
- autosave progress and last-save result;
- worker connection and synchronization status;
- future network connection and reconnection status;
- PWA installation/update state;
- current application screen or route.

This state coordinates the application but does not determine simulation outcomes.

## 3. Presentation state

Owned by React component state or focused Zustand stores in `apps/web`.

Examples:

- selected and hovered entities;
- active inspection panel;
- camera target and camera mode;
- current map overlay;
- tooltip visibility;
- graphics, audio, language, and accessibility preferences.

Presentation state may influence which command the user chooses, but it must not silently alter authoritative state.

The visualization-first browser shell keeps dialog visibility and the
primary/minimap choice as presentation state. Both the SVG diagnostic renderer
and the R3F renderer stay mounted behind stable view boundaries; swapping their
roles does not replace the Worker, controller, scenario, fleet, persistence, or
camera authority.

Simulation operations and saved-session operations are separate lazy
presentation boundaries. They receive the same immutable application
projections and existing callbacks from the shell composition; neither owns a
subscription, repository, controller, or mirrored fleet/save model.

Scenario navigation remains an application boundary: a requested selection is
not active authority until the established close/start or restore lifecycle
resolves its exact package. The navigation accepts the available scenario
catalogue as input so a future Wikidata-Q-code city filter can be inserted
without moving city or campaign state into the shell.

## Persistence policy

Persist by explicit allow-list, not by serializing entire stores.

Recommended responsibilities:

- simulation snapshots: persisted through a `SaveRepository` adapter;
- user preferences: persisted separately through a small preference adapter or focused store persistence;
- transient application state: not persisted unless a specific user experience requires it;
- presentation state: generally transient, with selected preferences persisted deliberately.

## Snapshot responsibilities

The simulation defines the canonical shape and semantics of its snapshot. The host chooses when and where to store it.

A snapshot should eventually contain enough information to reproduce continuation, including:

- schema and simulation versions;
- current tick/time;
- authoritative state;
- deterministic random state;
- ruleset/campaign configuration.

The exact schema belongs to the simulation implementation phase.

## Zustand restrictions

Zustand is a client-side reactive state mechanism. It is not the simulation engine.

Do not:

- place authoritative mutable simulation objects directly in broadly writable stores;
- implement game rules in Zustand actions;
- drive simulation ticks from a Zustand timer;
- persist the complete Zustand state tree by default.

A future simulation bridge may expose immutable read models or snapshots to Zustand for efficient UI subscriptions.
