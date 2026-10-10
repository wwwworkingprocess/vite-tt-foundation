import { describe, expect, it, vi } from 'vitest';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
import { createD3dMapModel } from './d3d-map-model.js';
import { createD3dTerrain, planD3dTerrain } from './d3d-terrain-model.js';
import {
  terrainGridWindow,
  createTerrainGridGeometry,
  maximumD3dZoom,
} from './d3d-terrain-grid.js';
const model = createD3dMapModel({
  bounds: { west: -0.8, east: -0.6, south: 37.9, north: 38.1 },
  edges: [],
  stopPlaces: [],
});
function fixture() {
  const f = terrainFixture();
  const t = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  return createD3dTerrain(t, model);
}
describe('maximum zoom native grid', () => {
  it('enables only the capped normal camera, with stable tolerance', () => {
    expect(maximumD3dZoom('normal', 25, 25)).toBe(true);
    expect(maximumD3dZoom('normal', 25 - 1e-8, 25)).toBe(true);
    expect(maximumD3dZoom('normal', 24, 25)).toBe(false);
    expect(maximumD3dZoom('mini', 25, 25)).toBe(false);
  });
  it('clips a viewport window to native coverage and rejects an off-map viewport', () => {
    const w = fixture(),
      p = w.worldPoint(3375037.5, 1720037.5);
    const window = terrainGridWindow(w, model, {
      x: p.x,
      z: p.z,
      zoom: 1000,
      width: 800,
      height: 600,
    });
    expect(window).toEqual({ col: 0, row: 0, endCol: 3, endRow: 3 });
    expect(
      terrainGridWindow(w, model, {
        x: 1000,
        z: 1000,
        zoom: 1000,
        width: 800,
        height: 600,
      }),
    ).toBeUndefined();
  });
  it('draws only requested native grid edges at matching exaggerated mesh supports, including water at zero', () => {
    const w = fixture(),
      window = { col: 0, row: 0, endCol: 2, endRow: 2 };
    const grid = createTerrainGridGeometry(w, window);
    const positions = grid.getAttribute('position');
    expect(positions.count).toBe(24);
    const near = planD3dTerrain(w, {
      representationMode: 'normal',
      lod: 'near',
    });
    const land = new Map<string, number>();
    for (const p of near.patches.filter((p) => p.kind === 'land'))
      for (let i = 0; i < p.positions.length; i += 3)
        land.set(
          p.positions[i] + ':' + p.positions[i + 2],
          p.positions[i + 1]!,
        );
    for (let i = 0; i < positions.count; i++) {
      const y = land.get(positions.getX(i) + ':' + positions.getZ(i));
      if (y !== undefined)
        expect(positions.getY(i)).toBeCloseTo(y + 0.2 * w.metre, 5);
    }
    const water = createTerrainGridGeometry(w, {
      col: 0,
      row: 2,
      endCol: 1,
      endRow: 3,
    });
    expect(
      Array.from(water.getAttribute('position').array).filter(
        (_, i) => i % 3 === 1,
      ),
    ).toEqual(Array(8).fill(Math.fround(0.2 * w.metre)));
    expect(w.terrain.sample(0, 0)).toBe(-4);
    grid.dispose();
    water.dispose();
  });
});

it('reuses projected native supports across overlapping viewport windows without retaining GPU geometries', () => {
  const source = fixture(),
    project = vi.fn(source.worldPoint);
  const world = { ...source, worldPoint: project };
  const a = createTerrainGridGeometry(world, {
    col: 0,
    row: 0,
    endCol: 2,
    endRow: 2,
  });
  expect(project).toHaveBeenCalledTimes(9);
  project.mockClear();
  const b = createTerrainGridGeometry(world, {
    col: 0,
    row: 0,
    endCol: 2,
    endRow: 2,
  });
  expect(project).not.toHaveBeenCalled();
  expect(b).not.toBe(a);
  expect(b.getAttribute('position').array).toEqual(
    a.getAttribute('position').array,
  );
  const c = createTerrainGridGeometry(world, {
    col: 1,
    row: 0,
    endCol: 3,
    endRow: 2,
  });
  expect(project).toHaveBeenCalledTimes(3);
  a.dispose();
  b.dispose();
  c.dispose();
});
