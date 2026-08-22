# Representation profiling boundary

Browser representation profiling is an opt-in diagnostic boundary. It is disabled
for ordinary product use and enabled only with `?profile-performance=1`. Profiling
samples use the standard browser Performance API under the
`torrevieja.representation.` namespace; they never enter simulation, save, Worker,
scenario, or settings authority.

`yarn benchmark:simulation-runtime` remains the headless simulation baseline.
`yarn benchmark:representation-runtime` builds and previews the production web
application and runs a finite dedicated browser profile. Each variant restarts the
deterministic scenario, warms up, clears previous namespaced entries, then observes
a finite interval and records its start/end simulation ticks.

The browser profile measures:

- raw SVG throttle-wrapper renders separately from accepted expensive SVG-tree
  renders and commits;
- committed SVG render-to-layout-effect latency and committed primitive counts;
- passenger waiting-summary derivation and the isolated passenger StopPlace
  diagnostic subtree's renders and commits;
- population component renders, actual memoized geometry rebuilds, and commits;
- the duration and count of actual manual React Three Fiber `advance` calls.

Render-to-commit measurements include React scheduling and DOM commit latency; they
are not pure JavaScript CPU time. R3F measurements surround the application-visible
manual advance call, not GPU completion. The profiler does not measure exact GPU,
compositor, rasterization, OS scheduling, total process CPU, or energy use. Browser
and headless results therefore provide normalized ingredients for a future
representation/simulation comparison, not a universal CPU percentage.

Machine-specific JSON output is written beneath the ignored
`performance-results/` directory. Timing values are evidence and are never test
thresholds. The profiler observes the existing mini 5 fps and normal 60 fps policy;
it does not control cadence. The expensive SVG tree is downstream of the shared
latest-value throttle, and the memoized passenger StopPlace subtree is insulated
from vehicle-only frames. Reports distinguish physical StopPlaces from rendered
directional passenger-status circles, plus waiting labels, vehicle markers, and
onboard labels.

The representation-isolation change moved the complete mandatory SVG feature
from the previously accepted 5,970 / 6,000-byte coordinate to approximately
7,087 bytes under honest normal bundling. The component boundary is required to
keep expensive reconciliation behind the accepted cadence. After review, the
SVG feature budget was explicitly ratcheted to 7,500 bytes; no mandatory static
dependency is hidden in a separately budgeted or unbudgeted chunk.
