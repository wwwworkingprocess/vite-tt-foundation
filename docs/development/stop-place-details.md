# Selected StopPlace Details V1

**Document status:** Current product capability

## Product information reference

Current Torrevieja Avanza stop-board photographs informed the information
hierarchy: physical stop identity, serving public routes, directional pattern
topology, the selected occurrence, and interchange services. They are reference
material, not artwork or canonical game data. No photographed stop, timetable,
branding, contact, address, pole number, or QR content is transcribed.

## Capability audit

| Information                                                                         | Status                                | Current source                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| StopPlace identity, name, settlement, optional coordinates                          | Canonically available                 | `StopPlace` and settlement assets                   |
| Directional StopNodes, nullable physical identity, names, coordinates               | Canonically available                 | `StopNode` assets                                   |
| Route identity, public code, name, data status                                      | Canonically available                 | route assets                                        |
| Pattern identity, direction label, loop status, ordered StopNode calls              | Canonically available                 | route-pattern assets                                |
| Serving routes and serving patterns                                                 | Derivable                             | exact StopNode-to-StopPlace topology                |
| Physical StopPlace/name for each call                                               | Derivable when `stopPlaceId` resolves | StopNode and StopPlace assets                       |
| Selected StopPlace occurrences                                                      | Derivable                             | equality of canonical StopPlace identity            |
| Interchange routes at each physical occurrence                                      | Derivable                             | all canonical patterns, deduplicated in route order |
| Street address and physical pole/stop number                                        | Not currently available               | not guaranteed by schema 1.0.0                      |
| Calendar, season, first/last departure, headway, day-type schedule, real departures | Not currently available               | no timetable/service authority in schema 1.0.0      |
| Operator contact and branding                                                       | Not currently available               | not canonical game authority                        |

Provenance, source references, source sequence ranges, movement timing, and
simulation pacing do not become substitutes for missing service schedules.

## Projection rules

`deriveStopPlaceDetailsModel()` is a deterministic, renderer-independent,
readonly browser projection. It scans canonical topology only when the scenario
or selected physical StopPlace changes. Live waiting, boarding, alighting, and
destination-access values remain separate simulation projections.

Routes and patterns preserve scenario order. Every serving pattern is shown and
every `stopNodeIds` occurrence remains in exact order, including repeated visits
to the selected StopPlace. `directionLabel` describes each independent pattern;
no outbound/return pairing is inferred. `closesLoop` is reported without adding
a decorative duplicate call.

For a resolved physical occurrence, its StopPlace name is primary. Otherwise
the directional StopNode name is used, falling back to its ID. A node with
`stopPlaceId: null` remains in the sequence and receives no inferred interchange
services. Service badges come only from exact shared StopPlace identity, are
deduplicated by route, and preserve canonical route order.

## Current presentation boundary

The primary representation slot owns a renderer-independent modal layer. A
StopPlace selection opens the rich details view there, above the active primary
representation and below the secondary mini representation. Its fixed header
keeps the StopPlace name and Close action visible while the modal body contains
the scrollable overview, local live state, serving-route topology, secondary
directional-node information, and one truthful timetable limitation.

The bottom information dock retains the global five-metric row followed by a
compact selected-StopPlace summary: name, serving-route badges, current waiting
passengers, and an Open details action when the modal is closed. Closing the
modal does not clear the renderer-independent `GameSelection`.

Vehicle selection uses the same lifecycle. The dock retains a compact vehicle
summary while the renderer-scoped modal presents movement, operation, capacity,
onboard, and current-tick transit details. Closing preserves the selected
vehicle; selecting it again or using Open details reopens the modal.

The reference Avanza boards remain information-architecture evidence only.
Fake timetable grids, photographed values, inferred addresses, and pole numbers
remain forbidden.

Future timetable/service work requires a separately reviewed canonical schema
and ingestion milestone. Richer diagram layout, approaching-vehicle information,
and further modal information design are separate product decisions.

## Representation host contract

The workspace distinguishes a representation slot, a representation family,
and a family-owned active view. DOM 2D has `Map` (the existing SVG), Canvas 2D
has a foundation `Main` canvas, and D3D has `Main` (the existing R3F scene).
Exactly two of these three families are mounted. The primary slot shows
its active-view tab and owns the modal layer. The secondary slot owns a common
transparent mini-selection overlay, independent of renderer implementation.

The durable layer order is primary representation, representation modal,
secondary mini representation, then mini swap affordance. Mini swapping is an
explicit two-step interaction: activate the mini to arm it, then activate the
temporary Swap visualizations control. Escape, focus leaving the mini/swap
boundary, or opening/closing a representation modal cancels the armed state.
The same armed boundary can replace only the mini with the inactive family.
