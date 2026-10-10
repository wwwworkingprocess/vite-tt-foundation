# Torrevieja Tycoon — Current State

**Document status:** Current architecture and product-state contract
**Update rule:** This file must match current source and machine-readable
manifests. Historical phase documents and ADR version prose do not override it.

## Current product milestone

The implemented authority is Phase 4E5. The deterministic passenger chain is:

```text
population field
→ origin StopPlace access
→ destination assignment
→ direct itinerary activation
→ directional waiting cohort
→ exact vehicle StopNode call
→ boarding and capacity
→ onboard travel
→ exact alighting
→ destination access
→ completed journey
```

The browser now provides an explicit Open Screen lifecycle, city/scenario new-game
entry, resumable-session discovery, renderer-independent Route/StopPlace/Vehicle
selection, and exact authority diagnostics including live passenger projections.
Session composition resolves the active settlement's checksum-pinned canonical
population grid, exact operational crop, StopPlace catchments, and deterministic
development-seed Production Passenger Demand Policy V1 for both new games and
restore preflight. The SVG exposes the active nonzero population cells as a
presentation-only diagnostic overlay, visible by default. Passenger map
diagnostics are also visible by default: physical StopPlace waiting totals,
vehicle onboard totals, and retained five-authoritative-tick pulse capability
driven by explicit origin-StopPlace arrival transition evidence. The pulse is
currently disabled by presentation policy. Arrival evidence is aggregated by
tick and StopPlace, survives batched advancement, and is published rather than
persisted; it cannot be inferred from the net queue delta.
Destination assignment uses an origin-keyed deterministic affine permutation
of eligible population-weight units. It preserves exact full-cycle weights and
network-independent spatial intent while avoiding the former shared-phase,
contiguous row-major startup bias.
The urgent performance-optimization epic is complete. Selected StopPlace
Details V1 now reconstructs serving routes, every serving pattern, exact ordered
calls, selected occurrences, loops, and interchange badges from canonical
scenario topology while retaining separate live passenger diagnostics. Rich
StopPlace details are presented in the primary representation slot's scoped
modal, and selected Vehicle details use the same renderer-independent modal
lifecycle for movement, operation, capacity, onboard, and current-tick transit
authority. The bottom GameInspector dock retains the global five-metric summary,
compact selected StopPlace/Vehicle context, and Open details actions. Current
scenario authority contains no timetable or service-calendar data. Phase 4F
economics, transfers, multi-pattern passenger routing, advanced services,
traffic, schedules, and richer operational realism remain later work unless an
active task explicitly changes the sequence.

## Workspace and dependency graph

### Compressed public-layer storage

Public packages are stored as one folder-relative ZIP per layer: `asset-research`,
`icons`, `population-fields`, `route-presentation`, `scenarios`,
`settlement-metadata`, `terrain`, `road-network`, and `urban-assets`. Browser acquisition downloads
a layer on first use, shares concurrent requests, and inflates only requested
entries using native raw-deflate decompression. Stored entries are also supported.
ZIP lengths/CRC and bounded container/inflation validation precede the existing
catalog, schema, byte-length and SHA-256 checks. Catalog paths, source bytes,
native terrain samples, and all authority contracts are unchanged.

Vite serves/publishes archives rather than the loose data tree. The two install
icons are emitted from `icons.zip` at their existing PNG URLs because the browser
manifest requires ordinary image resources. Content-hash query revisions identify
archive versions; the service worker caches requested layers on demand. The shell
and icons are precached, while unused layers are not downloaded for installation.
Offline sessions can use previously acquired layers; a never-acquired layer still
requires connectivity. Research/urban packages remain available through the same
storage adapter without becoming new runtime authorities or being eagerly loaded.

Node audits and real-data fixtures read the same archived entries. The supplied
archives are preserved, and loose source folders may be removed by the owner;
they are not a runtime/build/test fallback. Replacing data requires replacing its
layer archive and rebuilding/restarting Vite. Streaming, binary terrain transport,
worker decoding, and new semantic asset integration remain separate work.

```text
apps/web ───────────────► packages/simulation
   │                              │
   ├────────► packages/protocol   └────────► packages/transport-domain
   └────────► packages/transport-domain

packages/protocol          adapter-neutral and independent
packages/transport-domain  environment-neutral and independent of adapters
packages/simulation        environment-neutral authoritative engine
apps/web                   browser/PWA adapters and representation
```

Machine-readable authority: root/workspace package manifests and architecture
audits.

## Current aggregate contracts

| Surface                           |         Current value | Compatibility policy                                                                                       |
| --------------------------------- | --------------------: | ---------------------------------------------------------------------------------------------------------- |
| Transport Simulation Snapshot     |                    V9 | Current schema only; unsupported or malformed authority fails closed                                       |
| Transport Save Record             |                    V7 | Earlier foundation/transport records are obsolete pre-release data unless source explicitly says otherwise |
| Transport client contract         |                    V4 | Older envelopes are rejected                                                                               |
| Transport Worker contract         |                    V4 | Older envelopes are rejected                                                                               |
| Foundation Template snapshot/save | V1 reference contract | Belongs to the domain-free template snapshot, not current transport authority                              |

Machine-readable authority: `torrevieja-project.json`, simulation snapshot
constants, transport save-record constants, and transport client/Worker wire
constants.

Restore resolves the exact scenario coordinate and completes semantic preflight
before current authority is replaced. Failed restore is non-destructive.

## Scenario catalogue and distribution

- Default scenario: `torrevieja-legacy-abc-v1`.
- Public catalogue: 76 ordered entries, all currently marked
  `development-seed`.
- Scenario storage uses seven `<normalized-city-name>-v1` directories containing
  77 packages. The audit derives the directory from the package's primary
  settlement name by Unicode decomposition, removal of combining diacritics,
  lowercasing, and replacing spaces with underscores; unsupported punctuation
  requires an explicit future naming decision. `torrevieja-mini-v1` is the sole
  non-public fixture.
- `catalog.manifestPath` is the sole runtime scenario path authority. Directory
  grouping never becomes settlement or scenario identity.
- Current PWA build includes `scenarios/**/*.json` and
  `population-fields/**/*` in generated assets. The
  earlier catalogue/default-plus-runtime-cache proposal is not implemented.

Machine-readable authority: `torrevieja-project.json`,
`apps/web/public/scenarios/catalog.json`, and `apps/web/vite.config.ts`.

### Canonical topology rules

- `StopNode` is directional and belongs to route-pattern traversal.
- `StopPlace` is a physical passenger-access location.
- Shared StopPlace identity never creates a route edge or passenger transition.
- A genuine circular service uses one independently ordered
  `closesLoop: true` pattern and does not repeat the first StopNode at the end.
- An ordinary bidirectional service uses separate `closesLoop: false` ida and
  vuelta patterns. Vehicle route-cycle handoff does not create a passenger edge
  between them.
- Alternative variants are not sequential service legs unless the product model
  explicitly says they are.

Settlement `center` and `bounds` currently act as package-local scenario
viewport metadata. Other reused settlement fields and all reused StopNode,
StopPlace, route, and pattern identities remain canonical across packages.

### Known scenario-model debt

The current development-seed data still contains route-owned alternative
patterns that the runtime interprets as sequential legs:

- Elche R10 base/event-IFA variants;
- Elche R11 Carrús/Sector V variants;
- Alicante 27A/27B/27C variants.

Do not add route-code-specific runtime exceptions. Correct these as scenario
model/data work by separating selectable variants, selecting one canonical
variant, or introducing a separately designed generic variant model.

## Browser lifecycle and representation status

The browser starts at an Open Screen and does not create Worker authority until a
verified scenario is chosen or an exact compatible save is restored. Successful
creation and restore enter normal unpaused pacing; last-played wall-clock metadata
is presentation-only and never advances simulation ticks.

The browser has a stable authority/representation boundary, a selectable
full-workspace SVG diagnostic, an R3F representation boundary, swappable
primary/minimap shell roles, an authority-derived compact inspector dock, and
renderer-independent primary-slot detail modals. Route, physical
StopPlace, and Vehicle selections are browser-owned canonical identities; the SVG
is only one input adapter and never owns selection or simulation authority.

The workspace distinguishes primary/mini slots, three representation families,
and family-owned active views. Family identifies renderer/materialization
technology, view identifies an application representation capability, and mode
(`normal` or `mini`) identifies slot presentation without changing the view.
One renderer-independent capability table defines the current matrix: DOM 2D,
Canvas 2D, and D3D support only `Map`. Unsupported pairs fail closed. DOM 2D
exposes SVG, Canvas 2D uses Canvas-native materialization, and D3D uses a
low-poly orthographic isometric world. Exactly two families are mounted; the third remains
inactive while retaining its canonical view identity until an armed mini action
explicitly installs it. Swap remains a
separate confirmation that exchanges the visible families without changing the
inactive family. Mini controls remain above the primary-slot modal.

Canvas 2D `Map` provides canonical directed route-network context with
route colours and direction arrows, plus StopPlace/Vehicle pointer and compact
keyboard selection, existing `GameSelection` and workspace-modal integration,
Canvas-native selected-object feedback, whole-route highlighting from the
shared route selection authority, population cells, passenger StopPlace
status/waiting/arrival diagnostics, and Vehicle onboard counts. Directed graph edges are
presentation-only in Canvas and DOM2D: they are neither focusable nor
selectable. DOM2D and Canvas consume one renderer-neutral, scenario-cached
transport Map projection for normalized bounds, StopNode/StopPlace spatial
identity, directed route topology and presentation identity, and exact current
Vehicle positions. SVG viewBox materialization and accessibility remain DOM2D
owned; CSS-pixel drawing, arrowheads, hit regions, keyboard candidates, and
last-drawn interaction authority remain Canvas owned. DOM2D and Canvas2D share
the same Map population/passenger visibility state and primary-only action
composition: controls disappear completely while a Map is mini while enabled
layers continue rendering at mini cadence.
Waiting totals and five-tick arrival status are derived by one renderer-neutral,
React/DOM/SVG/Canvas-free presentation boundary; DOM2D and Canvas materialize
that shared meaning independently.
Population visibility resets with a new authoritative scenario; passenger
visibility resets with a new authoritative scenario or timeline, matching the
former renderer-mount lifecycle. A renderer-independent route dock below the
mini slot selects canonical routes through `GameSelection`; its separate
selected-route action bar creates an unstarted bus on exactly that route through
the existing command boundary. Route selection and highlighting survive family
swaps, while stale selection is cleared on authoritative scenario replacement.
DOM2D, Canvas2D, and D3D highlight every directed edge of the selected route without
making edges focusable or selectable. D3D has no population/passenger action bar
because those layers are not yet implemented there. Selected
Routes now offer an ephemeral shared Map viewport action: DOM2D and Canvas2D
can fit the complete canonical multi-pattern Route topology or return to the
exact full-network viewport without changing `GameSelection` or filtering Map
content. Renderer-neutral directed-edge bounds use deterministic normalized
padding and safe minimum spans; each renderer retains its own established
materialization. Focus follows a replacement Route selection, survives StopPlace and Vehicle
selection and their detail-modal open/close lifecycle, clears on explicit
Show full network, clear selection, or authoritative scenario replacement,
survives same-scenario timeline changes and family swaps, and is never
persisted. DOM2D/Canvas2D use a bounded full-network/selected-Route viewport;
D3D treats Route focus as a deterministic camera fit and permits local pan/zoom
afterward. D3D camera state is ephemeral and is never saved.
The normal camera is restored after a mini transition only while the model,
focused Route, and viewport size still match its saved context; otherwise D3D
fits the current Route or full network.

D3D Settlement Metadata Integration V0 enriches the accepted procedural-city
foundation with unchanged, checksum-pinned Torrevieja research: 13 districts,
31 morphology zones, 11 urban profiles, 10 building profiles, 22 landmarks and
six landscape regions. Schema `0.1.0` remains `needs-review`, with approximate
polygons rather than official neighborhood or regulatory boundaries. The runtime
catalogue maps `es-torrevieja` to research city `torrevieja`; the public JSON stays
outside emitted JavaScript and is precached for root/subpath offline use.

Population remains quantitative authority. The immutable overlay retains exact
canonical cell identities, coordinates, weights, grid and half-open crop. Primary
zone assignment uses cell centers, smallest polygon area then lexical ID; all
overlaps remain available, districts derive from primary zones, and gaps stay
unassigned. Landscape precedence is `none`, then `strongly-constrained`, then
ordinary buildability. Whole ordinary building envelopes and local-street
segments avoid hard masks; constrained areas sharply reduce occupancy. Canonical
routes remain authoritative and are not removed by approximate landscape masks.

Landmark district/zone references are semantic associations. Existence and zone
ownership by the referenced district are hard invariants; geometric containment
is diagnostic. The supplied Eras de la Sal, Palacio de Deportes and Hospital
Quirón points fall outside their associated coarse zones and are accepted V0
research errata. Their explicit coordinates govern reservations; semantic zone
profiles still inform their scale. There are no ID-specific runtime exceptions.
The JSON, original report and source register remain unchanged; see
[the integration record](research/torrevieja/integration-v0.md).

A pure static city model applies morphology orientation and metre-based block,
street, parcel, setback, coverage and open-space ranges. Weighted family choice
occurs at development scale, with bounded local repetition and known muted
Mediterranean palette tokens. Population modulates residential occupancy and
storeys within those profiles; nonresidential form can exist without population.
Presentation support is smoothed over at most one neighboring population cell,
without changing source weights. Fine-grain parcels line all four block edges
around an interior court; bounded-depth lot rows and secondary access lanes keep
suburban and service parcels smaller. Mature supported parcels have higher fill,
while fragmented frontiers retain planned streets with much lower occupancy.
Generated connected settlement components have identities distinct from research
morphology zones. Canonical route corridors reserve provisional primary streets;
local streets remain presentation geometry without routing or simulation meaning.
Future road/route GeoJSON can replace that source adapter.

Twelve semantic families provide compact apartments, perimeter courts, L corners,
U courts, midrise slabs, tower/podiums, detached and paired houses, terrace rows,
retail boxes, industrial sheds and stepped civic masses. A winged villa variant
and a generic stepped landmark placeholder bring the bounded prototype set to
fourteen. Landmark placeholders remain noninteractive and use existing geographic
reservations; parks and context-only anchors remain open. Generic population-only
presentation remains available for other settlements and research gaps. Optional
acquisition renders transport immediately while metadata is pending and falls
back to generic city geometry on failure without changing camera framing. Quiet
zone tints integrate settlements with the terrain. Research water geometry and
buildability exclusions remain intact; metadata sea/lagoon surfaces remain
omitted because the native terrain surface mask now owns visible water.
Route ribbons retain a small far/medium readability floor over metre-scale roads.
Runtime cropped-grid offsets preserve canonical cell alignment. One storey is 3.1 metres;
Torrevieja buses are 11 × 2.8 × 3.3 metres. StopPlace markers are route-colored, terrain-draped disks of radius 10 metres, half the outer radius of their selected ring (20 metres). Shared stops use the focused route (or selected route when unfocused) when that route serves them, otherwise the first canonical service; unserved stops retain the neutral fallback color.
Comfortable invisible hit targets, keyboard selection and selected-state cues
retain existing semantics.

Static cache identity includes map/population, metadata object and checksum;
fleet, selection, focus, camera and frames do not rebuild the city. Metadata
far/medium/near LOD retains all building silhouettes: one simple instance batch,
body prototypes, then bodies/roofs. Detail changes no longer hollow out inhabited
fabric. Mini keeps one thirty-second simple masses. Generic fallback retains
its previous one-sixth/half/all/one-twenty-fourth policy. At most thirteen body and
thirteen roof instance groups plus four merged surface batches are mounted;
generic landmark volumes join the reservation surface batch. There is no React
tree per parcel. Resources are disposed on replacement/unmount and
city surfaces never intercept entity selection. Full-network framing includes
empty crop land; focused routes use enriched extents where available, bounded pan/zoom and
normal-view restoration after mini coexistence. Dirty D3D requests coalesce under the shared
60/5 fps ceiling; a clean scene schedules no render timer. Terrain is softly lit and texture-free. Cached fixed northwest-sun hillshade and bounded horizon probes modulate existing terrain and city-ground vertex colors, including negative LAND, without real-time shadow maps or changing source heights. Routes, stops and vehicles retain their identity colors. Detailed landmarks, passenger
D3D, district gameplay and final route-system art remain deferred. No simulation/protocol/persistence or population authority changed.

DOM2D and Canvas2D share deliberate normal/mini presentation metrics for Map
entities. Geographic Route and population geometry continues to scale with the
viewport, while StopPlace, Vehicle, passenger-label, and selection glyphs remain
stable in screen space through Route focus and renderer resize. Vehicle glyphs
are deliberately more prominent than StopPlace glyphs while retaining the
existing renderer-independent selection and interaction semantics.

Optional Route Presentation Enrichment V0 is available for the exact all-lines
Torrevieja scenario coordinate. A checksum-verified public asset preserves 205
road-shaped legs and 39 canonical chords across 8 Routes and 16 Patterns. One
pure cached view supplies geometry, source colors, curve bounds and geographic
arc-length interpolation to DOM2D, Canvas2D and D3D. Canonical Stop positions,
edge/progress authority, route focus, selection, simulation and save contracts
remain unchanged. Enriched ordinary routes use 0.8 opacity; selected routes retain
their color at 1.0 and draw later. Unsupported scenarios and asset failures retain
immediate canonical rendering. The city remains based on its canonical
projection, independently of enriched transport ribbons. D3D camera-facing
vehicle HUDs provide screen-sized LOD cues above physically small buses; mini
keeps simple markers. 2D stops have 9-pixel visible diameter and separate generous
hit targets. See the [integration record](research/torrevieja/route-presentation-integration-v0.md).

Terrain V0 is optional web presentation data indexed by `terrain/catalog.json`.
All five Torrevieja scenarios share one EPSG:3035 376 × 430 viewport at native
25 × 25 metres. A base-aware loader caches immutable terrain by settlement,
version, viewport and product hashes; loading/unavailable/error states never
block simulation readiness. JSON decoding is separate from the semantic native
query interface, with closure-private Float64 heights and a Uint8 surface mask.
Every finite source value is preserved exactly, including negative land; null
remains NoData/WATER. The mask, not elevation sign or metadata polygons, owns
classification. Coastline and coverage-edge features remain distinct; the
real-data regression verifies both against the raster without rewriting assets.

A narrow GRS80 ellipsoidal LAEA adapter implements EPSG:3035 through the existing
geographic/D3D map space. It uses the published EPSG:1149 ETRS89/WGS84 null
operation (one-metre nominal accuracy for these epoch-free European coordinates)
and is checked against the EPSG 9820 worked point and local corner round trips.
Native DEM samples are cell centers; raster bounds are cell coverage edges.
Queries use bilinear interpolation only with valid supporting land samples,
nearest supporting land at NoData edges, then a bounded two-cell local land
search for ground objects on water. Outside coverage or no nearby land uses an
explicit diagnostic flat fallback; zero is never substituted into the DEM.

D3D emits buffered LAND and WATER display plans independently of native query authority. Mini and normal far use stride 8 (4,554 vertices / 8,690 triangles); normal medium uses stride 4 (17,810 / 34,772). Normal near retains all native LAND centers in 64 × 64-cell spatial chunks: 53 nonempty patches, 283,086 vertices including duplicated boundaries, and 553,692 triangles. Adjacent chunks share exact support coordinates/heights and have renderer bounding spheres for frustum culling. Far/medium retain two low-draw-call patches. Coarse support uses a conservative lower display envelope so unresolved valleys do not bury native-grounded anchors; runtime samples and queries are unchanged.

The capped normal zoom explicitly selects native stride-1 detail regardless of screen-space LOD thresholds. Native-center heights remain represented in GPU Float32 coordinates; the full-resolution runtime remains lossless Float64 authority. Only at capped normal zoom, a single buffered line object shows native 25 × 25 metre cell edges (no fan diagonals). Its cell window follows the orthographic viewport including the displayed height range, clips to source coverage and snaps to cells, so sub-cell pan reuses it. LAND and WATER grid edges use their own mesh support heights. Grid geometry is replaced/disposed as the window changes or leaves maximum zoom; mini has no grid. Projected native corners are weakly cached per immutable world transform. Adjacency-based emission preserves both coast surfaces without per-edge strings, sets or repeated coordinate projection, and prepares an exactly sized typed buffer. Cached support arrays are CPU data; mounted windows own/dispose their GPU geometry.

Plans are weakly cached by terrain/map-transform identity, mode and effective LOD. Fleet, selection, simulation ticks and camera motion within a band do not rebuild static buffers. LOD transitions select cached CPU plans; mounted renderers own and dispose GPU geometries. Chunk meshes share one LAND and one WATER material, disposed by their scene owner. Ground-like surfaces have upward winding and one-sided materials. Thin network ribbons retain native-grounded heights and draw as depth-independent overlays so reduced city drapes cannot occlude route identity.

Broad drape support is presentation-only: far/medium/near use 200/100/50 metres for ground/street/reservation surfaces and 150/75/25 metres for routes. City-wide research landscape tints use 200/125/100 metres: their approximate macro polygons do not warrant local ground density. Native far/mini skip research landscape and dense streets entirely. Subdivision has a depth-16 limit and a 262,144-triangle preparation ceiling: original faces are reserved, and budget exhaustion retains coarser coverage instead of introducing holes. An input already above that target receives no extra splits. Immutable CPU surface templates include LOD in their cache key; broad layers avoid a second full buffer copy.

Buildings retain their generated footprints/heights and receive sampled anchor
bases. Routes and independent ground/street/landscape surfaces are subdivided
and draped in presentation space; landmarks keep one sampled anchor rather than
deforming their volume. Stops, vehicles, selection cues and camera diagnostic
pick coordinates use the same ground query with small named metre offsets.
D3D placement samples the same native-center triangle fans as its near terrain
mesh, preventing bilinear-versus-mesh differences from burying objects; native
query interpolation remains bilinear. Corner support is a lazy presentation cache shared across map transforms and native mesh/grid derivations. Ground tints are emitted only on mask land. D3D elevation uses a fixed 10× presentation multiplier about sea level zero, including negative LAND elevations; native heights, mask, queries and statistics remain unchanged. Terrain meshes, shared ground mapping, building/landmark bases, routes, city surfaces, stops, vehicles and selection cues all use the same exaggerated surface. Horizontal dimensions, building heights, vehicle sizes and metre layer offsets are not exaggerated;
framing allows for its height range, and pan targets stay within its coverage
bounds. Manual pan/zoom and active drags survive ordinary workspace viewport resizing; mini mode cancels pending gestures. Explicit
scenario, focus and mode changes retain their fit/restore behavior.
Canonical horizontal route/progress, population, settlement, selection,
simulation, Worker and save authority remain unchanged. Read-only DOM diagnostics
expose terrain readiness, dimensions/resolution, sample and mesh counts, extrema
and geometry builds, elevation multiplier, capped zoom and viewport-grid window/segment/build counts, effective render LOD/stride, prepared route/city layer counts and subdivision-limit flags, actual drawn patch counts and renderer calls/triangles/geometries. Diagnostics write on preparation or drawing without per-frame React state. Camera, selection, accepted fleet, focus, source/LOD and viewport changes request a coalesced frame; unchanged scenes remain idle. Completed-frame camera acknowledgement supports visual
acceptance without sleeps; native source readiness is acknowledged by the actual
terrain mesh after drawing, separately from asset decode readiness. Camera diagnostics replay after a detached DOM host
reattaches during slot swaps; unchanged frames avoid repeated DOM writes.
The fallback-to-native source transition reinitializes the Canvas, so asynchronous
initial configuration cannot retain the discarded fallback root. Selection/fleet
changes retain the same native Canvas and terrain geometry; normal/mini mode
changes alone retain the camera fit/restore path. Camera world matrices update
synchronously after fit/pan, so CPU entity picking does not wait for a draw.
City surface offsets remain below transport ribbons. Subdivision reuses vertex
height queries within each preparation. Weakly cached CPU surface templates are
keyed by immutable city, terrain/map transform, LOD and layer, avoiding repeated
polygon draping across StrictMode and canvas remounts. Each mounted renderer
owns fresh attribute identities and disposal; shared CPU arrays are not mutated.
Hidden StopPlace targets update their final matrices and
retain a horizontal screen-scale pick floor under the wider terrain framing. Their pick centers match the visible disk ground offset, metre-scale targets avoid the old oversized vertical columns, and draw-time camera changes refresh their pick floor without rebuilding terrain or visible disks.
Vehicle body/HUD/hit intersections take presentation pick priority at overlaps,
so broad terrain-height Stop targets cannot steal visible Vehicle clicks;
canonical entity identities and selection callbacks remain unchanged. Public catalog/products retain their logical root/subpath
paths inside lazily acquired archives, with byte/hash integrity checked by the build audit.

The terrain catalog includes Torrevieja, Alicante, Murcia, Benidorm, Elche and Málaga: 65 scenario mappings across 58 native viewports. Its 18 height/mask/coastline products retain their supplied bytes; Cartagena is the only uncatalogued settlement. ZIP guards retain a 64 MiB compressed archive limit, with 128 MiB per-entry and 384 MiB aggregate declared-output limits to accommodate the supplied six-city package (about 108 MiB largest entry and 328 MiB total); entries inflate only when requested. JSON products now use compressed layer storage; binary or streamed delivery, worker preparation, persistent GPU chunk caches and million-plus-sample delivery remain future work. Native detailed terrain already uses cullable spatial patches; broader city batching remains bounded presentation geometry. Cartagena terrain, complex foundations, bridges/tunnels, terrain editing, vertical exaggeration controls and advanced water/art are deferred.

D3D `Map` is the family's sole current view. No view-switch control exists while
every family supports only one view.

Build budgets account for renderer-specific emitted artifacts independently
from shared production architecture. The shared transport Map projection has a
4,500-byte hard coordinate and the DOM2D projection adapter has a 2,500-byte
hard coordinate. The build audit also reports Canvas, DOM2D, and population Map
logical compositions including their mandatory shared dependencies and optional route-presentation
acquisition/geometry, while the
total-emitted-JavaScript budget remains the global no-hiding backstop. The owner
approved its rebaseline from 1,750,000 to 2,000,000 bytes: the previous aggregate
ceiling predates production D3D. D3D remains lazy-loaded and independently bounded
at 1,200,000 bytes; application entry, Worker, persistence and every other
renderer/component isolation budget remain unchanged. These
report-only compositions are not compared with the historical exclusive
renderer ceilings.

The pacing-credit counter is omitted from UI. The complete pacing controller/session
projection still retains credit and advanced-tick totals; the React subscription
ignores changes confined to these bookkeeping fields while retaining authority,
mode/rate, bonus, error and lifecycle updates. Session deep-freezing weakly remembers
only objects it has recursively frozen, avoiding repeated full-state walks on
pacing pulses without trusting arbitrary shallow-frozen inputs. The demo button
grants 1,200 double-speed bonus ticks (50 times the former 24), retaining the 2x
bonus rate and existing deterministic consumption rules.

`yarn benchmark:d3d-near` runs a finite Torrevieja all-lines maximum-zoom profile:
paused camera pans, a paused idle-frame assertion, then a separate three-second
normal-pacing observation. Opt-in performance markers record grid preparation,
render submission and application renders; JSON is written under ignored
`performance-results/`. Timing results are local measurements, not CI FPS gates. The [maximum-zoom CPU correction report](development/d3d-near-performance.md) records the measured comparison and ownership details.

All renderers consume one `RepresentationMode`: `mini` targets 5 fps and
`normal` targets 60 fps. Replaceable render projection is sampled with
latest-state coalescing at that presentation cadence; reliable publication and
authoritative tick advancement remain unthrottled. SVG uses the shared latest
projection throttle; R3F uses `frameloop="never"` and advances frames through
the same cadence policy rather than browser display refresh. The expanded information dock
uses one compact five-metric row and can collapse to its accessible heading row.

Passenger StopPlace diagnostics use silver for empty and black for waiting;
vehicle markers use canonical route presentation colours with distinct
screen-space prominence, separate selection feedback, and centered onboard
counts. The diagnostic command
`yarn benchmark:scenario-startup` separates production startup-path work from
standalone diagnostic decomposition without machine-dependent timing thresholds.
StopPlace catchments and the passenger-demand plan are application preparation;
the passenger-demand runtime index is lazy first-passenger-advance work. Direct
itinerary diagnostics explain their pattern-local construction cost without
inflating the startup total. Passenger Direct Itinerary Plan V2 retains only
canonical direct pairs; unavailable distinct pairs are implicit and the runtime
uses sparse nested maps. Worker startup constructs passenger-aware itinerary
authority once inside the Worker. Restore validates a candidate while prior
authority remains live and swaps only after synchronization/export succeeds.
Simulation create/restore parses Passenger Demand Plan authority once at its
public boundary, then reuses that canonical value through trusted itinerary and
passenger-state composition. Public helpers and both Worker wire boundaries
remain strict.
Trusted passenger advancement also reuses one WeakMap-cached
`PassengerDemandRuntimeIndex` per canonical plan identity. The index now owns a
closure-hidden demand-cell lookup used by waiting activation, so steady-state
ticks neither reparse the canonical plan nor rebuild a full cell `Map`. The
strict public waiting-activation helper still performs complete plan parsing
before delegating to the same activation core. This derived O(plan cells)
lookup is runtime-only and is reconstructed from canonical plan authority after
restore; Snapshot V9 and Save V7 remain unchanged.

`yarn benchmark:simulation-runtime` measures deterministic headless repeated
single-tick advancement after an explicit untimed warmup. It is the simulation
denominator for the opt-in browser representation profiler. The finite
`yarn benchmark:representation-runtime` diagnostic records SVG commits, passenger
diagnostics, population renders/geometry rebuilds/commits, and manual R3F frame
advances under the unchanged mini 5 fps and normal 60 fps policies. Profiling is
off by default and its machine-specific output is not source authority.
Repeated runs compare complete Snapshot V9 authority outside the timed region,
publish a final snapshot SHA-256, and report population-cell and itinerary
structure alongside aggregate passenger metrics.

Passenger emission-cell evaluation uses the ADR 0021 rolling work window. The
validated runtime-only range is 1–12 ticks and W12 is the provisional
maximum-amortization fallback, not a universal optimum.
It schedules emissions on their exact original ticks; access and transit still
run every authoritative tick. The window is not persisted in Snapshot V9 or
Save V7, so restore may select a different value. Use
`yarn audit:passenger-work-windows` for exact cross-window checkpoint and event
equality, and `benchmark:simulation-runtime --passenger-work-window N` for
diagnostic timing and structural work counts. The frozen scheduler structurally
shares untouched future buckets; `yarn benchmark:passenger-emission` compares
the scheduled reducer with the same-process legacy full-cell reference. Apps/web
now performs bounded scheduler-only calibration inside the production Worker
using the active scenario plan and current credits. A challenger must materially
beat W12; near ties or measurement failure retain W12. Selection is local
runtime tuning, is not persisted, and restore recalibrates without changing
Snapshot V9, Save V7, client V4, or Worker V4.

Snapshot V9 regression ownership is decomposed into focused core, passenger
restore, transition, journey, and work-window suites with one small shared
deterministic fixture. The simulation exposes an optional environment-neutral
passenger runtime phase observer. The Node runtime benchmark enables it with
`--profile-passenger-phases` to time emission, access/arrival,
destination/waiting, vehicle transit, and destination-access/completion work.
No timing enters simulation authority, Snapshot V9, Save V7, client V4, or
Worker V4.
The waiting-activation detail remains available after optimization. Its plan
size and per-tick cell-evaluation counters are distinct: a trusted steady-state
activation reports zero plan-preparation cell evaluations even though the
canonical plan still contains all demand cells.
The accepted post-change W1/W12 profiles reduce trusted plan preparation to
approximately 0.007–0.018 ms/tick across Torrevieja, Cartagena, and Málaga.
Ordering/finalization is now the largest waiting-activation child, while the
broader destination/waiting residual is the largest enclosing cost. Those
coordinates remain diagnostic evidence, not additional optimization scope.

Browser-created demo vehicles currently assign a named uniform default of 120
authoritative ticks per edge. The movement model already accepts non-uniform
per-edge durations. Geographic edge length and authoritative travel duration are
distinct; no metres, speeds, traffic, or distance-derived timing model exists.

A production passenger-aware visualization is not complete. The dock exposes
the exact global five-metric summary and compact selected-object context; rich
StopPlace and Vehicle modal projections expose exact waiting, onboard, capacity,
alighting, destination-access, completion, and bounded current-tick authority as
applicable. The browser shell uses a shared Mediterranean cartographic visual
system: maritime navigation, paper surfaces, compact route controls, responsive
entry and detail layouts, and consistent DOM2D/Canvas2D Map chrome. Smooth vehicle
interpolation and richer-scene performance acceptance remain product work.

## Validation command tiers

| Command                    | Purpose                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn validate`            | Normal development gate: format, lint, typecheck, tests, coverage, build, and browser E2E                                                                      |
| `yarn validate:portable`   | Complete portable gate: runtime/line-ending/architecture/manifest/project audits, tests, coverage, critical coverage, build/budgets, E2E, PWA, and subpath PWA |
| `yarn validate:repository` | Git/repository-only tracked-output and clean-tree checks                                                                                                       |
| `yarn build:libraries`     | Builds protocol, transport-domain, and simulation independently                                                                                                |

Use the scripts in root `package.json` as the executable source of truth.

## Foundation Template separation

`foundation-template.json` and `docs/template/` describe the reusable domain-free
Foundation Template snapshot. Current Torrevieja Tycoon HEAD is a transport-game
extension of that foundation and must not be described or tagged as the template
release itself.

## Documentation model

- Current contracts: this file, `AGENTS.md`, architecture principles,
  boundaries, state ownership, and the current roadmap.
- Accepted ADRs: immutable decision records with status and current-applicability
  metadata.
- Historical phase records/prompts: preserve original scope and deferrals; they
  do not describe current HEAD.
- Milestone chronology: `development/milestone-history.md`.
- Foundation Template reference: `docs/template/` and the template contract.

## Road Network V0 presentation

The mandatory ninth ZIP layer, `road-network/road-network.zip`, contains the accepted
Torrevieja-only Workbench catalog and cumulative A/B/C WGS84 LineString products.
No source bytes are rewritten. D3D selects A at far/mini, B at medium and C at near,
using existing camera hysteresis. Catalog semantics, source IDs/classes/counts,
UTF-8 length and SHA-256 are validated before immutable models are cached. The
revision-bound ZIP registry inflates only requested entries. A valid catalog
excluding the selected settlement reports absent coverage. Missing,
unreadable or corrupt required ZIP/catalog infrastructure reports an error, as do
invalid declared products; failed acquisitions may retry. Pending or failed
products retain provisional-city streets and expose diagnostics. Ready road
geometry suppresses provisional streets without
changing city generation, transit routes, selection or simulation.

At most three non-raycasting front-sided batches depict ordinary, bridge and
tunnel linework. Fixed 8/6/4 metre widths and tag-based tones are visual styling,
not surveyed lanes or curbs. Support is 150/50/12.5 metres at A/B/C, bounded at
131,072 segments. Ribbon corners use shared rendered-ground queries, including
10x elevation exaggeration; native/nearest-land/explicit finite fallback behavior
also preserves bridges on water and outside coverage. A 0.22 metre road offset
lies between city ground and canonical transit lines. Grade tags survive unchanged;
no surveyed road-deck height, true tunnel, clearance or topology is claimed.

CPU plans are cached by immutable product, projection and terrain identity.
Each Canvas owns/disposes fresh GPU geometry attributes and shared road materials;
LOD/load changes request dirty frames, while fleet ticks, focus and same-level pan
reuse static buffers. Diagnostics distinguish requested, prepared and drawn levels,
feature counts, geometry builds/batches/vertices/triangles and fallback supports.
The drawn-road acknowledgement is cleared on product/request/scene transitions;
only an active batch after actual rendering may acknowledge its level, once per
host/active presentation. Removed batches cannot republish stale levels.
StreetCell compilation, road/building alignment and additional-city road products
remain deferred; the accepted procedural buildings may intersect source roads.
