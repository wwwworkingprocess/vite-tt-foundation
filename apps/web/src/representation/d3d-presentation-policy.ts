import type { D3dLodBand } from './d3d-map-model.js';
import type { RepresentationMode } from './representation-cadence.js';
const policies = Object.freeze({
  far: Object.freeze({
    surfaceMetres: 200,
    landscapeMetres: 200,
    routeMetres: 150,
    streets: false,
    landscape: false,
  }),
  medium: Object.freeze({
    surfaceMetres: 100,
    landscapeMetres: 125,
    routeMetres: 75,
    streets: true,
    landscape: true,
  }),
  near: Object.freeze({
    surfaceMetres: 50,
    landscapeMetres: 100,
    routeMetres: 25,
    streets: true,
    landscape: true,
  }),
});
/** Render support only. Native ground queries never depend on this policy. */
export function d3dDrapePolicy(mode: RepresentationMode, lod: D3dLodBand) {
  return policies[mode === 'mini' ? 'far' : lod];
}

/** Safety ceiling, above ordinary LOD preparations. Callers may lower it for
 * bounded jobs, but cannot raise it through the geometry API. */
export const d3dDrapeBudget = Object.freeze({
  maxTriangles: 262144,
  maxDepth: 16,
});
