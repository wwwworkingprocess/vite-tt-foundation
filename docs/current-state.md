# Torrevieja Tycoon — Current State

**Document status:** Current architecture and product-state contract
**Update rule:** This file must match current source and machine-readable
manifests. Historical phase documents and ADR version prose do not override it.

## Current product milestone

D3D normal-mode maps own touch gestures: one-finger pan and two-finger pinch/pan
share the mouse camera bounds and dirty-frame driver. Taps retain canonical
entity selection; drags/pinches suppress accidental picks, and cancelled/lost
pointer capture ends tracking. UI text is non-selectable, while editable fields
retain native selection and panels retain native scrolling.

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
`settlement-metadata`, `street-cells`, `terrain`, `road-network`, and `urban-assets`. Browser acquisition downloads
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
presentation remains available for other settlements. Torrevieja now uses the
C-empty-only composition described below, with no off-cell research-gap fallback. Optional
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

Broad drape support is presentation-only: far/medium/near use 200/100/50 metres for ground/street/reservation surfaces and 150/75/25 metres for routes. City-wide research landscape tints use 200/125/100 metres: their approximate macro polygons do not warrant local ground density. Native terrain-ready views skip research-landscape and settlement-ground geometry entirely, at every LOD and in mini mode; their vertex/triangle diagnostics are zero. The existing no-terrain fallback still draws both surfaces. Far/mini also skip dense provisional streets. Subdivision has a depth-16 limit and a 262,144-triangle preparation ceiling: original faces are reserved, and budget exhaustion retains coarser coverage instead of introducing holes. An input already above that target receives no extra splits. Immutable CPU surface templates include LOD in their cache key; broad layers avoid a second full buffer copy.

Buildings retain their generated footprints/heights and receive sampled anchor
bases. Routes, provisional streets and reservations are draped in presentation space; landmarks keep one sampled anchor rather than
deforming their volume. Stops, vehicles, selection cues and camera diagnostic
pick coordinates use the same ground query with small named metre offsets.
D3D placement samples the same native-center triangle fans as its near terrain
mesh, preventing bilinear-versus-mesh differences from burying objects; native
query interpolation remains bilinear. Corner support is a lazy presentation cache shared across map transforms and native mesh/grid derivations. Ground tints are emitted only on mask land. D3D elevation uses a resolved presentation multiplier (default 5×) about sea level zero, including negative LAND elevations; native heights, mask, queries and statistics remain unchanged. Terrain meshes, shared ground mapping, building/landmark bases, routes, city surfaces, stops, vehicles and selection cues all use the same exaggerated surface. Horizontal dimensions, building heights, vehicle sizes and metre layer offsets are not exaggerated;
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

## Road Network V1 catalog / V0 product presentation

The mandatory ninth ZIP layer, `road-network/road-network.zip`, contains the accepted
Workbench V1 catalog (`road-network-catalog-v1`, version `0.1.0`) and cumulative A/B/C WGS84 LineString V0 products for Alicante, Benidorm, Elche, Málaga, Murcia and Torrevieja. Cartagena is deliberately unlisted. The global policy is unchanged; each settlement owns its products, source provenance and audit. The consumer also accepts the previous single-settlement V0 catalog, normalizing both shapes at acquisition.
No source bytes are rewritten. D3D selects A at far/mini, B at medium and C at near,
using existing camera hysteresis. Catalog semantics, source IDs/classes/counts,
UTF-8 length and SHA-256 are validated before immutable models are cached. The
revision-bound ZIP registry inflates only requested entries; the loader caches by settlement, level and content hash. Catalog validation checks all descriptors/provenance, while only the active city/level product is inflated and decoded. Torrevieja A/B/C payloads remain byte-identical to the accepted V0 package. A valid catalog
excluding the selected settlement reports absent coverage. Missing,
unreadable or corrupt required ZIP/catalog infrastructure reports an error, as do
invalid declared products; failed acquisitions may retry. Pending or failed
products expose diagnostics. Other cities retain provisional-city streets;
Torrevieja C-empty composition suppresses superseded procedural streets. Ready road
geometry suppresses provisional streets without
changing city generation, transit routes, selection or simulation.

At most three non-raycasting front-sided batches depict ordinary, bridge and
tunnel linework. Fixed 8/6/4 metre widths and tag-based tones are visual styling,
not surveyed lanes or curbs. Support is 150/50/12.5 metres at A/B/C, bounded at
131,072 segments. Ribbon corners use shared rendered-ground queries, including
resolved elevation exaggeration; native/nearest-land/explicit finite fallback behavior
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
Cartagena road products and road-crossed cell generation remain deferred.
Other cities retain their legacy procedural building path, which may intersect
source roads; Torrevieja ordinary buildings now require eligible C safe zones.

Native DEM clean-ground presentation omits optional research/density tint meshes before geometry preparation. All pure city-model polygons, land-use/buildability exclusions, population inputs, generated building identities, landmark reservations and transport overlays remain intact. These surface descriptors remain available for fallback rendering and later StreetCells; they do not define city-generation authority.

The full Málaga and Murcia C products currently exceed the unchanged 131,072-segment road preparation guard; those near views expose a preparation error and retain provisional streets. Their A/B products and all six catalog/product acquisitions remain supported. Bounded delivery of the larger C geometry requires a separately accepted road preparation change; this catalog integration does not raise geometry or JS budgets.

## StreetCells V4 multi-city masks and A/B/C inspection

The tenth mandatory on-demand ZIP remains `street-cells/street-cells.zip`.
The installed Workbench `street-cells-catalog-v4` / `0.4.0` covers Torrevieja,
Alicante and Elche. Its exact owner-supplied ZIP is 6,031,239 bytes, SHA-256
`e25c3f6bc0c4e134dc3f0d2683b86a7492df8ebbe7c01cd9e5e7bbf9ac5b8164`.
All eighteen underlying V3 polygon/hierarchy/annotation/audit entries remain
byte-identical. The owner staging copy is preserved and never published.
Coverage is catalog-derived; an unlisted city is absent, while a missing/broken
required ZIP/catalog or declared product is an error with gameplay preserved.

Normal D3D with ready native terrain uses the existing far/medium/near hysteresis
to request A/B/C respectively. Mini and unavailable terrain remain inactive.
Only the selected city's selected polygon product is decoded; C additionally
reads that city's annotations plus verified typed masks/references. Hierarchy, audit and source-road products are not
routine runtime reads. Byte lengths/SHA-256, exact policies, city-local paths,
city/level IDs, measurements, closed rings/holes and annotation references are
validated. Successful immutable models share revision-bound acquisition and
city/level/hash caches; failures retry and stale city/level results are rejected.
The public registry remains ten layers; unused ZIPs are not startup precache.

Original C polygons, IDs, measurements, holes and road references remain exact.
A/B display the actual exported coarsened polygons, deduplicating identical
undirected shared edges. C joins compact annotations by stable cell ID and draws
supplied `safeZoneCoordinates`, including holes, for `empty` and `road-crossed`.
The temporary game-side 8-metre inset is removed. No margins, polygon merging,
setbacks or road corridors are recalculated in the game. `empty` is a Workbench
road classification, not an assertion about buildings or buildability.
Torrevieja displays 1,437 safe-zone cells (1,126 empty / 311 road-crossed), retaining
186 non-drawables as semantic cells. Alicante displays 2,759 (2,378 / 381), retaining
442 non-drawables. Named immutable annotation access preserves representative
points, road-width margins, classification reasons and clipped road associations
for future reviewed uses, without rendering those associations.

One static non-raycasting violet LineSegments batch per active product follows
the same projection and exaggerated native ground as roads. Every support is
sampled at at most 12.5-metre spacing, with the named unscaled 0.50-metre visual
clearance (+0.28 above roads / +0.20 above transit at coincident supports).
Opacity 0.88, depth testing, disabled depth writes and render order 2 retain
single-pixel contrast and normal building occlusion. There are no fills, per-cell
objects, toggles or additional authority in the outline layer. The separate
two-city composition below consumes the same immutable C model.

The unchanged 262,144-segment preparation guard rejects excessive products
without partially dropping cells. Reference native plans measure:

| City       | Level | Display cells | Segments | GPU vertices | Float32 position bytes |
| ---------- | ----- | ------------: | -------: | -----------: | ---------------------: |
| Torrevieja | A     |            84 |   11,674 |       23,348 |                280,176 |
| Torrevieja | B     |           584 |   25,289 |       50,578 |                606,936 |
| Torrevieja | C     |         1,437 |  107,052 |      214,104 |              2,569,248 |
| Alicante   | A     |           348 |   28,112 |       56,224 |                674,688 |
| Alicante   | B     |         1,411 |   51,985 |      103,970 |              1,247,640 |
| Alicante   | C     |         2,759 |  184,541 |      369,082 |              4,428,984 |

These use native coverage-derived reference projections; counts can vary slightly
with scenario bounds. Original polygon coordinates remain exact. Workbench V3 annotations use the
validated seven-decimal WGS84 encoding and declared 0.021-metre serialization
tolerance; the game does not re-encode or repair them.
CPU plans cache by immutable product/map/terrain identity; each scene owns and
disposes fresh GPU geometry/material. Fleet, selection and same-band pan reuse
static buffers. Diagnostics distinguish source/display counts, declared
non-drawables, edges/supports/vertices/bytes/builds and actual A/B/C draw
acknowledgement. Stale Canvas callbacks cannot publish old levels; unchanged
acknowledgements do not rewrite the DOM. Existing dirty-frame scheduling remains.
Offline integrity checks cover all descriptors and source-road provenance;
hierarchy tests prove exact shared-edge footprint cancellation and conserved
metric area, without browser topology compilation.

The outline layer remains a visual consumer. Two-city C-empty composition is
now the bounded presentation pass below. Authoritative buildability, topology repair, additional exports and hierarchy-driven city generation
remain separately reviewed work. Native terrain,
clean-ground policy, road products, canonical transit and simulation are unchanged.

## StreetCell C-empty procedural buildings — research-independent V3

Torrevieja and Alicante share one C-owned ordinary-building composer. Supplied
`empty` C safe zones decide **where**, native geography and explicit physical
reservations govern safety, population and observed footprint evidence modulate
**quantity**, and optional research assigns **appearance**. Road-crossed cells now use the bounded Pass 2 below; non-drawable cells remain excluded. Other settlements without C coverage retain
their prior generic presentation. The canonical population, terrain, transport,
Worker, simulation and persistence contracts are unchanged.

C building demand remains independent of outline A/B/C LOD and normal/mini mode;
it shares revision-bound ZIP/model acquisition. These two cities never fall back
to off-cell ordinary buildings while C or native terrain is unavailable. Available
research can still display landscapes/reservations, while roads, transit,
selection and cameras remain operational. No Workbench or exported polygons are
modified, and no runtime inset is applied to the supplied safe zones.

V3 decoding validates the numeric C suffix, exact tuple headers, coordinate
precision, policy, paths, hashes, one-to-one C join and building evidence.
Torrevieja/Alicante evidence is partial: observations are lower bounds, not a
census or generation target. All 4,824 cells preserve null estimated-count and
desired-coverage fields. Unavailable observations remain null; measured zero is
distinct. Empty-class safe representative observations total 10,591 / 13,852,
with 9,544 / 9,928 fully contained source features. Intersections are associations
and are not summed as unique buildings. No raw building-footprint runtime asset
or additional data authority is installed.

Immutable slots are cached separately from optional recipes. The same source,
population, terrain and independently supplied physical reservations produce the
same IDs, counts, positions, dimensions and orientations with research present,
absent or partial. Missing zones and unsupported profile contexts cannot erase a
slot. Existing generic families provide defaults; available research contributes
its supported archetypes, storeys, palettes and villa prototypes. Research
coarse sea/lagoon/morphology predicates no longer gate construction. Overlap of
observed development with coarse research restrictions is reported for authority
review, not interpreted as surveyed protection or permission. Validated landmark
coordinates still supply explicit physical reservations; changing those is a
geographic-input change, separate from toggling appearance. Genuine explicitly
supplied protection polygons remain exclusions.

Quantity uses frontage rows and street-aligned interior bands. Calibrated
urban/suburban footprint ranges retain the accepted offline reference
`building.geojson` SHA-256
`6f28934613fef4531d0a4bb43fae19f802d89f9686afb0bbe0d94a0a4c4cc601`.
Observed union area per safe representative adjusts footprint scale within
0.75–1.6 times those ranges. Source coverage/count and population intensity select
denser urban or spaced suburban packing; coverage is bounded at 60%. These are
local game heuristics, not Workbench estimates. Null evidence uses population
support; trusted observed buildings permit construction at true zero population.
Cropped/out-of-grid/unsupported tiles are diagnosed as unknown, not zero.
Interior positive population tiles are considered even when boundary probes miss
them. Canonical weights and demand remain untouched.

Every full rotated envelope must lie inside both safe and original polygons,
excluding holes, concave crossings and millimetre boundary contacts. Every
intersected native WATER raster cell excludes it; negative finite LAND is allowed.
Native viewport bounds, actual transit corridors, StopPlaces, explicit landmarks
and protection polygons remain hard checks. Cell-local indexes reject collisions.
Incremental proposals stop when a local count/coverage bound is reached, with a
compact retry for unfilled residual cells. The 65,536 global proposal guard and
all rendering budgets remain unchanged. No full unused proposal arrays are
allocated; out-of-viewport candidate preparation is avoided.

The all-lines Torrevieja plan currently has 8,407 buildings in 894 of 1,126 empty
cells, versus 2,486 / 407 before V3. Alicante core has 8,461 in 1,210 of 2,378;
its active native viewport covers only part of the full C export. These occupied
counts are not a usable-cell denominator. The ignored delivery ledger separately
records source class, safe area, population availability, observations, geometric
witnesses, targets and rejection reasons. A witness found during proposals is a
positive geometry diagnostic; failure to find one is not proof of unusability.
Independent geometry-only and physical/source-coverage denominators accompany
acceptance, including unresolved cases. Candidate rejection totals never stand in
for skipped-cell totals. The post-composition footprint/class audit is zero for
both cities.

Existing instanced bodies/roofs, mini reduction, native grounding at the resolved presentation scale, stable
cell provenance and scene-owned GPU disposal remain. Slot caches include immutable
map/population/C/terrain/protection identity; recipe caches additionally include
research identity/hash. Fleet, selection, same-band pan and outline LOD do not
repack. Current local cold preparation measured approximately 1.7 / 2.5 seconds,
with cached lookups around 0.009 milliseconds; these are setup observations, not
CI FPS thresholds. Root/subpath lazy ZIP/PWA and truthful line-draw acknowledgements
remain part of acceptance.

Additional art/families, surveyed reconstruction, authoritative
parcel/setback calculation, blueprint compilation, further exports and Workbench
performance work remain deferred.

## StreetCell road-crossed Pass 2

The same C-owned composer now processes Torrevieja and Alicante road-crossed
cells after the empty-cell pass. The accepted Pass-2 baseline preserved Pass-1
slots; the urban-frontage refinement below intentionally supersedes those layout pins. Supplied C polygons, safe zones, population, terrain
and all ZIP products remain unchanged. A/B remain visual coarsenings only.

Clipped at-grade internal roads seed two-sided tangent-aligned frontage rows;
corridor-support and short records reserve space without seeding frontage.
Grade-separated and non-drawable-candidate records do neither. Validated road
width provenance is retained: half the declared estimated width plus 2 metres
per side reserves pedestrian clearance. Segment rectangles and conservative
circumscribed octagonal caps cover joints, turns and intersections. Collinear
contiguous pieces of the same road join deterministically for layout; exclusions
retain every source segment. The supplied perimeter safe zone is not inset again.
Full rotated envelopes must avoid the indexed union of these reservations in
addition to all previous polygon, hole, native WATER, transit, StopPlace,
landmark, protection and building-collision checks. No runtime polygon export,
subdivision authority or new rendering pipeline is introduced.

The unchanged 65,536-proposal global guard processes Pass 1 first. Remaining
capacity is divided among remaining road-crossed cells; unused allowances are
redistributed in deterministic source order. Budget-limited cells remain explicit
in the ledger rather than silently raising the cap. Optional research still only
changes appearance after slots freeze. Pending native terrain/C retains the
existing fallback lifecycle and no provisional streets are reintroduced.

The accepted Pass-2 baseline retained Pass 1 at 8,407 / 894 occupied Torrevieja
empty cells and 8,461 / 1,210 Alicante core empty cells. Pass 2 adds 4,534
buildings in 277 of 311 Torrevieja road-crossed cells and 1,983 in 200 of 381
Alicante cells. These are generated counts, distinct from partial observed safe
representative evidence (10,423 / 4,468). Remaining cells and partially filled
budget-limited cells are not declared unbuildable. The native Alicante core
viewport excludes much of its broader export. No 90–95% occupancy claim is made.
Matched Torrevieja urban/high-guide views retain 49 / 48 draw calls, and the
overview retains 29; additional buildings increase instanced triangles.

Read-only `data-cell-buildings-pass1` and `data-cell-buildings-pass2` summarize
separate building, occupied-cell, proposal and guide/reservation counts. The
existing occupied-empty diagnostic retains its Pass-1 meaning. Per-cell ledgers
add proposed counts, allowances and guide/reservation counts; omission/rejection
reasons remain inspectable. Static CPU plans retain immutable authority caches;
GPU bodies/roofs retain instancing, native grounding at the resolved presentation scale and scene disposal.
Further diversity, authoritative parcels/setbacks and Workbench processing remain
deferred.

## D3D application settings and StreetCell hardening

`apps/web/src/representation/d3d-app-settings.ts` is a typed, checked-in presentation
policy, applied on rebuild. Purple StreetCell A/B/C inspection outlines are off
by default: no outline product request, CPU preparation or GPU line/material batch
is made. Required lazy C building inputs remain independent; Torrevieja and
Alicante retain their accepted empty and road-crossed composition. Hidden-outline
status is distinct from the C building-input status and errors; actual-draw
acknowledgements remain empty while hidden. Native terrain debug grid is a separate
maximum-zoom diagnostic and is unaffected by the purple-outline setting.

Relief defaults to 5x about sea level with optional per-settlement overrides and a
5x fallback for future city IDs. Terrain instance caches include the resolved scale;
mesh vertices, shading, bounds, ground anchors, roads, transit, grid and buildings
share that instance. Native DEM/mask, horizontal metres, building dimensions and
layer clearance offsets remain unchanged. Safety guards remain 65,536 lot proposals
and 262,144 displayed StreetCell segments; line support remains 12.5 metres.

Cold preparation avoids per-cell copies of city-wide road metadata and uses
immutable polygon row/envelope prefilters before unchanged exact full-footprint
predicates. Complete two-pass physical-slot hashes and previous Pass-1 pins are
regression-tested for both cities. Its accepted 12,941 / 10,444 counts are
superseded by the frontage refinement below. Existing prototype
families and muted palettes now repeat coherently by stable cell/orientation/row;
optional research affects only appearance. No extra per-building meshes/materials,
new geography, density policy or runtime settings UI is introduced. Further
incremental preparation, residual packing and architectural diversity remain deferred.

Owner editing guide: set `streetCells.showBoundaries` for purple inspection lines;
set `terrain.defaultVerticalExaggeration` or `verticalExaggerationByCity` for relief;
then rebuild and run the existing validation gates. Limits are validated positive
integers, scale is finite in (0, 50], and city override keys use settlement IDs.

## Rendered terrain shoreline closure

Cached terrain LAND patches now include front-sided vertical closure only at
adjacent displayed WATER blocks. Upper supports copy the exact rendered LAND
edge at the active stride; the other edge is sea level zero. Sign-changing edges
split at zero; coincident zero edges add nothing. Separate wall vertices preserve
existing top normals and shading. Native data, interpolation/anchors, 5x settings,
coastline products and source mask are unchanged. Display classification drives
far/medium/near adjacency, with no walls between LAND chunks or at outer coverage
edges. Shared materials, draw calls, caching and disposal remain unchanged.
Torrevieja adds 26 / 80 / 1,361 triangles at far / medium / near; original top
faces remain exactly 8,690 / 34,772 / 553,692. Raster jaggedness is retained;
surveyed coastline reconstruction and waterfront art remain deferred.

## City Materialization V0 (review candidate)

Torrevieja's optional `urban-assets` city collection references a versioned
`materialization/catalog.v0.json`; collection paths remain city-relative, while
its geometry and shared-kit paths are ZIP-root-relative. Acquisition uses the
existing revision-bound public layer, verifies geometry SHA-256 before decoding,
and caches successful city/LOD models. Missing collections are normal; corrupt
active data is diagnosed without replacing source geography. Normal D3D with
native terrain presents far/medium/near recipes; mini and other representations
remain unchanged. Static CPU plans and scene-owned GPU batches are reused through
fleet, selection and within-band camera updates. Actual-draw acknowledgement is
cleared on scene, city and LOD transitions.

The installed verified examples are Laguna Rosa (R14660913), Playa del Cura
(W151884902), Torre del Moro (W1092710852) and Sociedad Cultural Casino
(W480233467). Read-only local OSM inventory additionally supplies Friday market
(R14503849), Parque de las Naciones (R14960789), Eras de la Sal theatre extent
(W320790561) and Marina Internacional (R19987857). OSM provenance and ODbL
licensing are retained. Tower/Casino kits are deliberately approximate proxies.
Eras is an extent treatment, not a historic-structure reconstruction; the marina
extent is not the entire port; its broad area fill is now suppressed while metadata
and source diagnostics remain. Verified mooring layout suitable for boat centers
and detailed Eras structure geometry remain unavailable. No invented guides or
buffered POI extents are substituted.

All recipes are `visual-only`: no ordinary building, footprint, assignment,
reservation, terrain mask, DEM sample or transport authority is changed. Existing
ordinary buildings overlap the Casino and park graphics; diagnostics report those
IDs rather than removing them. Legacy landmark placeholders also remain intact.
Native mask/source discrepancies are reported: Rosa's verified water extent
samples LAND in the native raster; its polygon tint uses `native-both`. Beach sand
currently retains the supplied LAND-only policy. Large surfaces are clipped to
the native loaded region and use bounded presentation support, not full-resolution
site meshes. Preparation guards are 131,072 triangles, 4,096 repeated instances
32 draw batches globally, and 65,536 proposals per site. Unsupported GLB entries are diagnosed and skipped.

`apps/web/src/representation/d3d-material-presets.ts` owns surface, terrain and kit
colors outside numeric geometry planning. Torrevieja presets independently reserve
Rosa pink `#B7A2A7`, La Mata green-turquoise `#408E89`, Mediterranean blue `#527F96`,
shallow-water turquoise `#43B8C6`, and sand/mineral `#E6D8B5`. La Mata and shallow
water presets do not invent missing geographic shapes or bands. Satellite textures,
shoreline gradients, reviewed physical reservations, GLB loading and a Workbench
producer/UI remain deferred.

### Narrow V0 visual correction (owner review)

The verified Marina Internacional R19987857 extent produced a distracting pale
water block. Its site surface is disabled by city-local presentation policy;
Mediterranean/native WATER and coast geometry remain unchanged. No inferred
piers, boats or substitute water boundaries are introduced.

Rosa remains opaque, one-sided and terrain-following, with configurable muted
pink and bounded +/-4.5% world-space regional tone modulation. Neutral vertex
weights are separate from palette values; they do not alter the polygon or DEM.
La Mata remains deferred: the accessible water extracts identify Rosa R14660913,
while unnamed R14667851/R14660916 are tagged river. No unambiguous La Mata lagoon
extent was found; its reserved color remains unchanged.

Market row recipes now select separated rows and progressively distributed
columns before exhausting the accepted-instance cap. The verified market uses
10-metre along-row spacing, 20-metre aisle pitch and 8-by-6-metre canopy proxies,
retaining a bounded 80/160 B/C subset and exact B-prefix-of-C identity. Full envelopes,
holes, native grounding and proposal guards remain enforced. Park tree layout,
other verified proxies, ordinary city building records and physical authorities
are unchanged. These are static visual rows, with no calendar or temporal logic.

The bounded market ground also uses 25 m drape support at medium LOD, so coarse overlay faces do not hide native-grounded canopy roofs. Other site surfaces retain their existing presentation LOD.

## StreetCell urban perimeters, floor profiles and near façades

The existing C-owned composer now offers internal and exterior frontage spans in
bounded round-robin order, starting near each span's middle. Exhausted spans leave
the active list; work is linear in bounded candidate supports rather than repeatedly
scanning dead guides. The 65,536-proposal global guard and Pass-2 equal-share
admission remain. A 0.75-metre proposal setback accommodates the bounded deviation
of merged safe-zone edges and avoids touching reserved internal-road boundaries.
It does not shrink, export or replace safe zones or change road reservations.
Every expanded rotated envelope still passes original/safe polygon, hole, native
LAND, transport/stop/protection, corridor and collision checks.

A longest-edge oriented bounding rectangle supplies a soft rectangularity signal.
Urban, hole-free empty cells with rectangularity at least 0.82 and more than two
building depths plus 12 metres across retain frontage-only rows and an open inner
court. Irregular, narrow and hole-bearing cells retain partial frontages and the
existing bounded interior fallback. Observed footprint evidence and canonical
population support still determine urban/suburban intensity, quantity and coverage;
research is not an eligibility gate. Suburban frontage spacing is 2 metres where
positive observed evidence and intensity support terraces, otherwise 4 metres;
urban spacing remains 1 metre, in addition to the checked envelope separation.
No hardcoded geographic city center or new population/parcel authority is added.

Current normal-city plans contain 17,562 Torrevieja buildings (8,878 empty-cell /
8,684 crossed-cell), 13,804 Alicante (9,331 / 4,473), and 7,139 Elche (4,831 / 2,308)
from the installed three-city C inputs. Torrevieja crossed-cell occupancy is 308/311;
Alicante is 226/381, within its loaded core viewport; Elche is 76/243. These are
render-generation observations, not OSM reconstruction or a revised eligible-cell
denominator. New frontage IDs encode immutable cell/span/sample identity. Unchanged
interior physical slots retain their legacy IDs; ordered placement hashes are newly
pinned and research-present/absent placement remains identical. Per-cell ledgers
record fabric, rectangularity, courtyard choice, rectangle footprint coverage,
reserved frontage length, accepted span counts and physical rejection reasons.

Rows receive stable cell/orientation/row-seeded floors: dense urban recipes commonly
select five, with three through six alternatives; suburban recipes typically select
one or two, with exceptional four/five only at higher local intensity. Optional
research appearance clamps these choices to its compatible family limits. Height
remains storeys × 3.1 metres × horizontal world scale, on native ground; C-owned
silhouettes retain that height at all LODs. Research may change aesthetic recipes
and heights within family ranges, never physical slot counts or coordinates.

`city.nearFacades` in the existing checked-in settings defaults true. Near body
batches extend shared Lambert shading using local positions/normals and a compact
four-float instance attribute (floors, metre width/depth, dense-pattern flag).
Wall-only floor/window/balcony shading needs no UVs, textures, protruding objects or
extra window draw calls. Roof batches stay plain; far/mini/medium omit the attribute
and shader extension. Derivative antialiasing fades unresolved patterns at distance.
Each scene owns and disposes its geometry/material with attributes still attached;
fleet, selection and within-band pan retain static plans and GPU buffers.

All ten public ZIPs, POI geometries/recipes, source C geography, roads, native DEM,
simulation and persistence are unchanged. POI sites remain visual-only: refined
ordinary buildings increase diagnosed Casino/park/market overlaps (6/27/21).
No unreviewed site extent becomes a physical reservation. More buildings increase
cold composition, memory and submitted triangles; shared prototype batch count is
unchanged. Physical POI reservations, richer courtyard grammar, additional families
and broader city optimization require separate review.

## StreetCells V4 typed exclusion and visual covers

The independent six-type registry is pinned by version, semantics and SHA-256.
City-local descriptors, mask Polygon rings/holes, source identities, source selector
availability, audit inventories and complete stable numeric C-ID joins are validated.
Only requested C decoding inflates the selected city's masks and reference file;
A/B outline reads do not. Missing/corrupt declared data is an error with retry and
stale-request protection, not an empty inventory or permission to reuse another city.
Torrevieja exports 1,000 masks / 425 associated C cells (179 capacity omissions),
Elche 919 / 246 with two missing selectors, Alicante zero with all six unavailable.
Available means available source selectors, not complete zoning or uncapped coverage.

Both existing placement passes check each actual rotated building body against the
referenced polygons, including holes, with the existing 1 mm tolerance. A referenced
cell is not automatically excluded. Exact footprint admission remains authoritative;
a cached 32x32 union quadrature only estimates remaining capacity, without overlapping
mask double-counting. The accepted unmasked proposal allocation freezes unrelated
cell records/IDs; affected cells are recomposed under the same physical guards and
65,536-proposal cap. A short-lived immutable physical-query cache excludes mask,
collision and coverage decisions. The per-cell ledger records safe area, associated
IDs/types, approximate remaining/masked area, proposals, reasons and accepted count.
Research remains appearance-only with fixed real protection inputs.

Reference native plans change Torrevieja 17,562 -> 16,231 buildings (8,219 Pass 1,
8,012 Pass 2), Elche urban 7,139 -> 6,510 (4,513 / 1,997); Alicante retains all
13,804 exact records. Real-data tests check zero full-body conflicts against all
exported masks and exact unchanged unassociated records. These are exported-mask
restrictions, not claims that missing OSM coverage is developable.

Typed covers default on via `d3d-app-settings.ts`; purple outlines remain off and
native relief remains 5x. Configurable muted palettes reside in
`d3d-material-presets.ts`, separate from geometry. One source feature is planned
once, not once per C association. Shared hole-aware topology validation and
native-face clipping attach visual faces to the displayed terrain and reject support
outside the actual native raster;
non-water covers also reject native-water supports without changing classifications.
Far/medium/near minimum areas are 1,000/100/0 m²; covers clip to the displayed native
terrain faces at the existing LOD.
Interior native faces are reused directly. Boundary rings clip once where their
intersection remains simple; disconnected concavities/opened holes use exact
source-triangle intersections. This avoids both floating chords and unnecessary
internal triangulation fragments. A temporary numeric spatial index is restricted
to potential visible source regions and released after preparation.
The per-feature/global triangle guards remain 8,192/65,536; deterministic failures have
IDs/messages in host diagnostics. Real near plans use 51,402 Torrevieja triangles
and 26,171 Elche triangles without budget failures. There are at most six non-raycasting one-sided
Lambert batches, +0.04 m unexaggerated clearance, no depth writes. Native terrain
renders first; grass, recreation, garden, park, wood, water have fixed draw priority;
roads/buildings/verified sites render afterward. Verified source-identical POI sites
suppress generic covers (including Rosa and Parque de las Naciones).

Immutable CPU plans cache by mask/map/native terrain/site/LOD identity. Mounted scenes
own/dispose GPU buffers and materials. Fleet, selection and same-band pan retain plans;
render acknowledgements clear on transitions and only actual active batches publish,
without repeated DOM mutation. Detached Canvas cleanup closes its own frame driver
without clearing a replacement root's shared driver reference. Initial cold C-city
and typed-cover preparation follow the first actual native terrain draw, allowing
the surface and optional site acquisition to commit first. A guarded terrain-instance
handshake updates once, rejects detached callbacks and resets on native replacement;
LOD, pan and fleet do not reschedule composition. Research loading/absence/error
remain supported and final model inputs, counts and footprints are unchanged. Host diagnostics expose source availability, omissions,
mask rejections/conflicts and cover features/triangles/bytes/batches/builds/failures.

La Mata Q115094064 remains deferred: only 40.697% of the supplied exact polygon's
projected area lies within the accepted native raster. Presentation bounding-box
coverage (63.128%) is not native coverage. No lake/site or urban-assets ZIP change
was made. A follow-up requires native extent/source provenance approval and a verified
site export; neither the supplied polygon nor DEM may be stretched or invented.

### Mediterranean typed-land detail (Landscape V1)

A separate visual-only landscape plan materializes V4 woods, parks, gardens, grass
and recreation masks; inland water receives no plants. Six deterministic recipes
combine palm, olive, carob, succulent and dry scrub silhouettes. No conifers or
unverified playground/sports amenities are inferred. Per-mask style/uint32 seed
overrides live in `representation/d3d-landscape-policy.ts`; muted per-instance
trunk/foliage palettes live in `d3d-material-presets.ts`. These are checked-in
presentation settings, not ZIP/schema/save/UI authority.

Whole decorative envelopes retain exact source rings/holes, native LAND, existing
C-safe/perimeter and at-grade internal-road clearance, actual building/transport
reservations and custom-site precedence. C safe zones supply conservative road
clearance evidence only; no class/quantity/ordinary-building decision is changed.
Unsupported areas may remain undecorated with named diagnostics. Displayed-face
barycentric anchors share the existing bounded native terrain index; source DEM
and the six typed-cover faces are unchanged.

Far has no ornaments. Medium is a stable ranked tree-only subset of near. Separate
limits are 32,768 proposals overall / 512 per mask, 2,000 instances / 40,000 triangles
medium, and 8,000 / 180,000 near. Instance ceilings count GPU part slots
(a tree consumes two); logical plant counts are reported separately. At most eight shared instanced batches use one
white Lambert material and real instanceColor attributes; color choice does not
move a slot. Existing cover, site, city and build budgets remain unchanged. CPU
plans are weakly cached; scene-owned GPU resources dispose on replacement, and
read-only draw acknowledgements reject stale roots. No ordinary building color
shader changes, foliage animation, La Mata or terrain-coverage extension is included.
