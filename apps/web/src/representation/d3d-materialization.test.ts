import { expect, it } from 'vitest';
import { prepareCityMaterialization } from './d3d-materialization.js';
import { createCityMaterializationLoader } from './city-materialization-loader.js';
import {
  cellCityMap,
  cellCityTerrain,
} from '../test/street-cell-city-fixture.js';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = join(import.meta.dirname, '../../public/urban-assets/');
it('prepares clipped terrain-following surfaces and bounded reusable kits without scene entities', async () => {
  const loader = createCityMaterializationLoader({
    baseUrl: '/',
    digestSha256: async (s) => createHash('sha256').update(s).digest('hex'),
    fetchText: async (url) => ({
      ok: true,
      text: async () => {
        const p = url.split('/urban-assets/')[1]!;
        if (p === 'catalog.json')
          return JSON.stringify({
            schemaVersion: '0.1.0',
            settlements: {
              'es-torrevieja': { catalog: 'es-torrevieja/catalog.json' },
            },
          });
        if (p === 'es-torrevieja/catalog.json')
          return JSON.stringify({
            schemaVersion: '0.1.0',
            settlementId: 'es-torrevieja',
            collections: { materialization: 'materialization/catalog.v0.json' },
          });
        return readFileSync(root + p, 'utf8');
      },
    }),
  });
  const data = (await loader.resolve('es-torrevieja', 'near'))!;
  const plan = prepareCityMaterialization(
    data,
    cellCityMap,
    cellCityTerrain,
    'near',
  );
  expect(plan.surfaces).toHaveLength(5);
  expect(plan.instances.length).toBeGreaterThan(2);
  expect(plan.instances.length).toBeLessThanOrEqual(330);
  expect(plan.surfaces.every((s) => s.positions.every(Number.isFinite))).toBe(
    true,
  );
  expect(
    prepareCityMaterialization(data, cellCityMap, cellCityTerrain, 'near'),
  ).toBe(plan);
});

import {
  parseMaterializationCatalog,
  parseMaterializationKits,
  decodeMaterializationGeometry,
  type MaterializationRecipe,
  type CityMaterialization,
} from './city-materialization.js';
import type { D3dTerrain } from './d3d-terrain-model.js';
const catalog = parseMaterializationCatalog(
  JSON.parse(
    readFileSync(
      root + 'es-torrevieja/materialization/catalog.v0.json',
      'utf8',
    ),
  ),
  'es-torrevieja',
);
const kits = parseMaterializationKits(
  JSON.parse(
    readFileSync(root + 'shared/materialization/kits.v0.json', 'utf8'),
  ),
);
const outer = [
  [-0.685, 37.976],
  [-0.683, 37.976],
  [-0.683, 37.978],
  [-0.685, 37.978],
  [-0.685, 37.976],
];
function dataFor(
  recipes: readonly MaterializationRecipe[],
  geometries: readonly {
    role: 'extent' | 'anchor' | 'layout-guide' | 'mooring-line';
    geometry: unknown;
  }[] = [
    { role: 'extent', geometry: { type: 'Polygon', coordinates: [outer] } },
  ],
): CityMaterialization {
  const site = { ...catalog.sites[0]!, id: 'ua-site-test', recipes };
  const refs = geometries.map((g, i) => ({
    ...site.geometries[0]!,
    role: g.role,
    sourceFeatureId: 'W' + i,
  }));
  return {
    catalog,
    kits,
    sites: [
      {
        site,
        geometries: geometries.map((g, i) => ({
          reference: refs[i]!,
          feature: decodeMaterializationGeometry(
            {
              type: 'Feature',
              id: 'W' + i,
              properties: {},
              geometry: g.geometry,
            },
            refs[i]!,
          ),
        })),
      },
    ],
  };
}
const land: D3dTerrain = {
  ...cellCityTerrain,
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100, minY: -10, maxY: 10 },
  ground: (x, z) => ({ y: (x + z) * 0.01, diagnostic: 'native' }),
  sample: () => ({ kind: 'land', elevation: 0 }),
};
const single: MaterializationRecipe = {
  kind: 'single-kit',
  kitId: 'ua-kit-tower-proxy-v0',
  placement: 'anchor',
  rotationDeg: 30,
};
it('places an anchor-only supported proxy on native ground without inventing an area polygon', () => {
  const data = dataFor(
    [single],
    [
      {
        role: 'anchor',
        geometry: { type: 'Point', coordinates: [-0.684, 37.977] },
      },
    ],
  );
  const plan = prepareCityMaterialization(data, cellCityMap, land, 'near');
  expect(plan.instances).toHaveLength(1);
  const i = plan.instances[0]!;
  expect(i.y).toBeCloseTo(land.ground(i.x, i.z).y + 0.08 * land.metre);
  expect(i.rotation).toBeCloseTo(Math.PI / 6);
});
it('keeps repeat subsets/IDs deterministic and full envelopes inside holes/exterior with one unscaled ground clearance', () => {
  for (const pattern of ['rows', 'grid', 'scattered'] as const) {
    const recipe: MaterializationRecipe = {
      kind: 'area-repeat',
      kitId: 'ua-kit-park-tree-v0',
      pattern,
      spacingM: 16,
      maxInstances: 40,
      orientation: 'north',
      lodFractions: { A: 0, B: 0.25, C: 1 },
    };
    const data = dataFor([recipe]);
    const medium = prepareCityMaterialization(
        data,
        cellCityMap,
        land,
        'medium',
      ),
      near = prepareCityMaterialization(data, cellCityMap, land, 'near');
    expect(medium.instances).toHaveLength(10);
    expect(near.instances).toHaveLength(40);
    expect(near.instances.slice(0, 10)).toEqual(medium.instances);
    for (const i of near.instances) {
      expect(i.y).toBeCloseTo(land.ground(i.x, i.z).y + 0.08 * land.metre);
      expect(i.rotation).toBe(0);
      const rings = [
        outer.map((p) => {
          const q = d3dProjectedPoint(cellCityMap, {
            longitude: p[0]!,
            latitude: p[1]!,
          });
          return [q.x, q.z] as const;
        }),
      ];
      expect(footprintInside(footprintRing(i), rings, 0)).toBe(true);
    }
    expect(
      prepareCityMaterialization(data, cellCityMap, { ...land }, 'near'),
    ).not.toBe(near);
  }
});

import { footprintInside, footprintRing } from './d3d-footprint.js';
import { d3dProjectedPoint } from './d3d-map-model.js';
it('clips every surface support to native coverage, retains holes and agrees with exaggerated native ground and upward winding', () => {
  const hole = [
    [-0.6844, 37.9766],
    [-0.6844, 37.9774],
    [-0.6836, 37.9774],
    [-0.6836, 37.9766],
    [-0.6844, 37.9766],
  ];
  const data = dataFor(
    [
      {
        kind: 'surface',
        preset: 'beach-sand-v0',
        terrainRule: 'native-land',
        clearanceM: 0.04,
      },
    ],
    [
      {
        role: 'extent',
        geometry: { type: 'Polygon', coordinates: [outer, hole] },
      },
    ],
  );
  const project = (p: number[]) => {
    const w = d3dProjectedPoint(cellCityMap, {
      longitude: p[0]!,
      latitude: p[1]!,
    });
    return [w.x, w.z] as const;
  };
  const rings = [outer, hole].map((r) => r.map(project)),
    bounds = {
      ...land.bounds,
      minX: project([-0.6848, 37.976])[0],
      maxX: project([-0.6832, 37.976])[0],
    };
  const terrain = { ...land, bounds },
    plan = prepareCityMaterialization(data, cellCityMap, terrain, 'near');
  expect(plan.triangles).toBeGreaterThan(10);
  const p = plan.surfaces[0]!.positions;
  for (let i = 0; i < p.length; i += 9) {
    const a = [p[i]!, p[i + 2]!] as const,
      b = [p[i + 3]!, p[i + 5]!] as const,
      c = [p[i + 6]!, p[i + 8]!] as const;
    expect(
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ).toBeLessThanOrEqual(1e-6);
    for (let v = i; v < i + 9; v += 3) {
      expect(p[v]).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
      expect(p[v]).toBeLessThanOrEqual(bounds.maxX + 1e-6);
      expect(p[v + 1]).toBeCloseTo(
        terrain.ground(p[v]!, p[v + 2]!).y + 0.04 * terrain.metre,
        5,
      );
    }
    const center = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
    ] as const;
    expect(footprintInside([center, center, center, center], rings, 0)).toBe(
      true,
    );
  }
});
it('retains native LAND/WATER rules and reports visual water/DEM mismatches without mutating any native samples', () => {
  const water: D3dTerrain = {
    ...land,
    sample: () => ({ kind: 'water' }),
    ground: () => ({ y: 0, diagnostic: 'native' }),
  };
  const landRecipe: MaterializationRecipe = {
    kind: 'surface',
    preset: 'beach-sand-v0',
    terrainRule: 'native-land',
    clearanceM: 0.04,
  };
  const rejected = prepareCityMaterialization(
    dataFor([landRecipe]),
    cellCityMap,
    water,
    'far',
  );
  expect(rejected.triangles).toBe(0);
  expect(rejected.diagnostics[0]!.maskMismatches).toBeGreaterThan(0);
  const waterRecipe: MaterializationRecipe = {
    ...landRecipe,
    preset: 'harbor-water-v0',
    terrainRule: 'native-water',
  };
  expect(
    prepareCityMaterialization(
      dataFor([waterRecipe]),
      cellCityMap,
      water,
      'near',
    ).triangles,
  ).toBeGreaterThan(0);
  expect(
    prepareCityMaterialization(
      dataFor([waterRecipe]),
      cellCityMap,
      land,
      'near',
    ).triangles,
  ).toBe(0);
  const both: MaterializationRecipe = {
    ...landRecipe,
    preset: 'salt-lagoon-pink-v0',
    terrainRule: 'native-both',
  };
  const pink = prepareCityMaterialization(
    dataFor([both]),
    cellCityMap,
    land,
    'near',
  );
  expect(pink.diagnostics[0]!.maskMismatches).toBe(pink.triangles);
  expect(land.terrain).toBe(cellCityTerrain.terrain);
  expect(land.terrain.statistics.nativeSamples).toBe(161680);
});
it('rejects missing guides/extents/anchors, handles actual multi-polygons and skips unsupported GLB models explicitly', () => {
  const repeat: MaterializationRecipe = {
    kind: 'area-repeat',
    kitId: 'ua-kit-park-tree-v0',
    pattern: 'grid',
    spacingM: 20,
    maxInstances: 10,
    orientation: 'site-long-axis',
    lodFractions: { A: 0, B: 0.5, C: 1 },
  };
  const anchor = {
    role: 'anchor' as const,
    geometry: { type: 'Point', coordinates: [-0.684, 37.977] },
  };
  expect(() =>
    prepareCityMaterialization(
      dataFor([repeat], [anchor]),
      cellCityMap,
      land,
      'near',
    ),
  ).toThrow('extent missing');
  expect(() =>
    prepareCityMaterialization(dataFor([single]), cellCityMap, land, 'near'),
  ).toThrow('anchor missing');
  expect(() =>
    prepareCityMaterialization(
      dataFor([{ ...single, placement: 'extent-centroid' }], [anchor]),
      cellCityMap,
      land,
      'near',
    ),
  ).toThrow('extent missing');
  const line: MaterializationRecipe = {
    kind: 'line-repeat',
    kitId: 'ua-kit-small-boat-v0',
    geometryRole: 'mooring-line',
    spacingM: 15,
    maxInstances: 20,
    lodFractions: { A: 0, B: 0.5, C: 1 },
  };
  expect(() =>
    prepareCityMaterialization(dataFor([line]), cellCityMap, land, 'near'),
  ).toThrow('guide missing');
  const model: MaterializationRecipe = {
    kind: 'glb-model',
    assetPath: 'shared/materialization/models/example.glb',
    assetSha256: 'a'.repeat(64),
    placement: 'anchor',
    rotationDeg: 0,
    scale: 1,
  };
  const glb = prepareCityMaterialization(
    dataFor([model]),
    cellCityMap,
    land,
    'near',
  );
  expect(glb.instances).toEqual([]);
  expect(glb.diagnostics[0]!.unsupportedModels).toBe(1);
  const multi = prepareCityMaterialization(
    dataFor(
      [{ ...repeat, orientation: 'site-long-axis' }],
      [
        {
          role: 'extent',
          geometry: { type: 'MultiPolygon', coordinates: [[outer], [outer]] },
        },
      ],
    ),
    cellCityMap,
    land,
    'near',
  );
  expect(multi.instances).toHaveLength(10);
});
it('places bounded boats only along actual tagged guides, preserving source order and ground clearance', () => {
  const recipe: MaterializationRecipe = {
    kind: 'line-repeat',
    kitId: 'ua-kit-small-boat-v0',
    geometryRole: 'mooring-line',
    spacingM: 15,
    maxInstances: 20,
    lodFractions: { A: 0, B: 0.5, C: 1 },
  };
  const water: D3dTerrain = {
    ...land,
    sample: () => ({ kind: 'water' }),
    ground: () => ({ y: 0, diagnostic: 'native' }),
  };
  for (const type of ['LineString', 'MultiLineString'] as const) {
    const line = [
        [-0.6848, 37.977],
        [-0.684, 37.977],
        [-0.6832, 37.977],
      ],
      geometry = { type, coordinates: type === 'LineString' ? line : [line] };
    const data = dataFor(
      [recipe],
      [
        { role: 'extent', geometry: { type: 'Polygon', coordinates: [outer] } },
        { role: 'mooring-line', geometry },
      ],
    );
    const medium = prepareCityMaterialization(
        data,
        cellCityMap,
        water,
        'medium',
      ),
      near = prepareCityMaterialization(data, cellCityMap, water, 'near');
    expect(near.instances.length).toBeGreaterThan(0);
    expect(near.instances.slice(0, medium.instances.length)).toEqual(
      medium.instances,
    );
    expect(
      near.instances.every((i) => Math.abs(i.y - 0.08 * water.metre) < 1e-10),
    ).toBe(true);
    expect(
      prepareCityMaterialization(data, cellCityMap, land, 'near').instances,
    ).toEqual([]);
  }
});
it('does not place proxies/instances outside coverage or genuine safe extents and bounds all preparation work', () => {
  const narrow = [
    [-0.685, 37.977],
    [-0.683, 37.977],
    [-0.683, 37.977001],
    [-0.685, 37.977001],
    [-0.685, 37.977],
  ];
  const proxy = dataFor(
    [{ ...single, placement: 'extent-centroid' }],
    [{ role: 'extent', geometry: { type: 'Polygon', coordinates: [narrow] } }],
  );
  expect(
    prepareCityMaterialization(proxy, cellCityMap, land, 'near').instances,
  ).toHaveLength(0);
  const outside = {
    ...land,
    bounds: { ...land.bounds, minX: 90, maxX: 100, minZ: 90, maxZ: 100 },
  };
  expect(
    prepareCityMaterialization(
      dataFor([{ ...single, placement: 'extent-centroid' }]),
      cellCityMap,
      outside,
      'near',
    ).instances,
  ).toHaveLength(0);
  const surface: MaterializationRecipe = {
    kind: 'surface',
    preset: 'park-ground-v0',
    terrainRule: 'native-both',
    clearanceM: 0.04,
  };
  expect(
    prepareCityMaterialization(dataFor([surface]), cellCityMap, outside, 'near')
      .triangles,
  ).toBe(0);
  expect(() =>
    prepareCityMaterialization(
      dataFor([surface]),
      cellCityMap,
      { ...land, metre: 1e-10 },
      'near',
    ),
  ).toThrow('support depth');
  const crowded: MaterializationRecipe = {
    kind: 'area-repeat',
    kitId: 'ua-kit-market-canopy-v0',
    pattern: 'grid',
    spacingM: 0.001,
    maxInstances: 2000,
    orientation: 'north',
    lodFractions: { A: 1, B: 1, C: 1 },
  };
  expect(() =>
    prepareCityMaterialization(
      dataFor(
        [crowded],
        [
          {
            role: 'extent',
            geometry: { type: 'Polygon', coordinates: [narrow] },
          },
        ],
      ),
      cellCityMap,
      land,
      'near',
    ),
  ).toThrow('proposal budget');
  const many: MaterializationRecipe = { ...crowded, spacingM: 2 };
  const wide = [
    [-0.69, 37.97],
    [-0.67, 37.97],
    [-0.67, 37.99],
    [-0.69, 37.99],
    [-0.69, 37.97],
  ];
  expect(() =>
    prepareCityMaterialization(
      dataFor(
        [many, many, many],
        [
          {
            role: 'extent',
            geometry: { type: 'Polygon', coordinates: [wide] },
          },
        ],
      ),
      cellCityMap,
      land,
      'near',
    ),
  ).toThrow('instance budget');
});

it('uses verified layout guide orientation for area layouts, requires guides and rejects malformed ready associations', () => {
  const repeat: MaterializationRecipe = {
    kind: 'area-repeat',
    kitId: 'ua-kit-park-tree-v0',
    pattern: 'rows',
    spacingM: 20,
    maxInstances: 10,
    orientation: 'layout-guide',
    lodFractions: { A: 0, B: 0.5, C: 1 },
  };
  expect(() =>
    prepareCityMaterialization(dataFor([repeat]), cellCityMap, land, 'near'),
  ).toThrow('layout guide missing');
  for (const type of ['LineString', 'MultiLineString'] as const) {
    const line = [
        [-0.6845, 37.9765],
        [-0.6835, 37.9775],
      ],
      geometry = { type, coordinates: type === 'LineString' ? line : [line] };
    const data = dataFor(
      [repeat],
      [
        { role: 'extent', geometry: { type: 'Polygon', coordinates: [outer] } },
        { role: 'layout-guide', geometry },
      ],
    );
    const plan = prepareCityMaterialization(data, cellCityMap, land, 'near');
    expect(plan.instances).toHaveLength(10);
    expect(plan.instances[0]!.rotation).not.toBe(0);
  }
  const anchor = dataFor(
    [single],
    [
      {
        role: 'anchor',
        geometry: { type: 'Point', coordinates: [-0.684, 37.977] },
      },
    ],
  );
  const entry = anchor.sites[0]!;
  const badExtent = {
    ...anchor,
    sites: [
      {
        ...entry,
        geometries: entry.geometries.map((g) => ({
          ...g,
          reference: { ...g.reference, role: 'extent' as const },
        })),
      },
    ],
  };
  expect(() =>
    prepareCityMaterialization(badExtent, cellCityMap, land, 'near'),
  ).toThrow('extent geometry invalid');
  const line: MaterializationRecipe = {
    kind: 'line-repeat',
    kitId: 'ua-kit-small-boat-v0',
    geometryRole: 'mooring-line',
    spacingM: 15,
    maxInstances: 20,
    lodFractions: { A: 0, B: 0.5, C: 1 },
  };
  const badGuide = {
    ...anchor,
    sites: [
      {
        ...entry,
        site: { ...entry.site, recipes: [line] },
        geometries: entry.geometries.map((g) => ({
          ...g,
          reference: { ...g.reference, role: 'mooring-line' as const },
        })),
      },
    ],
  };
  expect(() =>
    prepareCityMaterialization(badGuide, cellCityMap, land, 'near'),
  ).toThrow('guide geometry invalid');
});
it('bounds emitted and rejected triangle work and emits no degenerate coverage-edge faces', () => {
  const surface: MaterializationRecipe = {
    kind: 'surface',
    preset: 'park-ground-v0',
    terrainRule: 'native-land',
    clearanceM: 0.04,
  };
  const wide = [
    [-0.69, 37.97],
    [-0.67, 37.97],
    [-0.67, 37.99],
    [-0.69, 37.99],
    [-0.69, 37.97],
  ];
  for (const kind of ['land', 'water'] as const) {
    const terrain: D3dTerrain = {
      ...land,
      metre: 0.00015,
      sample: () => (kind === 'land' ? { kind, elevation: 0 } : { kind }),
    };
    expect(() =>
      prepareCityMaterialization(
        dataFor(
          [surface],
          [
            {
              role: 'extent',
              geometry: { type: 'Polygon', coordinates: [wide] },
            },
          ],
        ),
        cellCityMap,
        terrain,
        'near',
      ),
    ).toThrow('triangle budget');
  }
  const x = d3dProjectedPoint(cellCityMap, {
    longitude: -0.683,
    latitude: 37.976,
  }).x;
  expect(
    prepareCityMaterialization(
      dataFor([surface]),
      cellCityMap,
      { ...land, bounds: { ...land.bounds, minX: x, maxX: x + 10 } },
      'near',
    ).triangles,
  ).toBe(0);
});

it('places single proxies at the metric polygon area centroid rather than the vertex average', () => {
  const uneven = [
    [-0.685, 37.976],
    [-0.683, 37.976],
    [-0.683, 37.978],
    [-0.685, 37.978],
    [-0.685, 37.9775],
    [-0.685, 37.977],
    [-0.685, 37.9765],
    [-0.685, 37.976],
  ];
  const data = dataFor(
    [{ ...single, placement: 'extent-centroid', rotationDeg: 0 }],
    [{ role: 'extent', geometry: { type: 'Polygon', coordinates: [uneven] } }],
  );
  const point = d3dProjectedPoint(cellCityMap, {
      longitude: -0.684,
      latitude: 37.977,
    }),
    plan = prepareCityMaterialization(data, cellCityMap, land, 'near');
  expect(plan.instances).toHaveLength(1);
  expect(plan.instances[0]!.x).toBeCloseTo(point.x, 8);
  expect(plan.instances[0]!.z).toBeCloseTo(point.z, 8);
});

it('subtracts hole area from proxy centroid while preserving full-envelope safety', () => {
  const hole1 = [
    [-0.6849, 37.9761],
    [-0.6847, 37.9761],
    [-0.6847, 37.9763],
    [-0.6849, 37.9763],
    [-0.6849, 37.9761],
  ];
  const hole2 = [
    [-0.6833, 37.9777],
    [-0.6831, 37.9777],
    [-0.6831, 37.9779],
    [-0.6833, 37.9779],
    [-0.6833, 37.9777],
  ];
  const data = dataFor(
    [{ ...single, placement: 'extent-centroid', rotationDeg: 0 }],
    [
      {
        role: 'extent',
        geometry: { type: 'Polygon', coordinates: [outer, hole1, hole2] },
      },
    ],
  );
  const plan = prepareCityMaterialization(data, cellCityMap, land, 'near'),
    point = d3dProjectedPoint(cellCityMap, {
      longitude: -0.684,
      latitude: 37.977,
    });
  expect(plan.instances).toHaveLength(1);
  expect(plan.instances[0]!.x).toBeCloseTo(point.x, 8);
  expect(plan.instances[0]!.z).toBeCloseTo(point.z, 8);
});

it('bounds global surface/kit draw batches independently of triangle and instance limits', () => {
  const data = dataFor(
    Array.from({ length: 33 }, () => ({
      kind: 'surface' as const,
      preset: 'park-ground-v0' as const,
      terrainRule: 'native-land' as const,
      clearanceM: 0.04,
    })),
  );
  expect(() =>
    prepareCityMaterialization(data, cellCityMap, land, 'far'),
  ).toThrow('batch budget');
});

it('retains mask diagnostics but prepares no empty surface batch for a fully rejected area', () => {
  const data = dataFor([
    {
      kind: 'surface',
      preset: 'harbor-water-v0',
      terrainRule: 'native-water',
      clearanceM: 0.04,
    },
  ]);
  const plan = prepareCityMaterialization(data, cellCityMap, land, 'far');
  expect(plan.triangles).toBe(0);
  expect(plan.surfaces).toHaveLength(0);
  expect(plan.diagnostics[0]!.maskMismatches).toBeGreaterThan(0);
});

it('suppresses the misleading Torrevieja harbor fill in all LODs while retaining diagnostic/site provenance and other-city behavior', () => {
  const recipe: MaterializationRecipe = {
    kind: 'surface',
    preset: 'harbor-water-v0',
    terrainRule: 'native-water',
    clearanceM: 0.04,
  };
  const raw = dataFor([recipe]);
  const data = {
    ...raw,
    sites: raw.sites.map((s) => ({
      ...s,
      site: { ...s.site, id: 'ua-site-es-torrevieja-marina-internacional' },
    })),
  };
  const water: D3dTerrain = {
    ...land,
    sample: () => ({ kind: 'water', elevation: 0 }),
  };
  const source = JSON.stringify(data);
  for (const lod of ['far', 'medium', 'near'] as const) {
    const plan = prepareCityMaterialization(data, cellCityMap, water, lod);
    expect(plan.surfaces).toHaveLength(0);
    expect(plan.triangles).toBe(0);
    expect(plan.diagnostics[0]).toMatchObject({
      siteId: 'ua-site-es-torrevieja-marina-internacional',
      suppressedSurfaces: 1,
    });
  }
  const other = {
    ...data,
    catalog: { ...data.catalog, settlementId: 'es-alicante' },
  };
  expect(
    prepareCityMaterialization(other, cellCityMap, water, 'near').surfaces,
  ).toHaveLength(1);
  expect(JSON.stringify(data)).toBe(source);
});

it('distributes row recipes across the full verified extent rather than exhausting a row-major prefix, keeping B a prefix of C', () => {
  const recipe: MaterializationRecipe = {
    kind: 'area-repeat',
    kitId: 'ua-kit-market-canopy-v0',
    pattern: 'rows',
    spacingM: 10,
    maxInstances: 40,
    orientation: 'north',
    lodFractions: { A: 0, B: 0.25, C: 1 },
  };
  const data = dataFor([recipe]);
  const medium = prepareCityMaterialization(data, cellCityMap, land, 'medium');
  const near = prepareCityMaterialization(data, cellCityMap, land, 'near');
  expect(near.instances).toHaveLength(40);
  expect(medium.instances).toEqual(near.instances.slice(0, 10));
  const corners = outer.map((p) =>
    d3dProjectedPoint(cellCityMap, { longitude: p[0]!, latitude: p[1]! }),
  );
  for (const plan of [medium, near]) {
    for (const axis of ['x', 'z'] as const) {
      const span =
        Math.max(...plan.instances.map((i) => i[axis])) -
        Math.min(...plan.instances.map((i) => i[axis]));
      const extent =
        Math.max(...corners.map((i) => i[axis])) -
        Math.min(...corners.map((i) => i[axis]));
      expect(span / extent).toBeGreaterThan(0.55);
    }
    expect(
      new Set(plan.instances.map((i) => i.id.split(':').at(-2))).size,
    ).toBeGreaterThanOrEqual(3);
    for (const i of plan.instances)
      expect(
        footprintInside(
          footprintRing(i),
          [corners.map((p) => [p.x, p.z] as const)],
          0,
        ),
      ).toBe(true);
  }
});

it('retains verified pink polygon supports and native grounding with bounded deterministic regional tone weights, without global recoloring', () => {
  const recipe: MaterializationRecipe = {
    kind: 'surface',
    preset: 'salt-lagoon-pink-v0',
    terrainRule: 'native-both',
    clearanceM: 0.04,
  };
  const data = dataFor([recipe]);
  const before = JSON.stringify(data);
  for (const lod of ['far', 'medium', 'near'] as const) {
    const plan = prepareCityMaterialization(data, cellCityMap, land, lod);
    const surface = plan.surfaces[0]!;
    expect(surface.toneWeights).toHaveLength(surface.positions.length / 3);
    expect(Math.min(...surface.toneWeights!)).toBeGreaterThanOrEqual(0.94);
    expect(Math.max(...surface.toneWeights!)).toBeLessThanOrEqual(1.06);
    expect(new Set(surface.toneWeights).size).toBeGreaterThan(1);
    for (let i = 0; i < surface.positions.length; i += 3)
      expect(surface.positions[i + 1]).toBeCloseTo(
        land.ground(surface.positions[i]!, surface.positions[i + 2]!).y +
          0.04 * land.metre,
        5,
      );
    expect(prepareCityMaterialization(data, cellCityMap, land, lod)).toBe(plan);
  }
  expect(JSON.stringify(data)).toBe(before);
  const other = {
    ...data,
    catalog: { ...data.catalog, settlementId: 'es-alicante' },
  };
  expect(
    prepareCityMaterialization(other, cellCityMap, land, 'near').surfaces[0]!
      .toneWeights,
  ).toBeUndefined();
});

it('spreads the real market over separated whole-footprint-safe rows at B/C and preserves every park instance', async () => {
  const loader = createCityMaterializationLoader({
    baseUrl: '/',
    digestSha256: async (s) => createHash('sha256').update(s).digest('hex'),
    fetchText: async (url) => ({
      ok: true,
      text: async () =>
        readFileSync(root + url.split('/urban-assets/')[1]!, 'utf8'),
    }),
  });
  const b = (await loader.resolve('es-torrevieja', 'medium'))!,
    c = (await loader.resolve('es-torrevieja', 'near'))!;
  const medium = prepareCityMaterialization(
      b,
      cellCityMap,
      cellCityTerrain,
      'medium',
    ),
    near = prepareCityMaterialization(c, cellCityMap, cellCityTerrain, 'near');
  const siteId = 'ua-site-es-torrevieja-friday-market',
    market = near.instances.filter((i) => i.siteId === siteId),
    reduced = medium.instances.filter((i) => i.siteId === siteId);
  expect(market).toHaveLength(160);
  expect(reduced).toHaveLength(80);
  expect(market.slice(0, 80)).toEqual(reduced);
  // Real surface interpolation must not bury native-grounded canopy rooftops.
  for (const plan of [medium, near]) {
    const positions = plan.surfaces.find((s) => s.siteId === siteId)!.positions;
    for (const canopy of plan.instances.filter((i) => i.siteId === siteId)) {
      for (let n = 0; n < positions.length; n += 9) {
        const ax = positions[n]!,
          az = positions[n + 2]!,
          bx = positions[n + 3]!,
          bz = positions[n + 5]!,
          cx = positions[n + 6]!,
          cz = positions[n + 8]!,
          denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        const u =
            ((bz - cz) * (canopy.x - cx) + (cx - bx) * (canopy.z - cz)) /
            denominator,
          v =
            ((cz - az) * (canopy.x - cx) + (ax - cx) * (canopy.z - cz)) /
            denominator,
          w = 1 - u - v;
        if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6)
          expect(
            u * positions[n + 1]! +
              v * positions[n + 4]! +
              w * positions[n + 7]!,
          ).toBeLessThan(canopy.y + canopy.height * 1.01);
      }
    }
  }
  const polygon = c.sites.find((s) => s.site.id === siteId)!.geometries[0]!
    .feature.geometry;
  expect(polygon.type).toBe('Polygon');
  if (polygon.type !== 'Polygon') throw Error('Expected real market polygon');
  const rings = polygon.coordinates.map((r) =>
    r.map(([longitude, latitude]) => {
      const p = d3dProjectedPoint(cellCityMap, { longitude, latitude });
      return [p.x, p.z] as const;
    }),
  );
  const angle = market[0]!.rotation,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const local = (x: number, z: number) => [
    cos * x - sin * z,
    sin * x + cos * z,
  ];
  const corners = rings[0]!.map((p) => local(...p));
  for (const items of [reduced, market])
    for (const axis of [0, 1]) {
      const values = items.map((i) => local(i.x, i.z)[axis]!);
      expect(
        (Math.max(...values) - Math.min(...values)) /
          (Math.max(...corners.map((p) => p[axis]!)) -
            Math.min(...corners.map((p) => p[axis]!))),
      ).toBeGreaterThan(0.7);
    }
  const rows = new Map<string, number>();
  for (const i of market) {
    expect(footprintInside(footprintRing(i), rings, 0)).toBe(true);
    expect(i.width / cellCityTerrain.metre).toBe(8);
    expect(i.depth / cellCityTerrain.metre).toBe(6);
    rows.set(i.id.split(':').at(-2)!, local(i.x, i.z)[1]!);
  }
  expect(rows.size).toBeGreaterThanOrEqual(3);
  const rowPositions = [...rows.values()].sort((a, b) => a - b);
  for (let i = 1; i < rowPositions.length; i++)
    expect(
      (rowPositions[i]! - rowPositions[i - 1]!) / cellCityTerrain.metre,
    ).toBeGreaterThan(19.99);
  const park = near.instances.filter(
    (i) => i.siteId === 'ua-site-es-torrevieja-parque-naciones',
  );
  expect(createHash('sha256').update(JSON.stringify(park)).digest('hex')).toBe(
    '283ddfebb84bafd4d948c9556b0b565f400fff666c77b420dfd5654ae3c7e5ae',
  );
});

it('rejects pathological row densities before allocating candidates or querying native ground', () => {
  const recipe: MaterializationRecipe = {
    kind: 'area-repeat',
    kitId: 'ua-kit-market-canopy-v0',
    pattern: 'rows',
    spacingM: 0.0001,
    maxInstances: 1,
    orientation: 'north',
    lodFractions: { A: 1, B: 1, C: 1 },
  };
  const terrain = {
    ...land,
    sample: () => {
      throw Error('Unexpected native query before row budget validation');
    },
  };
  expect(() =>
    prepareCityMaterialization(dataFor([recipe]), cellCityMap, terrain, 'near'),
  ).toThrow('Materialization proposal budget exceeded');
});

it('retains narrow verified extents but produces no row envelope when either fitting dimension is unavailable', () => {
  const recipe: MaterializationRecipe = {
    kind: 'area-repeat',
    kitId: 'ua-kit-market-canopy-v0',
    pattern: 'rows',
    spacingM: 10,
    maxInstances: 2,
    orientation: 'north',
    lodFractions: { A: 1, B: 1, C: 1 },
  };
  for (const [width, height] of [
    [0.000005, 0.002],
    [0.002, 0.000005],
  ]) {
    const x = -0.685,
      y = 37.976;
    const ring = [
      [x, y],
      [x + width!, y],
      [x + width!, y + height!],
      [x, y + height!],
      [x, y],
    ];
    const data = dataFor(
      [recipe],
      [{ role: 'extent', geometry: { type: 'Polygon', coordinates: [ring] } }],
    );
    const before = JSON.stringify(data);
    const plan = prepareCityMaterialization(data, cellCityMap, land, 'near');
    expect(plan.instances).toHaveLength(0);
    expect(plan.diagnostics).toHaveLength(1);
    expect(JSON.stringify(data)).toBe(before);
  }
});
