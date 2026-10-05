# Torrevieja settlement metadata integration V0

This presentation dataset is research approximation, schema `0.1.0`, with
`needs-review` readiness. It contains 35 sources, 13 research districts, 31
morphology zones, 11 urban profiles, 10 building profiles, 22 landmarks and six
landscape regions. These are not official neighborhood or regulatory boundaries.

The supplied JSON is preserved byte for byte at
`apps/web/public/settlement-metadata/torrevieja/torrevieja-settlement-metadata.v0.json`.
Its SHA-256 is
`703d6aa93e3dcfbc8e3da9b85a4cc466b64401ce39a4f727abf7ff4e8fc2dd9c`.
The public catalogue maps canonical settlement `es-torrevieja` to research city
`torrevieja`. Browser acquisition resolves the application base path, verifies
this checksum, validates references and ranges, and freezes the accepted data.
Acquisition failure or an unsupported settlement leaves generic D3D available.
The JSON is a public runtime asset and is precached for root/subpath offline use.

## Accepted research erratum

The original report and source register are retained unchanged as research
provenance, including their historical containment-validation claim. Architect
acceptance supersedes that claim for runtime integration: landmark district/zone
references express semantic/procedural association, not polygon containment.

Three supplied points fall just outside their associated coarse zone polygons:

| Landmark              | Semantic zone           |
| --------------------- | ----------------------- |
| `lm-eras-sal`         | `z-port-eras`           |
| `lm-palacio-deportes` | `z-north-sports-campus` |
| `lm-hospital-quiron`  | `z-north-sports-campus` |

Every referenced district and zone must exist, and the zone must belong to the
referenced district. Containment is reported diagnostically for every landmark;
there are no ID-specific runtime exceptions. Reservations use the explicit
landmark coordinate, with radius derived from its importance, procedural role
and semantically associated urban profile. No points or polygons were corrected.
Real-package tests assert successful ingestion and these three diagnostics.

## Presentation boundary

Immutable population enrichment retains each canonical cell object, ID, row,
column, geographic center and exact weight. Half-open crop dimensions and total
population are unchanged. All center-point zone overlaps are retained. The
smallest polygon area wins; equal areas use lexical ID order. District context
comes from that zone, and gaps stay unassigned. Lookups prepare private polygon
bounds/areas once per immutable metadata identity; exact ring containment and
overlap ordering remain unchanged. All landscape overlaps are retained, with
`none` before `strongly-constrained` before ordinary buildability.
Hard masks conservatively exclude whole building envelopes and local-street
segments; constrained areas sharply reduce occupancy. Canonical routes remain
untouched even where approximate masks cross them.

Profile dimensions use the same local geographic projection as transport, with
111,320 metres per latitude degree and its existing midpoint-cosine clamp.
Oriented local streets and blocks follow morphology profiles. Each development
uses confidence-bounded orientation drift and parcel grammar: fine grain keeps
four frontage bands around an interior court; detached and compound fabrics use
bounded-depth rows with secondary access where needed. Large plots use service
rows; superblocks retain a single open-yard band. Smaller parcels and higher
mature fill improve urban grain. A one-cell neighborhood kernel smooths derived
presentation support without modifying population values or joining unrelated
zones. Sparse frontiers, constrained land and civic campuses retain open space.
Quiet zone tints separate settlement ground from flat landscape masks.
Bounded, deterministic surface heights avoid depth striping across overlaps.
Water rendering is disabled until a dedicated land/water mask layer is introduced.
The scene emits no blue sea/lagoon surfaces; internal geometry, landscape lookup
and hard buildability masks remain unchanged for future mask integration.
Transport ribbons retain a small symbolic readability floor at far/medium zoom.
Optional metadata acquisition renders transport before city geometry and uses
generic fallback on failure, with population-based framing stable throughout.
Each development chooses a weighted building profile deterministically, then applies that family's
repetition, storey range, footprint scale, setbacks, coverage, open space and
known palette tokens. Population modulates residential occupancy/height; low
nonresidential superblocks can exist without population. Fragmented development
edges retain planned streets with much lower occupancy.

Generated settlement components are connected presentation blocks with their own
identities, distinct from research morphology zones. Canonical routes provide
provisional primary street reservations; generated local streets are geometry
only, with no graph or routing semantics. Twelve semantic families plus a winged
villa and a stepped landmark placeholder use fourteen bounded low-poly prototypes.
Far and medium retain all ordinary buildings while reducing geometry detail;
near adds roofs, and mini retains its one-thirty-second reduction. All resources
have explicit disposal. Generic landmark volumes are merged into the reservation
surface; parks/context-only anchors remain open. These are not detailed assets.

Static cache identity includes map, population, metadata object and checksum.
Fleet, selection, focus, camera and frames do not seed generation. No simulation,
protocol, save, demand or district-gameplay authority changed. Official GIS,
route/road GeoJSON, terrain/elevation, detailed landmarks, passenger D3D and
gameplay district semantics remain deferred.
