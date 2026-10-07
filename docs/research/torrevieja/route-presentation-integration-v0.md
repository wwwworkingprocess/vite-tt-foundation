# Route presentation integration V0

The optional runtime candidate is restricted by catalogue to the exact
`torrevieja-legacy-all-v1@1.0.0` coordinate with content hash
`b6891aeb3bff38dcc037d21314f3d623fba83e86150dbd5a6564e7aaf8310c3f`.
Other scenarios, including the default ABC scenario, retain canonical chords
and colors. Missing, corrupt or incompatible enrichment never blocks gameplay.

`apps/web/public/route-presentation/torrevieja/torrevieja-route-presentation.v0.json`
preserves the supplied minified candidate bytes, SHA-256
`fa0a66fefae89bfd47fca4589b0348b5904a79ff5871b4cde21f82748e637c66`.
The original [validation report](route-presentation-validation.md) is research
provenance, not a replacement for runtime canonical validation. Neither the
candidate nor canonical Route/Stop data was regenerated or corrected.

The package contains 8 Routes, 16 Patterns, 244 legs and 4,001 coordinate pairs:
205 source-derived legs and 39 deliberate canonical-chord fallbacks (84.0%
source-derived coverage). Source-line codes are diagnostic associations only.

The checksum-verifying loader validates the complete candidate against canonical
IDs, pattern ownership/order, adjacency, geographic endpoints, colors and
positive lengths. Fallback legs must contain exactly the canonical chord.
Parsed assets are cached by path/checksum and canonical references are validated
for each scenario identity. Quality and provenance remain frozen diagnostics. There is no browser GIS
matching, alternate graph, Stop relocation or inferred traffic legality.

A renderer-neutral cached view projects the supplied vertices and cumulative
local geographic arc lengths once. DOM2D, Canvas2D and D3D consume this same
geometry. Vehicles use canonical edge/progress fractions along the presentation
arc; there is no independent clock. Enriched route focus includes curve extents,
including vertices outside the canonical stop envelope. Selected routes retain
their source color at full opacity, ordinary routes use 0.8 opacity.
The population overlay shares this viewport while retaining canonical cell geometry.

The city generator still receives the canonical projection and keeps its existing
provisional street reservations. Enriched transport ribbons sit above those
surfaces; presentation roads do not become city or simulation road authority.
2D stops use 9 CSS-pixel visible diameter and existing generous hit targets.
D3D platforms/buses retain their accepted physical scale, while camera-facing
vehicle HUDs use 6/12/14 CSS-pixel far/medium/near cues. Mini omits richer HUD
detail and remains noninteractive. HUD clicks select the existing Vehicle.

The audited canonical projection retains an explicit shared chunk; optional
acquisition and geometry are also shared between the lazy renderers and counted
by the total JavaScript ceiling. Static SVG direction geometry is cached in the
projection adapter. No build ceiling, coverage threshold or authority contract
changes. Runtime assets are precached for root and subpath offline use.

Road-network simulation, new city generation, general road GIS integration,
replacement of the 39 research fallbacks, elevation draping and text-rich vehicle
badges remain deferred.
