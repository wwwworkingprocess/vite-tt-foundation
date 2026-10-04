import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  parseScenarioPackage,
  parseCityPopulationGrid,
  listActivePopulationCells,
} from '@torrevieja-tycoon/transport-domain';
import { parseSettlementMetadata } from '../settlement/settlement-metadata.js';
import { enrichSettlementPopulation } from '../settlement/settlement-population-overlay.js';
import { lookupSettlementContext } from '../settlement/settlement-metadata-spatial.js';
import { createTransportMapProjection } from './transport-map-projection.js';
import {
  createD3dMapModel,
  d3dGeographicPoint,
  d3dMetreScale,
} from './d3d-map-model.js';
import { buildProceduralCity, distanceToCorridor } from './d3d-city-model.js';
import {
  settlementPaletteColor,
  selectDevelopmentProfile,
} from './d3d-metadata-city.js';

it('maps known palettes and chooses weighted families deterministically', () => {
  expect(settlementPaletteColor('white render')).toBe('#ece8dc');
  expect(settlementPaletteColor('future descriptor')).toBe('#d2cdbb');
  const mix = [
    { buildingProfileId: 'bp-detached-villa', weight: 0.25 },
    { buildingProfileId: 'bp-commercial-box', weight: 0.75 },
  ];
  expect(selectDevelopmentProfile(researchMetadata, mix, 1000).id).toBe(
    'bp-detached-villa',
  );
  expect(selectDevelopmentProfile(researchMetadata, mix, 2500).id).toBe(
    'bp-commercial-box',
  );
});

const root = join(import.meta.dirname, '../../public');
const json = (path: string): unknown =>
  JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
const scenarioPath = 'scenarios/torrevieja-v1/torrevieja-legacy-abc-v1/';
export const researchScenario = parseScenarioPackage({
  manifest: json(scenarioPath + 'scenario.json'),
  settlements: json(scenarioPath + 'settlements.json'),
  stops: json(scenarioPath + 'stops.json'),
  routes: json(scenarioPath + 'routes.json'),
  presentation: json(scenarioPath + 'presentation.json'),
  provenance: json(scenarioPath + 'provenance.json'),
});
export const researchMetadata = parseSettlementMetadata(
  json('settlement-metadata/torrevieja/torrevieja-settlement-metadata.v0.json'),
);
const grid = parseCityPopulationGrid(
  json(
    'population-fields/torrevieja-v1/torrevieja-city-population-grid-v1.round2.json',
  ),
);
const crops = json(
  'population-fields/torrevieja-v1/torrevieja-population-grid-round3-crops.json',
) as {
  scenarios: {
    scenarioId: string;
    crop: {
      rowStart: number;
      rowEnd: number;
      columnStart: number;
      columnEnd: number;
    };
  }[];
};
const crop = crops.scenarios.find(
  (c) => c.scenarioId === researchScenario.manifest.scenarioId,
)!.crop;
export const researchPopulation = {
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
const map = createD3dMapModel(createTransportMapProjection(researchScenario));
const view = {
  status: 'ready',
  metadata: researchMetadata,
  sha256: 'research-hash',
  primarySettlementId: 'es-torrevieja',
} as const;
const city = buildProceduralCity(map, researchPopulation, view);
// Reuse acquired immutable real-data fixtures; compact tests exercise replacements independently.
const researchOverlay = enrichSettlementPopulation(
  researchPopulation,
  researchMetadata,
);
const genericResearchCity = buildProceduralCity(map, researchPopulation);
const regeneratedResearchCity = buildProceduralCity(
  createD3dMapModel(createTransportMapProjection(researchScenario)),
  researchPopulation,
  view,
);

it('records the real dataset population, morphology and bounded LOD summary', () => {
  const countBy = (
    keys: readonly string[],
    field: 'zoneId' | 'buildingProfileId' | 'archetype',
  ) =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        city.buildings.filter((b) => b[field] === key).length,
      ]),
    );
  expect({
    diagnostics: city.settlement!.diagnostics,
    components: city.components.length,
    blocks: city.blocks.length,
    buildings: city.buildings.length,
    localStreetSegments: city.localStreets!.length,
    byZone: countBy(
      researchMetadata.zones.map((z) => z.id),
      'zoneId',
    ),
    byProfile: countBy(
      researchMetadata.buildingProfiles.map((p) => p.id),
      'buildingProfileId',
    ),
    byArchetype: countBy(
      [
        'small-apartment',
        'perimeter-block',
        'corner-l',
        'courtyard-u',
        'midrise-slab',
        'tower-podium',
        'detached-house',
        'semi-detached',
        'terrace-row',
        'commercial-box',
        'industrial-shed',
        'civic-special',
      ],
      'archetype',
    ),
    fallback: city.buildings.filter((b) => b.zoneId === undefined).length,
    lod: {
      far: city.far.length,
      medium: city.medium.length,
      near: city.buildings.length,
      mini: city.mini.length,
    },
    unitsPerMetre: d3dMetreScale(map).worldUnitsPerMetre,
    examples: [
      'up-dense-central-grid',
      'up-villa-grid',
      'up-industrial-sheds',
    ].map((id) => {
      const block = city.blocks.find((b) => b.urbanProfileId === id)!;
      return { id, widthM: block.widthM, depthM: block.depthM };
    }),
  }).toMatchInlineSnapshot(`
    {
      "blocks": 1096,
      "buildings": 2999,
      "byArchetype": {
        "civic-special": 62,
        "commercial-box": 11,
        "corner-l": 430,
        "courtyard-u": 454,
        "detached-house": 275,
        "industrial-shed": 1,
        "midrise-slab": 446,
        "perimeter-block": 97,
        "semi-detached": 257,
        "small-apartment": 456,
        "terrace-row": 494,
        "tower-podium": 16,
      },
      "byProfile": {
        "bp-central-mixed": 360,
        "bp-civic-special": 62,
        "bp-coastal-slab-tower": 39,
        "bp-commercial-box": 9,
        "bp-detached-villa": 264,
        "bp-emerging-midrise": 10,
        "bp-industrial-shed": 3,
        "bp-lowrise-compound": 732,
        "bp-midrise-apartment": 754,
        "bp-terrace-bungalow": 741,
      },
      "byZone": {
        "z-acequion-grid": 28,
        "z-aguas-nuevas-compounds": 656,
        "z-cabo-cervera-torremoro": 7,
        "z-calas-blancas": 714,
        "z-casagrande-industrial": 1,
        "z-center-seafront": 262,
        "z-central-grid": 228,
        "z-chaparral-villas": 0,
        "z-habaneras-retail": 7,
        "z-la-hoya-active": 15,
        "z-la-manguilla-emerging": 0,
        "z-la-mata-beachfront": 1,
        "z-la-mata-core": 302,
        "z-la-veleta-mixed": 32,
        "z-lago-jardin": 0,
        "z-limonar-hondo-fringe": 0,
        "z-los-altos-mixed": 28,
        "z-los-angeles-villa-apartment": 121,
        "z-los-balcones-villas": 1,
        "z-los-locos-promenade": 11,
        "z-molino-blanco": 207,
        "z-naufragos-coast": 5,
        "z-north-sports-campus": 3,
        "z-nueva-torrevieja": 155,
        "z-port-eras": 1,
        "z-rosaleda-inner": 107,
        "z-salinas-industrial": 0,
        "z-siesta-sanluis-villas": 1,
        "z-south-coastal-apartments": 20,
        "z-torreblanca-mixed": 55,
        "z-torreta-villas": 6,
      },
      "components": 51,
      "diagnostics": {
        "cellsWithZone": 2474,
        "cellsWithZoneOverlap": 1273,
        "cellsWithoutZone": 495,
        "landmarkZoneMismatches": [
          {
            "districtId": "d-central-harbor",
            "landmarkId": "lm-eras-sal",
            "zoneId": "z-port-eras",
          },
          {
            "districtId": "d-aguas-torremoro",
            "landmarkId": "lm-hospital-quiron",
            "zoneId": "z-north-sports-campus",
          },
          {
            "districtId": "d-aguas-torremoro",
            "landmarkId": "lm-palacio-deportes",
            "zoneId": "z-north-sports-campus",
          },
        ],
        "landscapeSuppressedCells": 1379,
        "nonzeroCells": 2969,
        "totalCells": 8550,
      },
      "examples": [
        {
          "depthM": 72.23723723723724,
          "id": "up-dense-central-grid",
          "widthM": 82.34734734734735,
        },
        {
          "depthM": 88.83383383383384,
          "id": "up-villa-grid",
          "widthM": 109.11411411411412,
        },
        {
          "depthM": 242.52252252252254,
          "id": "up-industrial-sheds",
          "widthM": 288.6186186186186,
        },
      ],
      "fallback": 25,
      "localStreetSegments": 21458,
      "lod": {
        "far": 375,
        "medium": 1500,
        "mini": 94,
        "near": 2999,
      },
      "unitsPerMetre": 0.017359206757909404,
    }
  `);
});

it('builds contrasting metric fabrics from the unchanged research package, with immutable deterministic cache identity', () => {
  expect(city.settlement!.diagnostics).toEqual(researchOverlay.diagnostics);
  expect(buildProceduralCity(map, researchPopulation, view)).toBe(city);
  expect(
    buildProceduralCity(map, researchPopulation, { status: 'unavailable' }),
  ).toBe(genericResearchCity);
  expect(regeneratedResearchCity).toEqual(city);
  expect(Object.isFrozen(city.buildings)).toBe(true);
  expect(city.localStreets!.length).toBeGreaterThan(100);
  expect(city.buildings.length).toBeGreaterThan(1000);
  const kinds = new Set(city.buildings.map((b) => b.archetype));
  expect([...kinds].sort()).toEqual(
    [
      'small-apartment',
      'perimeter-block',
      'corner-l',
      'courtyard-u',
      'midrise-slab',
      'tower-podium',
      'detached-house',
      'semi-detached',
      'terrace-row',
      'commercial-box',
      'industrial-shed',
      'civic-special',
    ].sort(),
  );
});

it('invalidates metadata hashes without invalidating fallback identity', () => {
  const { model, population, view } = compactFixture();
  const city = buildProceduralCity(model, population, view);
  expect(
    buildProceduralCity(model, population, {
      ...view,
      sha256: 'replacement',
    }),
  ).not.toBe(city);
});

it('preserves metre scale, storey/profile limits, no-build masks, corridors and actual landmark reservations', () => {
  const scale = d3dMetreScale(map).worldUnitsPerMetre;
  expect(
    city.buildings
      .filter((b) => b.buildingProfileId)
      .every((building) => {
        const profile = researchMetadata.buildingProfiles.find(
          (p) => p.id === building.buildingProfileId,
        )!;
        return (
          profile.allowedArchetypes.includes(building.archetype) &&
          building.storeys >= profile.storeys.min &&
          building.storeys <= profile.storeys.max &&
          Math.abs(building.height - building.storeys * 3.1 * scale) < 1e-8 &&
          lookupSettlementContext(researchMetadata, [
            d3dGeographicPoint(map, building).longitude,
            d3dGeographicPoint(map, building).latitude,
          ]).buildability !== 'none' &&
          city.corridors.every(
            (road) =>
              distanceToCorridor(building, road) + 1e-8 >=
              Math.hypot(building.width, building.depth) / 2 + road.width / 2,
          ) &&
          city.reservations!.every(
            (reservation) =>
              Math.hypot(
                building.x - reservation.x,
                building.z - reservation.z,
              ) +
                1e-8 >=
              reservation.radius +
                Math.hypot(building.width, building.depth) / 2,
          )
        );
      }),
  ).toBe(true);
});

it('contrasts central, villa and industrial blocks and keeps families coherent within developments', () => {
  const central = city.blocks.filter(
    (b) => b.urbanProfileId === 'up-dense-central-grid',
  );
  const villas = city.blocks.filter(
    (b) => b.urbanProfileId === 'up-villa-grid',
  );
  const industrial = city.blocks.filter(
    (b) => b.urbanProfileId === 'up-industrial-sheds',
  );
  const average = (blocks: typeof central) =>
    blocks.reduce((sum, b) => sum + b.widthM!, 0) / blocks.length;
  expect(average(villas)).toBeGreaterThan(average(central));
  expect(average(industrial)).toBeGreaterThan(average(villas));
  const families = new Map<string, Set<string | undefined>>();
  for (const building of city.buildings) {
    const set = families.get(building.blockId) ?? new Set();
    set.add(building.buildingProfileId);
    families.set(building.blockId, set);
  }
  expect([...families.values()].every((set) => set.size <= 1)).toBe(true);
  expect(city.far.length).toBeLessThan(city.medium.length / 2);
  expect(city.mini.length).toBeLessThan(city.far.length / 2);
});

it('separates overlapping terrain surfaces deterministically, with specific zones and water above broad land', () => {
  const surfaces = city.landscapes!;
  expect(new Set(surfaces.map((surface) => surface.surfaceY)).size).toBe(
    surfaces.length,
  );
  const zones = surfaces.slice(0, researchMetadata.zones.length);
  const landscapes = surfaces.slice(researchMetadata.zones.length);
  expect(Math.max(...zones.map((surface) => surface.surfaceY!))).toBeLessThan(
    Math.min(...landscapes.map((surface) => surface.surfaceY!)),
  );
  expect(
    Math.max(...surfaces.map((surface) => surface.surfaceY!)),
  ).toBeLessThan(0.032);
  expect(landscapes.at(-1)!.color).toBe('#8fb8bb');
  const fixture = compactFixture();
  const zone = fixture.view.metadata.zones[0]!;
  const tied = parseSettlementMetadata({
    ...fixture.view.metadata,
    zones: [
      { ...zone, id: 'z-a', densityCharacter: 'high' },
      { ...zone, id: 'z-b', densityCharacter: 'low' },
    ],
    districts: fixture.view.metadata.districts.map((district) => ({
      ...district,
      zoneIds: ['z-a', 'z-b'],
    })),
  });
  expect(
    buildProceduralCity(fixture.model, fixture.population, {
      ...fixture.view,
      metadata: tied,
    }).landscapes!.map((surface) => surface.color),
  ).toEqual(['#acb997', '#bbb899']);
});

function compactFixture() {
  const boundary = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-0.7, 37.979],
        [-0.695, 37.979],
        [-0.695, 37.985],
        [-0.7, 37.985],
        [-0.7, 37.979],
      ],
    ],
  };
  const zone = {
    ...researchMetadata.zones[0]!,
    boundary,
    urbanProfileId: 'up-industrial-sheds',
    buildingProfileMix: [
      { buildingProfileId: 'bp-industrial-shed', weight: 1 },
    ],
  };
  const urban = researchMetadata.urbanProfiles.find(
    (p) => p.id === zone.urbanProfileId,
  )!;
  const metadata = parseSettlementMetadata({
    ...researchMetadata,
    zones: [zone],
    districts: [
      {
        ...researchMetadata.districts.find((d) => d.id === zone.districtId)!,
        zoneIds: [zone.id],
        landmarkIds: [],
      },
    ],
    landmarks: [],
    landscapeRegions: [],
    urbanProfiles: [
      {
        ...urban,
        typicalBlockWidthM: { min: 70, max: 80 },
        typicalBlockDepthM: { min: 60, max: 80 },
        typicalParcelFrontageM: { min: 15, max: 20 },
        typicalParcelDepthM: { min: 20, max: 25 },
      },
    ],
  });
  const model = createD3dMapModel({
    bounds: { west: -0.701, east: -0.694, south: 37.978, north: 37.986 },
    edges: [],
    stopPlaces: [],
  });
  const grid = parseCityPopulationGrid({
    schemaVersion: '1.0.0',
    cityId: 'Q36730',
    gridVersion: '1.0.0',
    originCellCenter: { longitude: -0.699, latitude: 37.984 },
    resolutionDegrees: 0.001,
    rowDirection: 'north-to-south',
    columnDirection: 'west-to-east',
    rows: 5,
    columns: 5,
    populationWeights: Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => 100),
    ),
  });
  const population = {
    grid,
    crop: { rowStart: 0, rowEnd: 5, columnStart: 0, columnEnd: 5 },
    canonicalCells: listActivePopulationCells(grid),
  };
  const view = {
    status: 'ready' as const,
    metadata,
    sha256: 'fixture',
    primarySettlementId: 'es-torrevieja',
  };
  return { model, population, view };
}

it('retains nonresidential form with zero population and exposes planned but mostly vacant frontiers', () => {
  const fixture = compactFixture();
  const mature = buildProceduralCity(
    fixture.model,
    fixture.population,
    fixture.view,
  );
  const emptyGrid = parseCityPopulationGrid({
    ...fixture.population.grid,
    populationWeights: Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => 0),
    ),
  });
  const empty = buildProceduralCity(
    fixture.model,
    { ...fixture.population, grid: emptyGrid, canonicalCells: [] },
    fixture.view,
  );
  expect(empty.buildings.length).toBeGreaterThan(0);
  expect(
    empty.buildings.every(
      (b) =>
        b.archetype === 'industrial-shed' || b.archetype === 'commercial-box',
    ),
  ).toBe(true);
  const frontierMetadata = parseSettlementMetadata({
    ...fixture.view.metadata,
    urbanProfiles: fixture.view.metadata.urbanProfiles.map((p) => ({
      ...p,
      urbanEdgeBehavior: 'fragmented',
    })),
  });
  const frontier = buildProceduralCity(fixture.model, fixture.population, {
    ...fixture.view,
    metadata: frontierMetadata,
  });
  expect(frontier.buildings.length).toBeLessThan(
    mature.buildings.length * 0.35,
  );
  expect(frontier.localStreets).toEqual(mature.localStreets);
  for (const block of mature.blocks) {
    const members = mature.buildings.filter((b) => b.blockId === block.id);
    expect(new Set(members.map((b) => b.archetype)).size).toBeLessThanOrEqual(
      1,
    );
    expect(new Set(members.map((b) => b.wallColor)).size).toBeLessThanOrEqual(
      1,
    );
  }
});

it('hard landscape masks beat arbitrary population and also suppress ordinary local streets', () => {
  const fixture = compactFixture();
  const mask = {
    ...researchMetadata.landscapeRegions[0]!,
    boundary: fixture.view.metadata.zones[0]!.boundary,
  };
  const metadata = parseSettlementMetadata({
    ...fixture.view.metadata,
    landscapeRegions: [mask],
  });
  const city = buildProceduralCity(fixture.model, fixture.population, {
    ...fixture.view,
    metadata,
  });
  expect(city.buildings).toEqual([]);
  expect(city.localStreets).toEqual([]);
  const constrained = parseSettlementMetadata({
    ...metadata,
    landscapeRegions: [{ ...mask, buildability: 'strongly-constrained' }],
  });
  const sparse = buildProceduralCity(fixture.model, fixture.population, {
    ...fixture.view,
    metadata: constrained,
  });
  expect(sparse.buildings.length).toBeLessThan(
    buildProceduralCity(fixture.model, fixture.population, fixture.view)
      .buildings.length * 0.2,
  );
});

it('uses orientation confidence and parcel grammar to bound local adaptation and preserve large plots', () => {
  const fixture = compactFixture();
  const variant = (
    confidence: 'low' | 'high',
    pattern: 'fine-grain' | 'superblock',
  ) =>
    buildProceduralCity(fixture.model, fixture.population, {
      ...fixture.view,
      metadata: parseSettlementMetadata({
        ...fixture.view.metadata,
        zones: fixture.view.metadata.zones.map((zone) => ({
          ...zone,
          orientationConfidence: confidence,
        })),
        urbanProfiles: fixture.view.metadata.urbanProfiles.map((profile) => ({
          ...profile,
          orientationBehavior: 'locally-adaptive',
          parcelPattern: pattern,
        })),
      }),
    });
  const confident = variant('high', 'fine-grain');
  const approximate = variant('low', 'fine-grain');
  expect(confident.localStreets).not.toEqual(approximate.localStreets);
  const broad = variant('high', 'superblock');
  expect(broad.buildings.length).toBeLessThan(confident.buildings.length);
  expect(
    broad.buildings.some(
      (building) => building.depth > confident.buildings[0]!.depth,
    ),
  ).toBe(true);
});
