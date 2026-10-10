import { expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { createTransportMapProjection } from './transport-map-projection.js';
import { createD3dMapModel } from './d3d-map-model.js';
import {
  createD3dStopGeometry,
  d3dStopColors,
  d3dStopRadius,
} from './d3d-stop-geometry.js';
import { createD3dTerrain } from './d3d-terrain-model.js';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-legacy-abc-v1',
);
const read = (name: string) =>
  JSON.parse(readFileSync(join(root, name + '.json'), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: read('scenario'),
  settlements: read('settlements'),
  stops: read('stops'),
  routes: read('routes'),
  presentation: read('presentation'),
  provenance: read('provenance'),
});
const model = createD3dMapModel(createTransportMapProjection(scenario));
it('uses canonical serving routes and chooses the preferred route only at stops it serves', () => {
  const colors = d3dStopColors(model, scenario);
  for (const route of scenario.routes.routes) {
    const preferred = d3dStopColors(model, scenario, route.routeId);
    const nodes = new Set(route.patterns.flatMap((p) => p.stopNodeIds));
    model.stops.forEach((stop, i) => {
      const serves = scenario.stops.stopNodes.some(
        (n) => n.stopPlaceId === stop.stopPlaceId && nodes.has(n.stopNodeId),
      );
      expect(preferred[i]).toBe(
        serves
          ? model.routes.find((r) => r.routeId === route.routeId)!.color
          : colors[i],
      );
    });
  }
  const unplaced = {
    ...scenario,
    stops: {
      ...scenario.stops,
      stopNodes: scenario.stops.stopNodes.map((n) => ({
        ...n,
        stopPlaceId: null,
      })),
    },
  };
  expect(d3dStopColors(model, unplaced)).toEqual(
    model.stops.map(() => '#477d89'),
  );
  const empty = { ...scenario, routes: { ...scenario.routes, routes: [] } };
  expect(d3dStopColors(model, empty)).toEqual(model.stops.map(() => '#477d89'));
  expect(d3dStopColors({ ...model, routes: [] }, scenario)).toEqual(
    model.stops.map(() => '#477d89'),
  );
});
it('keeps a stop disk at half the selection radius, drapes every vertex, and preserves ordinary dimensions', () => {
  expect(d3dStopRadius(undefined)).toBe(0.325);
  expect(d3dStopRadius(2)).toBe(20);
  const f = terrainFixture(),
    terrain = terrainJsonDecoder.decode(
      f,
      resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
    );
  const world = createD3dTerrain(terrain, model),
    p = world.worldPoint(3375037.5, 1720062.5);
  const stops = [{ ...model.stops[0]!, ...p }];
  const radius = d3dStopRadius(world.metre);
  const disk = createD3dStopGeometry(stops, ['#ff0000'], radius, world);
  const ring = createD3dStopGeometry(
    stops,
    ['#f2bc56'],
    radius * 2,
    world,
    true,
  );
  for (const [geometry, offset] of [
    [disk, 0.3],
    [ring, 0.5],
  ] as const) {
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++)
      expect(pos.getY(i)).toBeCloseTo(
        world.ground(pos.getX(i), pos.getZ(i)).y + offset * world.metre,
        4,
      );
  }
  expect(disk.getAttribute('position').count).toBe(96);
  expect(ring.getAttribute('position').count).toBe(192);
  expect(disk.getAttribute('color').getX(0)).toBe(1);
  const flat = createD3dStopGeometry(stops, ['#ff0000'], 0.325);
  expect(flat.getAttribute('position').getY(0)).toBeCloseTo(0.045);
  const flatRing = createD3dStopGeometry(
    stops,
    ['#f2bc56'],
    0.65,
    undefined,
    true,
  );
  expect(flatRing.getAttribute('position').getY(0)).toBeCloseTo(0.17);
  const a = disk.getAttribute('position');
  const ax = a.getX(1) - a.getX(0),
    az = a.getZ(1) - a.getZ(0),
    bx = a.getX(2) - a.getX(0),
    bz = a.getZ(2) - a.getZ(0);
  expect(az * bx - ax * bz).toBeGreaterThan(0);
  for (const g of [disk, ring, flat, flatRing]) g.dispose();
});
