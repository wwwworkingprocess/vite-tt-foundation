import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { createTransportMapProjection } from './transport-map-projection.js';
import {
  listActivePopulationCells,
  parseCityPopulationGrid,
} from '@torrevieja-tycoon/transport-domain';
import { createD3dMapModel } from './d3d-map-model.js';
import {
  buildProceduralCity,
  buildUrbanCorridors,
  generateUrbanCity,
  cityLodBuildings,
  distanceToCorridor,
} from './d3d-city-model.js';

const model = createD3dMapModel({
  bounds: { west: 0, east: 0.03, south: 0, north: 0.03 },
  edges: [],
  stopPlaces: [],
});
const grid = parseCityPopulationGrid({
  schemaVersion: '1.0.0',
  cityId: 'Q36730',
  gridVersion: '1.0.0',
  originCellCenter: { latitude: 0.025, longitude: 0.005 },
  resolutionDegrees: 0.001,
  rowDirection: 'north-to-south',
  columnDirection: 'west-to-east',
  rows: 20,
  columns: 20,
  populationWeights: Array.from({ length: 20 }, (_, r) =>
    Array.from({ length: 20 }, (_, c) => 1 + Math.floor((160 * c) / 19) + r),
  ),
});
const population = {
  grid,
  crop: { rowStart: 0, rowEnd: 20, columnStart: 0, columnEnd: 20 },
  canonicalCells: listActivePopulationCells(grid),
};

it('locks the owner-approved aggregate amendment while retaining every isolation budget', () => {
  const manifest = JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '..',
        'torrevieja-project.json',
      ),
      'utf8',
    ),
  ) as { buildBudgetsBytes: Record<string, number> };
  expect(manifest.buildBudgetsBytes).toEqual({
    applicationEntry: 490000,
    dialogShell: 8000,
    projectInfo: 4000,
    simulationControls: 8000,
    sessionControls: 6000,
    svgRepresentation: 7500,
    canvas2dRepresentation: 12000,
    populationOverlay: 3000,
    transportMapProjection: 4500,
    dom2dProjectionAdapter: 2500,
    openScreen: 4000,
    gameInspector: 8000,
    persistenceRuntime: 260000,
    representation: 1200000,
    transportWorker: 200000,
    totalEmittedJavaScript: 2000000,
  });
});

it('generates bounded, subdivided non-raster parcels deterministically without mutating density authority', () => {
  const before = structuredClone(population);
  const city = buildProceduralCity(model, population);
  expect(city).toEqual(
    buildProceduralCity(createD3dMapModel({ ...model.projection }), {
      ...population,
      canonicalCells: [...population.canonicalCells].reverse(),
    }),
  );
  expect(buildProceduralCity(model, population)).toBe(city);
  expect(population).toEqual(before);
  expect(structuredClone(city)).toEqual(city);
  expect(Object.isFrozen(city.buildings)).toBe(true);
  expect(city.components).toHaveLength(1);
  expect(city.blocks.length).toBeGreaterThan(4);
  for (const block of city.blocks) {
    expect(block.maxX - block.minX).toBeLessThanOrEqual(
      city.cellWidth * 4 + 1e-8,
    );
    expect(block.maxZ - block.minZ).toBeLessThanOrEqual(
      city.cellDepth * 4 + 1e-8,
    );
  }
  expect(new Set(city.buildings.map((b) => b.archetype))).toEqual(
    new Set([
      'detached-house',
      'terrace-row',
      'midrise-slab',
      'corner-l',
      'courtyard-u',
    ]),
  );
  expect(city.buildings.length).not.toBe(population.canonicalCells.length);
  expect(new Set(city.buildings.map((b) => b.rotation)).size).toBeGreaterThan(
    2,
  );
  for (const b of city.buildings) {
    expect(b.storeys).toBeGreaterThanOrEqual(1);
    expect(b.storeys).toBeLessThanOrEqual(7);
    expect(b.height).toBe(b.storeys * city.storeyHeight);
    expect(
      [b.x, b.z, b.width, b.depth, b.rotation, b.height].every(Number.isFinite),
    ).toBe(true);
    const radius = Math.hypot(b.width, b.depth) / 2;
    expect(b.x - radius).toBeGreaterThanOrEqual(city.bounds.minX);
    expect(b.x + radius).toBeLessThanOrEqual(city.bounds.maxX);
    expect(b.z - radius).toBeGreaterThanOrEqual(city.bounds.minZ);
    expect(b.z + radius).toBeLessThanOrEqual(city.bounds.maxZ);
    for (const other of city.buildings.filter(
      (other) => other.id > b.id && other.blockId === b.blockId,
    )) {
      expect(Math.hypot(other.x - b.x, other.z - b.z)).toBeGreaterThanOrEqual(
        radius + Math.hypot(other.width, other.depth) / 2,
      );
    }
  }
  expect(cityLodBuildings(city, 'far', 'normal').length).toBeLessThan(
    cityLodBuildings(city, 'medium', 'normal').length,
  );
  expect(cityLodBuildings(city, 'medium', 'normal').length).toBeLessThan(
    city.buildings.length,
  );
  expect(cityLodBuildings(city, 'near', 'normal')).toBe(city.buildings);
  expect(cityLodBuildings(city, 'near', 'mini').length).toBeLessThan(
    cityLodBuildings(city, 'far', 'normal').length,
  );
});

it('reserves deduplicated corridors and StopPlace plazas and separates disconnected support', () => {
  const corridors = [
    { from: { x: -20, z: -50 }, to: { x: -20, z: 50 }, width: 0.7 },
  ];
  const city = generateUrbanCity(model, population, corridors, [
    { x: -5, z: -5 },
  ]);
  expect(Object.isFrozen(corridors)).toBe(false);
  expect(Object.isFrozen(corridors[0])).toBe(false);
  expect(Object.isFrozen(corridors[0]!.from)).toBe(false);
  expect(city.components.length).toBeGreaterThan(1);
  for (const b of city.buildings) {
    const radius = Math.hypot(b.width, b.depth) / 2;
    expect(distanceToCorridor(b, corridors[0]!)).toBeGreaterThanOrEqual(
      radius + 0.35,
    );
    expect(Math.hypot(b.x + 5, b.z + 5)).toBeGreaterThanOrEqual(
      radius + city.stopClearance,
    );
  }
  const edge = { from: { x: -1, z: 0 }, to: { x: 1, z: 0 } };
  expect(
    buildUrbanCorridors(
      [
        edge,
        { from: edge.to, to: edge.from },
        { from: { x: 0, z: 0 }, to: { x: 2, z: 0 } },
        { from: edge.from, to: edge.from },
      ],
      0.3,
    ),
  ).toEqual([{ from: { x: -1, z: 0 }, to: { x: 2, z: 0 }, width: 0.3 }]);
  expect(Object.isFrozen(edge.from)).toBe(false);
  expect(
    distanceToCorridor(
      { x: 4, z: 5 },
      { from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, width: 0 },
    ),
  ).toBe(5);
  const fragments = {
    ...population,
    canonicalCells: population.canonicalCells.filter(
      (c) => c.column < 3 || c.column > 16,
    ),
  };
  expect(buildProceduralCity(model, fragments).components).toHaveLength(2);
  expect(
    buildProceduralCity(model, { ...population, canonicalCells: [] }).buildings,
  ).toEqual([]);
  expect(
    buildProceduralCity(createD3dMapModel({ ...model.projection }), population),
  ).not.toBe(buildProceduralCity(model, population));
  expect(buildProceduralCity(model, { ...population })).not.toBe(
    buildProceduralCity(model, population),
  );
});

const realTorrevieja = (() => {
  const publicRoot = join(import.meta.dirname, '..', '..', 'public');
  const json = (path: string) =>
    JSON.parse(readFileSync(join(publicRoot, path), 'utf8')) as unknown;
  const root = 'scenarios/torrevieja-v1/torrevieja-legacy-abc-v1/';
  const scenario = parseScenarioPackage({
    manifest: json(root + 'scenario.json'),
    settlements: json(root + 'settlements.json'),
    stops: json(root + 'stops.json'),
    routes: json(root + 'routes.json'),
    presentation: json(root + 'presentation.json'),
    provenance: json(root + 'provenance.json'),
  });
  const grid = parseCityPopulationGrid(
    json(
      'population-fields/torrevieja-v1/torrevieja-city-population-grid-v1.round2.json',
    ),
  );
  const crops = json(
    'population-fields/torrevieja-v1/torrevieja-population-grid-round3-crops.json',
  ) as { scenarios: { scenarioId: string; crop: typeof population.crop }[] };
  const crop = crops.scenarios.find(
    (c) => c.scenarioId === scenario.manifest.scenarioId,
  )!.crop;
  const view = {
    grid,
    crop,
    canonicalCells: listActivePopulationCells(grid).filter(
      (c) =>
        c.row >= crop.rowStart &&
        c.row < crop.rowEnd &&
        c.column >= crop.columnStart &&
        c.column < crop.columnEnd,
    ),
  };
  const map = createD3dMapModel(createTransportMapProjection(scenario));
  const city = buildProceduralCity(map, view);
  return { map, city };
})();

it('uses all five archetypes in the real Torrevieja crop, with materially reduced LOD counts', () => {
  const { map, city } = realTorrevieja;
  const counts = Object.fromEntries(
    [
      'detached-house',
      'terrace-row',
      'midrise-slab',
      'corner-l',
      'courtyard-u',
    ].map((kind) => [
      kind,
      city.buildings.filter((b) => b.archetype === kind).length,
    ]),
  );
  expect(Object.values(counts).every((count) => count > 0)).toBe(true);
  expect(city.far.length).toBeLessThan(city.medium.length / 2);
  expect(city.medium.length).toBeLessThan(city.buildings.length);
  for (const b of city.buildings) {
    const radius = Math.hypot(b.width, b.depth) / 2;
    expect(
      Math.min(
        ...city.corridors.map(
          (road) => distanceToCorridor(b, road) - road.width / 2,
        ),
      ) + 1e-8,
    ).toBeGreaterThanOrEqual(radius);
    expect(
      Math.min(
        ...map.stops.map((stop) => Math.hypot(stop.x - b.x, stop.z - b.z)),
      ) + 1e-8,
    ).toBeGreaterThanOrEqual(radius + city.stopClearance);
  }
  expect({
    components: city.components.length,
    blocks: city.blocks.length,
    archetypes: counts,
    far: city.far.length,
    medium: city.medium.length,
    near: city.buildings.length,
    mini: city.mini.length,
  }).toEqual({
    components: 53,
    blocks: 435,
    archetypes: {
      'detached-house': 401,
      'terrace-row': 216,
      'midrise-slab': 20,
      'corner-l': 131,
      'courtyard-u': 16,
    },
    far: 131,
    medium: 392,
    near: 784,
    mini: 33,
  });
});

it('aligns canonical cells identically in full and cropped runtime grids without double-applying crop offsets', () => {
  const crop = { rowStart: 4, rowEnd: 10, columnStart: 3, columnEnd: 12 };
  const cropped = parseCityPopulationGrid({
    ...grid,
    originCellCenter: {
      latitude:
        grid.originCellCenter.latitude - crop.rowStart * grid.resolutionDegrees,
      longitude:
        grid.originCellCenter.longitude +
        crop.columnStart * grid.resolutionDegrees,
    },
    rows: crop.rowEnd - crop.rowStart,
    columns: crop.columnEnd - crop.columnStart,
    populationWeights: grid.populationWeights
      .slice(crop.rowStart, crop.rowEnd)
      .map((row) => row.slice(crop.columnStart, crop.columnEnd)),
  });
  const canonicalCells = population.canonicalCells.filter(
    (c) =>
      c.row >= crop.rowStart &&
      c.row < crop.rowEnd &&
      c.column >= crop.columnStart &&
      c.column < crop.columnEnd,
  );
  expect(
    buildProceduralCity(model, { grid: cropped, crop, canonicalCells }),
  ).toEqual(buildProceduralCity(model, { grid, crop, canonicalCells }));
});
