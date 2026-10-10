import {
  beginRepresentationProfile,
  finishRepresentationProfile,
} from '../performance/representation-profiler.js';
import { BufferAttribute, BufferGeometry } from 'three';
import { geographicToTerrain } from '../terrain/terrain-projection.js';
import { d3dGeographicPoint, type D3dMapModel } from './d3d-map-model.js';
import {
  d3dTerrainElevationScale,
  terrainRenderCorner,
  type D3dTerrain,
} from './d3d-terrain-model.js';
import type { RepresentationMode } from './representation-cadence.js';
export type TerrainGridWindow = Readonly<{
  col: number;
  row: number;
  endCol: number;
  endRow: number;
}>;
export function maximumD3dZoom(
  mode: RepresentationMode,
  zoom: number,
  maxZoom: number,
) {
  return mode === 'normal' && zoom >= maxZoom * (1 - 1e-6);
}
/** Screen footprint of the orthographic 35-degree camera, including the full
 * displayed height range. Snap to native cells so sub-cell pan reuses buffers.
 * Only requested at capped zoom; no full-city wireframe is prepared. */
export function terrainGridWindow(
  world: D3dTerrain,
  model: D3dMapModel,
  camera: Readonly<{
    x: number;
    z: number;
    zoom: number;
    width: number;
    height: number;
  }>,
): TerrainGridWindow | undefined {
  const a = (35 * Math.PI) / 180,
    halfHeight = 10 / camera.zoom,
    halfWidth = (halfHeight * camera.width) / Math.max(1, camera.height);
  const { rasterBounds3035: b, width, height } = world.terrain.viewport;
  let minCol = Infinity,
    minRow = Infinity,
    maxCol = -Infinity,
    maxRow = -Infinity;
  for (const side of [-halfWidth, halfWidth])
    for (const up of [-halfHeight, halfHeight])
      for (const y of [world.bounds.minY, world.bounds.maxY]) {
        const forward = (y * Math.cos(a) - up) / Math.sin(a);
        const p = geographicToTerrain(
          d3dGeographicPoint(model, {
            x: camera.x + (side + forward) * Math.SQRT1_2,
            z: camera.z + (forward - side) * Math.SQRT1_2,
          }),
        );
        const col = (p.x - b.west) / world.terrain.resolution.x,
          row = (b.north - p.y) / world.terrain.resolution.y;
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
      }
  const col = Math.max(0, Math.floor(minCol)),
    row = Math.max(0, Math.floor(minRow)),
    endCol = Math.min(width, Math.ceil(maxCol)),
    endRow = Math.min(height, Math.ceil(maxRow));
  if (col >= endCol || row >= endRow) return undefined;
  return Object.freeze({ col, row, endCol, endRow });
}
const projectedCorners = new WeakMap<D3dTerrain, Float32Array>();
/** One buffered object containing native edges only. CPU support coordinates are
 * weakly cached by immutable world transform; windows own fresh GPU attributes.
 * Emit shared edges by adjacency, without per-edge strings, sets or reprojection.
 * Different LAND/WATER surfaces retain both coast edges. */
export function createTerrainGridGeometry(
  world: D3dTerrain,
  window: TerrainGridWindow,
) {
  const profile = beginRepresentationProfile('terrain.grid.prepare');
  const { terrain, metre } = world;
  const { width, height, rasterBounds3035: b } = terrain.viewport;
  let corners = projectedCorners.get(world);
  if (!corners) {
    corners = new Float32Array((width + 1) * (height + 1) * 3).fill(NaN);
    projectedCorners.set(world, corners);
  }
  const support = corners;
  const visit = (
    emit: (
      col: number,
      row: number,
      horizontal: boolean,
      kind: 'land' | 'water',
    ) => void,
  ) => {
    for (let row = window.row; row < window.endRow; row++)
      for (let col = window.col; col < window.endCol; col++) {
        const kind = terrain.classify(row, col) === 'land' ? 'land' : 'water';
        if (row === window.row || terrain.classify(row - 1, col) !== kind)
          emit(col, row, true, kind);
        if (col === window.col || terrain.classify(row, col - 1) !== kind)
          emit(col, row, false, kind);
        emit(col, row + 1, true, kind);
        emit(col + 1, row, false, kind);
      }
  };
  let count = 0;
  visit(() => {
    count += 6;
  });
  const positions = new Float32Array(count);
  let cursor = 0;
  const point = (col: number, row: number, kind: 'land' | 'water') => {
    const index = (row * (width + 1) + col) * 3;
    if (Number.isNaN(support[index])) {
      const p = world.worldPoint(
        b.west + col * terrain.resolution.x,
        b.north - row * terrain.resolution.y,
      );
      support[index] = p.x;
      support[index + 2] = p.z;
    }
    if (kind === 'land' && Number.isNaN(support[index + 1]))
      support[index + 1] =
        terrainRenderCorner(terrain, col, row) *
          metre *
          d3dTerrainElevationScale +
        0.2 * metre;
    positions[cursor++] = support[index]!;
    positions[cursor++] = kind === 'land' ? support[index + 1]! : 0.2 * metre;
    positions[cursor++] = support[index + 2]!;
  };
  visit((col, row, horizontal, kind) => {
    point(col, row, kind);
    point(col + Number(horizontal), row + Number(!horizontal), kind);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  finishRepresentationProfile(profile);
  return geometry;
}
