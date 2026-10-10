# D3D maximum-zoom CPU correction

## Measurement context

Local Windows, pinned Node 24.18.0/Yarn 4.17.1, Cypress Electron 138 headless,
Torrevieja all-lines scenario. Git baseline is
`3f911dfdda4ddbeab47fc68d25d8b3db79f1012b` on `main`, with the owner's accepted
uncommitted native-grid/12x-elevation/circular-stop refinement already present.
The comparison preserves that work and changes the presentation multiplier to 10x.
No source terrain or public archives changed.

A finite development-build profile isolates paused maximum-zoom camera pans
from a separate three-second Normal 20x observation. Twelve alternating pans
wait for completed-camera acknowledgement. Cold archive acquisition is outside
measurement. StrictMode causes duplicate preparation/render observations in this
build. The identical camera protocol was used before and after; a later production
run is a separate smoke/profile, not a cross-build timing comparison.

| Measurement                                            |    Before |     After |
| ------------------------------------------------------ | --------: | --------: |
| Grid preparation median                                |  58.15 ms |   2.70 ms |
| Grid preparation maximum                               |  67.90 ms |   9.00 ms |
| Pan command-to-draw median, including Cypress overhead | 371.50 ms | 293.45 ms |
| App renders in three seconds of normal pacing          |       210 |        26 |
| Native runtime samples                                 |   161,680 |   161,680 |
| Near terrain plan triangles                            |   553,692 |   553,692 |
| Near spatial terrain patches                           |        53 |        53 |

Grid CPU preparation fell about 95%; App render observations fell about 88%.
The pan measurement improved about 21% but includes browser/test-runner overhead
and should not be interpreted as input latency or hardware FPS. Median R3F CPU
submission remained approximately 1-2 ms. These observations identify expensive
CPU preparation/UI publication, not a proof that every GPU/camera/device bottleneck
is solved. Native detail, resolution and the frame ceiling were retained.

## Corrections and ownership

- Grid support coordinates/heights are lazy CPU arrays weakly keyed by immutable
  world transform. Overlapping windows project only new native corners. Shared
  edges are emitted by adjacency into exactly sized typed buffers, retaining both
  LAND/WATER coast edges. Each mounted window owns fresh GPU attributes/disposal.
- React's session subscription rejects credit/advanced-total-only publications
  before calling its state setter. Authority, lifecycle, errors, rates and remaining
  bonus ticks remain visible. Full pacing credit/totals remain in the controller
  projection. Deep freezing skips only objects previously recursively frozen by
  that boundary, avoiding repeated walks without trusting external shallow freezes.
- Stops use 10 m radius disks and 20 m selection rings with matching physical hit
  floors. Ground, buildings, routes, entities and the grid share 10x elevation about
  zero. Ordinary object dimensions and metre offsets retain their scale.
- Terrain/color surfaces use cached fixed northwest sun shading: slope modulation
  plus five bounded diagonal horizon probes (1, 2, 4, 8, 16 native cells) for relief
  self-shadow. Vertex colors modulate the existing palette. No live shadow maps,
  textures, DEM changes, per-frame shade preparation or transport color changes.
- The demo grant is 1,200 double-speed ticks, fifty times the previous 24. The bonus
  still doubles the effective rate under the existing pacing policy.

## Reproduction and regression checks

`yarn benchmark:d3d-near` builds production output and runs the finite profile,
including an idle-frame assertion. Results are ignored JSON under
`performance-results/d3d-near-paused.json` and `d3d-near-running.json`.
Development comparisons can use the same spec through `test:e2e` with
`CYPRESS_specPattern=cypress/performance/d3d-near.cy.ts`. Timed camera commands use
the default Cypress timeout; archive acquisition uses the existing terrain spec's
15-second allowance. Observation waits are measurement intervals, not simulation
correctness assumptions. No timing threshold becomes a CI FPS gate.

Behavioral tests cover shared corner reuse, exact native samples/mesh alignment,
water/negative LAND, deterministic shading and scale-specific shade caches,
neutral NoData supports, ground offsets and unchanged route colors, UI filtering,
recursive-freeze reuse and the exact bonus grant. Terrain Cypress covers focus,
pan/zoom, stop/vehicle selection and static-product reuse. The production benchmark passed, including its idle-frame assertion. Focused web coverage passed 801 tests with 100% statements, branches, functions and lines. Ordinary browser and
root/subpath PWA suites remain required by `validate:portable`.

Broader spatial city/route batching and native preparation workers remain later
work. This correction preserves full native near detail and existing per-chunk
culling rather than reducing terrain source or hiding work through resolution,
FPS, forced-click or timeout changes.

## Final validation and budgets

- `yarn validate:portable`: passed, 808.2 seconds.
- Ordinary tests: 1,240 passed across 129 files; web coverage: 801 tests/100 files.
- Every workspace and critical module: 100/100/100/100 exact coverage.
- Web coverage totals: 5,414 statements, 3,241 branches, 1,244 functions, 4,994 lines.
- Architecture: passed, 128 production modules. Manifest, runtime, LF, population,
  build/installability and budget audits passed.
- Browser: all six E2E tests; root offline PWA and subpath offline PWA passed.
- `yarn benchmark:d3d-near`: production profile passed, 60.1 seconds.
- Formatting, lint and types were rechecked after the final PWA assertions changed.
- `yarn audit:tracked` and `git diff --check`: passed.

| Root-build budget coordinate | Accepted working baseline |       After | Unchanged limit |
| ---------------------------- | ------------------------: | ----------: | --------------: |
| D3D JavaScript               |                 958,834 B |   960,255 B |     1,200,000 B |
| Total emitted JavaScript     |               1,775,175 B | 1,776,838 B |     2,000,000 B |

No dependency, budget, Cypress default timeout, simulation, persistence, protocol
or source-product changes were made. The separate production profile measured
2.95 ms median grid preparation and 13 App renders in three seconds; it is not
compared against development-build timing. Near source/plan counts remain native.
The tested maximum-zoom state submitted 9 terrain patches, 50 renderer calls and
854,327 total triangles, including city/route geometry. GPU performance remains
camera/device dependent; broad city/route spatial batching is still future work.

Git remains on `main` at the recorded baseline, matching `origin/main`. The work
is uncommitted and includes the prior accepted uncommitted refinement. No Git
mutation was performed. The clean-tree release gate (`validate:repository`) was
not run; its tracked-output audit was run separately and passed.

## Complete combined worktree file list

The list includes the prior accepted refinement preserved by this task:

```
apps/web/src/App.test.tsx
apps/web/src/App.tsx
apps/web/src/foundation-session-composition.test.ts
apps/web/src/foundation-session-composition.ts
apps/web/src/representation/D3dMapRepresentation.test.tsx
apps/web/src/representation/D3dMapRepresentation.tsx
apps/web/src/representation/d3d-city-geometry.ts
apps/web/src/representation/d3d-map-model.test.ts
apps/web/src/representation/d3d-map-model.ts
apps/web/src/representation/d3d-terrain-geometry.test.ts
apps/web/src/representation/d3d-terrain-geometry.ts
apps/web/src/representation/d3d-terrain-model.test.ts
apps/web/src/representation/d3d-terrain-model.ts
apps/web/src/ui/SimulationControls.tsx
cypress/e2e/foundation.cy.ts
cypress/e2e/pwa-offline.cy.ts
cypress/e2e/terrain.cy.ts
docs/current-state.md
docs/development/roadmap.md
package.json
scripts/foundation-audit.mjs
torrevieja-project.json
apps/web/src/representation/d3d-stop-geometry.test.ts
apps/web/src/representation/d3d-stop-geometry.ts
apps/web/src/representation/d3d-terrain-grid.test.ts
apps/web/src/representation/d3d-terrain-grid.ts
apps/web/src/representation/d3d-terrain-shading.test.ts
apps/web/src/representation/d3d-terrain-shading.ts
cypress/performance/d3d-near.cy.ts
docs/development/d3d-near-performance.md
```
