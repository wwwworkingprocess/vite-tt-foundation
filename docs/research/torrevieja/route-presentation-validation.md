# Torrevieja Route Presentation V0 — Derivation Validation

## Purpose

This report validates the supplied candidate route-presentation dataset derived from:

- `routes.json` — canonical legacy Route and Pattern authority;
- `stops.json` — canonical StopNode / StopPlace geography;
- `torrevieja-routes-geo.json` — optional source presentation geometry and source colors.

The derived dataset is **presentation enrichment only**. It is not simulation, protocol, Worker, persistence, save, or transport-domain authority.

## Input integrity

| Input | SHA-256 |
|---|---|
| `routes.json` | `bbfdd3bc7916667e58b0b53c985ca7685c766d3acd42f3d1c39273baef661aed` |
| `stops.json` | `cf1e78e76671ccbabec7cb1c05433298730e772eac25b35b4f0c98f2170d10e5` |
| `torrevieja-routes-geo.json` | `50062a03a748179d7cccc5951a2147faf7ffeaa20676885167e014f71659b460` |

Derived artifacts:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `torrevieja-route-presentation.v0.json` | 546,623 | `2b8be7bd45d09cd6c8dd2929e773efde8c402f64d3c8beb0704b56674ae0cd87` |
| `torrevieja-route-presentation.v0.min.json` | 174,551 | `fa0a66fefae89bfd47fca4589b0348b5904a79ff5871b4cde21f82748e637c66` |

The pretty and minified artifacts contain the same JSON value.

## Canonical preservation checks

Passed:

- scenario ID remains `torrevieja-legacy-all-v1`;
- all 8 canonical legacy Route IDs are present;
- all 16 canonical Pattern IDs are present;
- canonical Pattern StopNode ordering is copied unchanged;
- every derived Pattern contains exactly `stop-count - 1` legs;
- every leg starts at its canonical `fromStopNodeId` geographic position;
- every leg ends at its canonical `toStopNodeId` geographic position;
- fallback geometry is always the existing canonical straight stop-to-stop chord;
- all coordinates remain within the Torrevieja-area validation envelope;
- no canonical Route, Pattern, StopNode, or StopPlace is removed or renumbered.

## Derivation result

- Total canonical legs: **244**
- Source-derived road-shape legs: **205**
- Canonical-chord fallbacks: **39**
- Source-derived coverage: **84.0%**
- High-quality source-derived legs: **154**
- Medium-quality source-derived legs: **51**
- Fallback legs: **39**
- Stored route-shape coordinate pairs: **4,001**

The result deliberately does **not** force every canonical legacy leg onto a modern/source corridor. If source geometry is too far away or reconstruction would be dominated by secondary corridors, the leg remains the current canonical chord.

## Pattern coverage

| Route | Direction | Source-derived legs | Fallback legs | High-quality | Medium-quality | Coverage |
|---|---|---:|---:|---:|---:|---:|
| A | Torrevieja - La Mata | 21 | 0 | 20 | 1 | 100.0% |
| A | La Mata - Torrevieja | 23 | 2 | 21 | 2 | 92.0% |
| A2 | Torrevieja - La Mata via Avenida de París | 13 | 0 | 13 | 0 | 100.0% |
| A2 | La Mata - Torrevieja via Avenida de París | 15 | 2 | 14 | 1 | 88.2% |
| B | Torrevieja - Torretas - San Luis | 12 | 6 | 9 | 3 | 66.7% |
| B | San Luis - Torretas - Torrevieja | 15 | 0 | 9 | 6 | 100.0% |
| C | Torrevieja - Lomas | 10 | 6 | 6 | 4 | 62.5% |
| C | Lomas - Torrevieja via Hospital Quirón | 12 | 4 | 8 | 4 | 75.0% |
| D-F | Torrevieja - Los Altos - Rocío del Mar | 16 | 0 | 11 | 5 | 100.0% |
| D-F | Rocío del Mar - Los Altos - Torrevieja | 17 | 0 | 13 | 4 | 100.0% |
| E | Torrevieja - Los Balcones - Lago Jardín | 14 | 8 | 10 | 4 | 63.6% |
| E | Lago Jardín - Los Balcones - Torrevieja | 8 | 0 | 6 | 2 | 100.0% |
| G | Torrevieja - San Luis | 16 | 4 | 7 | 9 | 80.0% |
| G | San Luis - Torrevieja | 7 | 5 | 5 | 2 | 58.3% |
| H | Torrevieja - Friday Market | 3 | 2 | 1 | 2 | 60.0% |
| H | Friday Market - Torrevieja | 3 | 0 | 1 | 2 | 100.0% |

## Route-color crosswalk

| Legacy Route | Presentation source | Color |
|---|---|---|
| A | Línea 08 | `#D32F2F` |
| A2 | Línea 07 | `#F57C00` |
| B | Línea N2 | `#424242` |
| C | Línea 06 | `#800020` |
| D-F | Línea 01 | `#E91E63` |
| E | Línea 02 | `#29B6F6` |
| G | Línea 05 | `#7CB342` |
| H | Línea C1 | `#2E7D32` |

These colors are presentation metadata only. Geometry provenance may contain more than the style source because some legacy corridors are reconstructed through several source lines.

## Important interpretation

`source-derived` means the visible leg follows the supplied source linework while still anchoring to the canonical legacy StopNodes.

It does **not** claim that the modern/source line catalogue is itself the historical legacy-route authority.

The source catalogue and the legacy network are not one-to-one. This is why the derived asset records per-leg provenance and quality, and why unresolved legs remain explicit fallbacks rather than being silently invented.

## Quality policy

Current derivation limits:

- maximum stop-to-source snap: **100 m**;
- maximum accepted detour ratio: **5×**;
- maximum source-network bridge: **60 m**;
- maximum secondary-corridor share: **75%**.

A source-derived leg is marked `high` when it also has restrained snapping, bridging, secondary-corridor use, and detour. Other accepted source-derived legs are marked `medium`.

## Fallback legs requiring future research / better road data

| Route | Direction | From | To | Reason | Snap from | Snap to |
|---|---|---|---|---|---:|---:|
| A | La Mata - Torrevieja | `tv-stop-0101` | `tv-stop-0123` | `mostly-secondary-corridor` | 75.1 m | 93.7 m |
| A | La Mata - Torrevieja | `tv-stop-0123` | `tv-stop-0137` | `mostly-secondary-corridor` | 93.7 m | 7.8 m |
| A2 | La Mata - Torrevieja via Avenida de París | `tv-stop-0101` | `tv-stop-0123` | `mostly-secondary-corridor` | 75.1 m | 93.7 m |
| A2 | La Mata - Torrevieja via Avenida de París | `tv-stop-0123` | `tv-stop-0137` | `mostly-secondary-corridor` | 93.7 m | 7.8 m |
| B | Torrevieja - Torretas - San Luis | `tv-stop-0137` | `tv-stop-0178` | `stop-too-far-from-source` | 7.8 m | 154.5 m |
| B | Torrevieja - Torretas - San Luis | `tv-stop-0178` | `tv-stop-0126` | `stop-too-far-from-source` | 154.5 m | 35.9 m |
| B | Torrevieja - Torretas - San Luis | `tv-stop-0103` | `tv-stop-0092` | `stop-too-far-from-source` | 6.5 m | 149.3 m |
| B | Torrevieja - Torretas - San Luis | `tv-stop-0092` | `tv-stop-0225` | `stop-too-far-from-source` | 149.3 m | 369.9 m |
| B | Torrevieja - Torretas - San Luis | `tv-stop-0225` | `tv-stop-0226` | `stop-too-far-from-source` | 369.9 m | 271.4 m |
| B | Torrevieja - Torretas - San Luis | `tv-stop-0226` | `tv-stop-0227` | `stop-too-far-from-source` | 271.4 m | 6.1 m |
| C | Torrevieja - Lomas | `tv-stop-0153` | `tv-stop-0195` | `stop-too-far-from-source` | 19.8 m | 284.3 m |
| C | Torrevieja - Lomas | `tv-stop-0195` | `tv-stop-0079` | `stop-too-far-from-source` | 284.3 m | 7.7 m |
| C | Torrevieja - Lomas | `tv-stop-0161` | `tv-stop-0221` | `mostly-secondary-corridor` | 57.7 m | 6.6 m |
| C | Torrevieja - Lomas | `tv-stop-0221` | `tv-stop-0114` | `stop-too-far-from-source` | 6.6 m | 197.3 m |
| C | Torrevieja - Lomas | `tv-stop-0114` | `tv-stop-0113` | `stop-too-far-from-source` | 197.3 m | 302.9 m |
| C | Torrevieja - Lomas | `tv-stop-0113` | `tv-stop-0205` | `stop-too-far-from-source` | 302.9 m | 14.5 m |
| C | Lomas - Torrevieja via Hospital Quirón | `tv-stop-0031` | `tv-stop-0194` | `stop-too-far-from-source` | 5.4 m | 295.5 m |
| C | Lomas - Torrevieja via Hospital Quirón | `tv-stop-0194` | `tv-stop-0152` | `stop-too-far-from-source` | 295.5 m | 19.9 m |
| C | Lomas - Torrevieja via Hospital Quirón | `tv-stop-0110` | `tv-stop-0178` | `stop-too-far-from-source` | 4.8 m | 154.5 m |
| C | Lomas - Torrevieja via Hospital Quirón | `tv-stop-0178` | `tv-stop-0126` | `stop-too-far-from-source` | 154.5 m | 35.9 m |
| E | Torrevieja - Los Balcones - Lago Jardín | `tv-stop-0109` | `tv-stop-0027` | `mostly-secondary-corridor` | 3.4 m | 4.6 m |
| E | Torrevieja - Los Balcones - Lago Jardín | `tv-stop-0027` | `tv-stop-0178` | `stop-too-far-from-source` | 4.6 m | 154.5 m |
| E | Torrevieja - Los Balcones - Lago Jardín | `tv-stop-0178` | `tv-stop-0126` | `stop-too-far-from-source` | 154.5 m | 35.9 m |
| E | Torrevieja - Los Balcones - Lago Jardín | `tv-stop-0126` | `tv-stop-0069` | `mostly-secondary-corridor` | 35.9 m | 4.1 m |
| E | Torrevieja - Los Balcones - Lago Jardín | `tv-stop-0060` | `tv-stop-0061` | `stop-too-far-from-source` | 74.3 m | 160.1 m |
| E | Torrevieja - Los Balcones - Lago Jardín | `tv-stop-0061` | `tv-stop-0191` | `stop-too-far-from-source` | 160.1 m | 314.6 m |
| E | Torrevieja - Los Balcones - Lago Jardín | `tv-stop-0191` | `tv-stop-0047` | `stop-too-far-from-source` | 314.6 m | 266.5 m |
| E | Torrevieja - Los Balcones - Lago Jardín | `tv-stop-0047` | `tv-stop-0048` | `stop-too-far-from-source` | 266.5 m | 0.6 m |
| G | Torrevieja - San Luis | `tv-stop-0137` | `tv-stop-0178` | `stop-too-far-from-source` | 7.8 m | 154.5 m |
| G | Torrevieja - San Luis | `tv-stop-0178` | `tv-stop-0126` | `stop-too-far-from-source` | 154.5 m | 35.9 m |
| G | Torrevieja - San Luis | `tv-stop-0176` | `tv-stop-0142` | `stop-too-far-from-source` | 5.9 m | 101.9 m |
| G | Torrevieja - San Luis | `tv-stop-0142` | `tv-stop-0187` | `stop-too-far-from-source` | 101.9 m | 57.1 m |
| G | San Luis - Torrevieja | `tv-stop-0215` | `tv-stop-0039` | `stop-too-far-from-source` | 11.8 m | 424.5 m |
| G | San Luis - Torrevieja | `tv-stop-0039` | `tv-stop-0036` | `stop-too-far-from-source` | 424.5 m | 6.7 m |
| G | San Luis - Torrevieja | `tv-stop-0188` | `tv-stop-0141` | `stop-too-far-from-source` | 1.8 m | 106.7 m |
| G | San Luis - Torrevieja | `tv-stop-0141` | `tv-stop-0175` | `stop-too-far-from-source` | 106.7 m | 6.9 m |
| G | San Luis - Torrevieja | `tv-stop-0123` | `tv-stop-0137` | `mostly-secondary-corridor` | 93.7 m | 7.8 m |
| H | Torrevieja - Friday Market | `tv-stop-0137` | `tv-stop-0178` | `stop-too-far-from-source` | 7.8 m | 154.5 m |
| H | Torrevieja - Friday Market | `tv-stop-0178` | `tv-stop-0126` | `stop-too-far-from-source` | 154.5 m | 35.9 m |

The largest unresolved groups are exactly where a future road GeoJSON or historical route capture would be useful. They should not block this presentation milestone.

## Recommended runtime use

The runtime should consume the minified public asset as an **optional** scenario presentation extension.

For each canonical Route Pattern leg:

1. locate the canonical `fromStopNodeId` / `toStopNodeId`;
2. if the enrichment supplies a `source-derived` leg, render that polyline;
3. otherwise render the current canonical chord;
4. derive the vehicle's presentation position by arc-length interpolation over the same leg using the canonical simulation progress;
5. never rewrite the simulation edge, route, StopNode order, or vehicle state.

## Readiness

This candidate is suitable for the next integration milestone, with one explicit limitation:

> It improves road-following route shape, but does not replace the need for a future general road-network GeoJSON. The 39 fallback legs are intentionally preserved as canonical chords.

