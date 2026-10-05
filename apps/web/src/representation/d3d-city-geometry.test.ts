import { expect, it } from 'vitest';

import { buildingPrototypeKinds } from './d3d-city-model.js';
import {
  cityPrototypeParts,
  createCityPrototypeGeometry,
  createCitySurfaceGeometry,
} from './d3d-city-geometry.js';
import { generateUrbanCity } from './d3d-city-model.js';
import { createD3dMapModel } from './d3d-map-model.js';
import {
  parseCityPopulationGrid,
  listActivePopulationCells,
} from '@torrevieja-tycoon/transport-domain';

it('distinguishes a villa wing from a small house and a stepped landmark placeholder', () => {
  expect(cityPrototypeParts('detached-villa', 'body')).not.toEqual(
    cityPrototypeParts('detached-house', 'body'),
  );
  expect(cityPrototypeParts('landmark-placeholder', 'body')).not.toEqual(
    cityPrototypeParts('civic-special', 'body'),
  );
});

it('has fourteen distinct body plans and real roof silhouettes with bounded nonoverlapping wings', () => {
  const plans = buildingPrototypeKinds.map((kind) =>
    cityPrototypeParts(kind, 'body'),
  );
  expect(new Set(plans.map((plan) => JSON.stringify(plan))).size).toBe(14);
  const occupied = (kind: 'corner-l' | 'courtyard-u', x: number, z: number) =>
    cityPrototypeParts(kind, 'body').some(
      (part) =>
        Math.abs(x - part.x) < part.width / 2 &&
        Math.abs(z - part.z) < part.depth / 2,
    );
  expect(occupied('corner-l', -0.3, -0.3)).toBe(true);
  expect(occupied('corner-l', 0.3, 0.3)).toBe(true);
  expect(occupied('corner-l', 0.3, -0.3)).toBe(false);
  expect(occupied('courtyard-u', -0.34, 0)).toBe(true);
  expect(occupied('courtyard-u', 0.34, 0)).toBe(true);
  expect(occupied('courtyard-u', 0, 0.34)).toBe(true);
  expect(occupied('courtyard-u', 0, 0)).toBe(false);
  expect(occupied('courtyard-u', 0, -0.49)).toBe(false);
  expect(
    new Set(
      cityPrototypeParts('terrace-row', 'roof').map(
        (part) => part.y + part.height / 2,
      ),
    ).size,
  ).toBe(3);
  for (const kind of buildingPrototypeKinds) {
    const roof = cityPrototypeParts(kind, 'roof');
    expect(roof.length).toBeGreaterThan(0);
    if (kind === 'detached-house' || kind === 'terrace-row')
      expect(roof.some((part) => part.shape === 'gable')).toBe(true);
    for (const layer of ['body', 'roof'] as const) {
      const parts = cityPrototypeParts(kind, layer);
      for (const part of parts) {
        expect(Math.abs(part.x) + part.width / 2).toBeLessThanOrEqual(
          0.5 + 1e-8,
        );
        expect(Math.abs(part.z) + part.depth / 2).toBeLessThanOrEqual(
          0.5 + 1e-8,
        );
        for (const other of parts.filter((other) => other !== part)) {
          const overlapX =
            Math.min(part.x + part.width / 2, other.x + other.width / 2) -
            Math.max(part.x - part.width / 2, other.x - other.width / 2);
          const overlapZ =
            Math.min(part.z + part.depth / 2, other.z + other.depth / 2) -
            Math.max(part.z - part.depth / 2, other.z - other.depth / 2);
          const overlapY =
            Math.min(part.y + part.height / 2, other.y + other.height / 2) -
            Math.max(part.y - part.height / 2, other.y - other.height / 2);
          expect(Math.min(overlapX, overlapY, overlapZ)).toBeLessThanOrEqual(
            1e-8,
          );
        }
      }
      const geometry = createCityPrototypeGeometry(kind, layer);
      const positions = geometry.getAttribute('position');
      expect(positions.count).toBeGreaterThan(0);
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      expect(geometry.getAttribute('normal').count).toBe(positions.count);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
      geometry.dispose();
    }
  }
});

it('batches support patches and consumes independent source corridor widths beneath transport overlays', () => {
  const grid = parseCityPopulationGrid({
    schemaVersion: '1.0.0',
    cityId: 'Q36730',
    gridVersion: '1.0.0',
    originCellCenter: { latitude: 0, longitude: 0 },
    resolutionDegrees: 0.001,
    rowDirection: 'north-to-south',
    columnDirection: 'west-to-east',
    rows: 1,
    columns: 1,
    populationWeights: [[1]],
  });
  const map = createD3dMapModel({
    bounds: { west: -0.01, east: 0.01, south: -0.01, north: 0.01 },
    edges: [],
    stopPlaces: [],
  });
  const roads = [
    { from: { x: -8, z: -8 }, to: { x: -5, z: -8 }, width: 0.3 },
    { from: { x: 5, z: 5 }, to: { x: 5, z: 8 }, width: 0.8 },
  ];
  const city = generateUrbanCity(
    map,
    {
      grid,
      crop: { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 },
      canonicalCells: listActivePopulationCells(grid),
    },
    roads,
    [],
  );
  for (const layer of ['ground', 'street'] as const) {
    const geometry = createCitySurfaceGeometry(city, layer);
    const position = geometry.getAttribute('position');
    expect(position.count).toBe(
      (layer === 'ground' ? city.ground.length : roads.length) * 6,
    );
    expect(geometry.getAttribute('color').count).toBe(position.count);
    expect(geometry.getAttribute('normal').count).toBe(position.count);
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    if (layer === 'street') {
      expect(Math.abs(position.getZ(0) - position.getZ(1))).toBeCloseTo(0.3);
      expect(Math.abs(position.getX(6) - position.getX(7))).toBeCloseTo(0.8);
      expect(position.getY(0)).toBeLessThan(0.1);
    }
    geometry.dispose();
  }
});

it('merges local streets, clips landscape polygons to the crop, and reserves landmark coordinates in noninteractive surfaces', () => {
  const city = {
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
    bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
    ground: [],
    corridors: [],
    localStreets: [
      { from: { x: -0.5, z: 0 }, to: { x: 0.5, z: 0 }, width: 0.1 },
    ],
    landscapes: [
      {
        color: '#8fb8bb',
        rings: [
          [
            { x: -2, z: -2 },
            { x: 2, z: -2 },
            { x: 2, z: 2 },
            { x: -2, z: 2 },
            { x: -2, z: -2 },
          ],
        ],
      },
    ],
    reservations: [{ id: 'research-landmark', x: 0, z: 0, radius: 0.2 }],
  } satisfies Parameters<typeof createCitySurfaceGeometry>[0];
  const water = createCitySurfaceGeometry(
    {
      ...city,
      landscapes: city.landscapes.map((region) => ({
        ...region,
        kind: 'water' as const,
      })),
    },
    'landscape',
  );
  expect(water.getAttribute('position').count).toBe(0);
  water.dispose();
  const anchored = createCitySurfaceGeometry(
    {
      ...city,
      reservations: [
        { id: 'anchor', x: 0, z: 0, radius: 0.2, anchorHeight: 0.15 },
        ...[
          [-2, 0],
          [2, 0],
          [0, -2],
          [0, 2],
        ].map(([x, z]) => ({
          id: 'outside',
          x: x!,
          z: z!,
          radius: 0.2,
          anchorHeight: 0.15,
        })),
      ],
    },
    'reservation',
  );
  anchored.computeBoundingBox();
  expect(anchored.boundingBox!.max.y).toBeCloseTo(0.185);
  expect(anchored.boundingBox!.min.x).toBeGreaterThanOrEqual(-1);
  expect(anchored.boundingBox!.max.x).toBeLessThanOrEqual(1);
  expect(anchored.boundingBox!.min.z).toBeGreaterThanOrEqual(-1);
  expect(anchored.boundingBox!.max.z).toBeLessThanOrEqual(1);
  expect(anchored.getAttribute('color').count).toBe(
    anchored.getAttribute('position').count,
  );
  anchored.dispose();
  for (const layer of ['landscape', 'street', 'reservation'] as const) {
    const geometry = createCitySurfaceGeometry(city, layer);
    const positions = geometry.getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-1);
    expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(1);
    expect(geometry.boundingBox!.min.z).toBeGreaterThanOrEqual(-1);
    expect(geometry.boundingBox!.max.z).toBeLessThanOrEqual(1);
    geometry.dispose();
  }
});
