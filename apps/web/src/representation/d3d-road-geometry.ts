import { BufferAttribute, BufferGeometry } from 'three';
import {
  d3dMetreScale,
  d3dProjectedPoint,
  type D3dMapModel,
} from './d3d-map-model.js';
import type { D3dTerrain } from './d3d-terrain-model.js';
import type { RoadNetwork } from './road-network.js';
export const roadSupportMetres = Object.freeze({ A: 150, B: 50, C: 12.5 });
const maxSegments = 131072;
export type RoadBatch = Readonly<{
  kind: 'surface' | 'bridge' | 'tunnel';
  positions: Float32Array;
}>;
export type RoadGeometryPlan = Readonly<{
  batches: readonly RoadBatch[];
  vertices: number;
  triangles: number;
  fallbackSupports: number;
}>;
const cache = new WeakMap<
  RoadNetwork,
  WeakMap<D3dMapModel, Map<D3dTerrain | undefined, RoadGeometryPlan>>
>();
/** Fixed visual widths (8/6/4m), not surveyed lanes. 0.22m layer lies above city
 * ground (0.15m) and below transit (0.3m). Unknown grade separation is draped
 * without invented deck heights; no land-only exclusion of bridges/tunnels.
 */
export function prepareD3dRoads(
  roads: RoadNetwork,
  model: D3dMapModel,
  terrain?: D3dTerrain,
): RoadGeometryPlan {
  let projections = cache.get(roads);
  if (!projections) {
    projections = new WeakMap();
    cache.set(roads, projections);
  }
  let worlds = projections.get(model);
  if (!worlds) {
    worlds = new Map();
    projections.set(model, worlds);
  }
  const previous = worlds.get(terrain);
  if (previous) return previous;
  const metre = d3dMetreScale(model).worldUnitsPerMetre,
    step = roadSupportMetres[roads.level] * metre;
  const arrays: Record<RoadBatch['kind'], number[]> = {
    surface: [],
    bridge: [],
    tunnel: [],
  };
  let segments = 0,
    fallbackSupports = 0;
  for (const feature of roads.features) {
    const props = feature.properties;
    const kind =
      props.bridge && props.bridge !== 'no'
        ? 'bridge'
        : props.tunnel && props.tunnel !== 'no'
          ? 'tunnel'
          : 'surface';
    const width =
      (/^(motorway|trunk|primary)/.test(props.highway)
        ? 8
        : /^(secondary|tertiary)/.test(props.highway)
          ? 6
          : 4) * metre;
    const points = feature.geometry.coordinates.map(([longitude, latitude]) =>
      d3dProjectedPoint(model, { longitude, latitude }),
    );
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!,
        length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-10) continue;
      const count = Math.ceil(length / step);
      segments += count;
      if (segments > maxSegments)
        throw new Error('Road geometry support budget exceeded');
      const sx = ((b.z - a.z) * width) / (2 * length),
        sz = ((a.x - b.x) * width) / (2 * length);
      const corner = (t: number, side: number) => {
        const x = a.x + (b.x - a.x) * t + sx * side,
          z = a.z + (b.z - a.z) * t + sz * side;
        const ground = terrain?.ground(x, z);
        if (!ground || ground.diagnostic !== 'native') fallbackSupports++;
        return [x, ground ? ground.y + 0.22 * metre : 0.07, z] as const;
      };
      let left = corner(0, -1),
        right = corner(0, 1);
      for (let j = 0; j < count; j++) {
        const nextLeft = corner((j + 1) / count, -1),
          nextRight = corner((j + 1) / count, 1);
        const quad = [left, right, nextLeft, nextRight];
        for (const index of [0, 2, 1, 1, 2, 3])
          arrays[kind].push(...quad[index]!);
        left = nextLeft;
        right = nextRight;
      }
    }
  }
  const batches = (Object.entries(arrays) as [RoadBatch['kind'], number[]][])
    .filter(([, p]) => p.length > 0)
    .map(([kind, p]) =>
      Object.freeze({ kind, positions: new Float32Array(p) }),
    );
  const vertices = batches.reduce((sum, b) => sum + b.positions.length / 3, 0);
  // The preparation query counter counts distinct strip supports; triangle
  // buffers repeat corners, so report fallback support separately.
  const plan = Object.freeze({
    batches: Object.freeze(batches),
    vertices,
    triangles: vertices / 3,
    fallbackSupports,
  });
  worlds.set(terrain, plan);
  return plan;
}
/** Renderer owns this geometry. Shared CPU arrays remain untouched on disposal. */
export function createRoadGeometry(batch: RoadBatch) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(batch.positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
