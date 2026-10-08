import { expect, it } from 'vitest';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
import { createCitySurfaceGeometry } from './d3d-city-geometry.js';
import type { ProceduralCity } from './d3d-city-model.js';
import { terrainLayerOffsets, type D3dTerrain } from './d3d-terrain-model.js';
it('drapes independent surface layers and keeps landmark placeholder heights above one sampled anchor', () => {
  const f = terrainFixture(),
    runtime = terrainJsonDecoder.decode(
      f,
      resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
    );
  let queries = 0;
  const terrain: D3dTerrain = {
    terrain: runtime,
    metre: 0.01,
    step: 1,
    bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 2, maxY: 2 },
    ground: () => {
      queries++;
      return { y: 2, diagnostic: 'native' };
    },
    sample: () => ({ kind: 'land', elevation: 2 }),
    worldPoint: (x, z) => ({ x, z }),
  };
  const city: ProceduralCity = {
    cellWidth: 1,
    cellDepth: 1,
    storeyHeight: 1,
    stopClearance: 1,
    components: [],
    blocks: [],
    buildings: [],
    far: [],
    medium: [],
    mini: [],
    bounds: terrain.bounds,
    ground: [{ minX: -0.4, maxX: 0.4, minZ: -0.4, maxZ: 0.4, density: 0.5 }],
    corridors: [{ from: { x: -0.4, z: 0 }, to: { x: 0.4, z: 0 }, width: 0.1 }],
    reservations: [
      { id: 'anchor', x: 0, z: 0, radius: 0.2, anchorHeight: 0.15 },
    ],
    landscapes: [
      {
        color: '#a7b88d',
        rings: [
          [
            { x: -0.4, z: -0.4 },
            { x: 0.4, z: -0.4 },
            { x: 0.4, z: 0.4 },
            { x: -0.4, z: 0.4 },
            { x: -0.4, z: -0.4 },
          ],
        ],
      },
    ],
  };
  for (const layer of [
    'ground',
    'street',
    'landscape',
    'reservation',
  ] as const) {
    const g = createCitySurfaceGeometry(city, layer, terrain);
    expect(g.getAttribute('position').count).toBeGreaterThan(0);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeGreaterThan(2);
    if (layer === 'reservation')
      expect(g.boundingBox!.max.y).toBeCloseTo(2.0015 + 0.15, 5);
    else {
      for (let i = 0; i < g.getAttribute('normal').count; i++)
        expect(g.getAttribute('normal').getY(i)).toBeGreaterThan(0);
      expect(g.boundingBox!.max.y).toBeLessThan(2.01);
      expect(
        g.boundingBox!.max.y,
        'transport routes must remain above city surface layers',
      ).toBeLessThan(2 + terrainLayerOffsets.route * terrain.metre);
    }
    expect(g.getAttribute('color').count).toBe(
      g.getAttribute('position').count,
    );
    const before = queries;
    const again = createCitySurfaceGeometry(city, layer, terrain);
    expect(
      queries,
      'terrain surface preparation is shared across canvas mounts',
    ).toBe(before);
    expect(again).not.toBe(g);
    expect(again.getAttribute('position')).not.toBe(g.getAttribute('position'));
    expect(again.getAttribute('position').array).toBe(
      g.getAttribute('position').array,
    );
    g.dispose();
    expect(again.getAttribute('position').count).toBeGreaterThan(0);
    again.dispose();
  }
  const far = createCitySurfaceGeometry(city, 'ground', terrain, 'far');
  const medium = createCitySurfaceGeometry(city, 'ground', terrain, 'medium');
  const near = createCitySurfaceGeometry(city, 'ground', terrain, 'near');
  expect(far.getAttribute('position').count).toBeLessThan(
    medium.getAttribute('position').count,
  );
  expect(medium.getAttribute('position').count).toBeLessThan(
    near.getAttribute('position').count,
  );
  far.dispose();
  medium.dispose();
  near.dispose();
  const shifted = createCitySurfaceGeometry(city, 'ground', {
    ...terrain,
    ground: () => ({ y: 3, diagnostic: 'native' }),
  });
  shifted.computeBoundingBox();
  expect(shifted.boundingBox!.min.y).toBeGreaterThan(3);
  shifted.dispose();
});
