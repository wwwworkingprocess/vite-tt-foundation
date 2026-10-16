import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { createStreetCellLoader } from './street-cells-loader.js';
import { createCityMaterializationLoader } from './city-materialization-loader.js';
import { prepareCityMaterialization } from './d3d-materialization.js';
import {
  prepareLandscapeDetails,
  createLandscapeSafety,
} from './d3d-landscape-scene.js';
import { prepareStreetCellMaskQueries } from './d3d-street-cell-masks.js';
import {
  buildStreetCellCity,
  streetCellLandmarkProtections,
} from './d3d-street-cell-city.js';
import {
  cellCityMap,
  cellCityTerrain,
  cellCityMetadata,
  cellCityPopulation,
  elcheCellCityFixture,
  alicanteCellCityFixture,
} from '../test/street-cell-city-fixture.js';
import { footprintInside, footprintRing } from './d3d-footprint.js';
const input = {
  baseUrl: '/',
  digestSha256: async (s: string) =>
    createHash('sha256').update(s).digest('hex'),
  fetchText: async (url: string) => ({
    ok: true,
    text: async () =>
      readFileSync(new URL('../../public' + url, import.meta.url), 'utf8'),
  }),
};
const loader = createStreetCellLoader(input),
  siteLoader = createCityMaterializationLoader(input);
const fixtures = await Promise.all(
  [
    {
      id: 'es-torrevieja',
      model: cellCityMap,
      terrain: cellCityTerrain,
      population: cellCityPopulation,
      view: cellCityMetadata,
      expected: 16231,
    },
    {
      id: 'es-elche',
      ...elcheCellCityFixture(),
      view: undefined,
      expected: 6510,
    },
    {
      id: 'es-alicante',
      ...alicanteCellCityFixture(),
      view: undefined,
      expected: 13804,
    },
  ].map(async (f) => {
    const cells = (await loader.resolve(f.id))!,
      protections = f.view
        ? streetCellLandmarkProtections(f.model, f.view)
        : undefined;
    const city = buildStreetCellCity(
        f.model,
        f.population,
        f.view,
        cells,
        f.terrain,
        protections,
      ),
      before = JSON.stringify(city.buildings);
    const sites = await siteLoader.resolve(f.id, 'near');
    const sitePlan = sites
      ? prepareCityMaterialization(sites, f.model, f.terrain, 'near')
      : undefined;
    const args = {
      cityId: f.id,
      cells,
      model: f.model,
      terrain: f.terrain,
      city,
      sites,
      sitePlan,
    };
    const near = prepareLandscapeDetails({ ...args, lod: 'near' }),
      medium = prepareLandscapeDetails({ ...args, lod: 'medium' }),
      far = prepareLandscapeDetails({ ...args, lod: 'far' });
    return { ...f, ...args, before, near, medium, far };
  }),
);
it.each(fixtures)(
  'keeps every $id building and exact source mask unchanged while adding only safe cached ornaments',
  (f) => {
    expect(f.city.buildings).toHaveLength(f.expected);
    expect(JSON.stringify(f.city.buildings)).toBe(f.before);
    const args = {
      cityId: f.id,
      cells: f.cells,
      model: f.model,
      terrain: f.terrain,
      city: f.city,
      sites: f.sites,
      sitePlan: f.sitePlan,
      lod: 'near' as const,
    };
    expect(prepareLandscapeDetails(args)).toBe(f.near);
    expect(f.far.instances).toHaveLength(0);
    expect(f.near.triangles).toBeLessThanOrEqual(180000);
    expect(f.near.instances.length).toBeLessThanOrEqual(8000);
    expect(f.medium.triangles).toBeLessThanOrEqual(40000);
    if (f.id === 'es-alicante') {
      expect(f.near.instances).toHaveLength(0);
      expect(f.near.availability).toBe('unavailable');
      return;
    }
    expect(f.near.instances.length).toBeGreaterThan(10);
    const masks = prepareStreetCellMaskQueries(
      f.cells.masks!,
      f.model,
    ).features;
    const safety = createLandscapeSafety(args);
    for (const i of f.near.instances) {
      const ring = footprintRing(i),
        mask = masks.find((m) => m.id === i.maskId)!;
      expect(mask.type).not.toBe(0);
      expect(footprintInside(ring, mask.rings, 0.001 * f.terrain.metre)).toBe(
        true,
      );
      expect(safety.reject(ring)).toBeUndefined();
    }
    expect(f.near.instances.some((i) => i.maskId.includes('R14960789'))).toBe(
      false,
    );
    expect(
      f.medium.instances.every((i) =>
        f.near.instances.some(
          (n) => n.id === i.id && n.x === i.x && n.z === i.z,
        ),
      ),
    ).toBe(true);
  },
);
import { groundLandscapeInstances } from './d3d-landscape-scene.js';
import { d3dGeographicPoint } from './d3d-map-model.js';
it('handles absent masks/road evidence and explicitly rejects wrong-city or non-C inputs', () => {
  const f = fixtures[0]!;
  expect(() =>
    prepareLandscapeDetails({ ...f, cityId: 'es-alicante', lod: 'far' }),
  ).toThrow('Landscape C');
  expect(() =>
    prepareLandscapeDetails({
      ...f,
      cells: { ...f.cells, level: 'A' },
      lod: 'far',
    }),
  ).toThrow('Landscape C');
  const { masks, ...legacy } = f.cells;
  expect(masks!.availability).toBe('available');
  const p = prepareLandscapeDetails({ ...f, cells: legacy, lod: 'near' });
  expect(p.instances).toHaveLength(0);
  expect(p.availability).toBe('legacy');
  const { annotations, ...unannotated } = f.cells;
  expect(annotations).toBeDefined();
  const safety = createLandscapeSafety({ ...f, cells: unannotated });
  expect(safety.reject(footprintRing(f.near.instances[0]!))).toBe('road');
});
it('checks actual building bodies, native bounds and transport reservations independently of the mask classification', () => {
  const f = fixtures[0]!,
    item = f.near.instances[0]!,
    ring = footprintRing(item),
    base = createLandscapeSafety(f);
  expect(base.reject(ring)).toBeUndefined();
  const building = {
    ...f.city.buildings[0]!,
    ...item,
    id: 'test-building-body',
  };
  expect(
    createLandscapeSafety({
      ...f,
      city: { ...f.city, buildings: [building] },
    }).reject(ring),
  ).toBe('building');
  expect(
    createLandscapeSafety({
      ...f,
      city: {
        ...f.city,
        reservations: [
          {
            id: 'test-reservation',
            x: item.x,
            z: item.z,
            radius: 10 * f.terrain.metre,
          },
        ],
      },
    }).reject(ring),
  ).toBe('transport');
  expect(
    base.reject(footprintRing({ ...item, x: f.terrain.bounds.maxX + 100 })),
  ).toBe('native-surface');
});
it('supports real polygon components and actual kit footprints while never buffering an unverified point', () => {
  const f = fixtures[0]!,
    item = f.near.instances[0]!,
    ring = footprintRing(item),
    site = f.sites!.sites[0]!,
    shape = site.geometries[0]!;
  const geographic = ring.map(([x, z]) => {
    const p = d3dGeographicPoint(f.model, { x, z });
    return [p.longitude, p.latitude] as const;
  });
  const multi = {
    ...f.sites!,
    sites: [
      {
        ...site,
        geometries: [
          {
            ...shape,
            feature: {
              ...shape.feature,
              geometry: {
                type: 'MultiPolygon' as const,
                coordinates: [[geographic]],
              },
            },
          },
        ],
      },
    ],
  };
  expect(createLandscapeSafety({ ...f, sites: multi }).reject(ring)).toBe(
    'site',
  );
  const point = {
    ...f.sites!,
    sites: [
      {
        ...site,
        geometries: [
          {
            ...shape,
            reference: { ...shape.reference, role: 'anchor' as const },
            feature: {
              ...shape.feature,
              geometry: { type: 'Point' as const, coordinates: geographic[0]! },
            },
          },
        ],
      },
    ],
  };
  expect(
    createLandscapeSafety({ ...f, sites: point, sitePlan: undefined }).reject(
      ring,
    ),
  ).toBeUndefined();
  const instance = {
    ...item,
    siteId: 'test-verified-kit',
    kit: 'park-tree-v0' as const,
  };
  expect(
    createLandscapeSafety({
      ...f,
      sites: point,
      sitePlan: { ...f.sitePlan!, instances: [instance] },
    }).reject(ring),
  ).toBe('site');
});
it('reports missing displayed supports per mask without moving inputs or inventing floating bases', () => {
  const i = fixtures[0]!.near.instances[0]!,
    j = { ...i, id: 'other', maskId: 'other-mask', x: i.x + 10 };
  const result = groundLandscapeInstances(
    [i, j],
    (x) => (x === i.x ? 2 : undefined),
    0.045,
  );
  expect(result.instances).toEqual([{ ...i, y: 2.045 }]);
  expect(result.unsupportedSupports).toEqual({ 'other-mask': 1 });
  expect(i.y).not.toBe(2.045);
  const twice = groundLandscapeInstances(
    [j, { ...j, id: 'third' }],
    () => undefined,
    0.045,
  );
  expect(twice.unsupportedSupports).toEqual({ 'other-mask': 2 });
});
it('does no placement work for a fresh far view even with available masks', () => {
  const far = prepareLandscapeDetails({
    ...fixtures[0]!,
    lod: 'far',
    overrides: {},
  });
  expect(far.instances).toHaveLength(0);
  expect(far.proposals).toBe(0);
  expect(far.diagnostics).toEqual([]);
  expect(far.terrainIndexBytes).toBe(0);
});
it('keeps decorations out of overlapping typed inland water even when the provisional native raster says LAND', () => {
  const f = fixtures[0]!,
    item = f.near.instances[0]!,
    ring = footprintRing(item),
    source = f.cells.masks!.features.find((m) => m.properties.t === 0)!;
  const geographic = (r: ReturnType<typeof footprintRing>) =>
    r.map(([x, z]) => {
      const p = d3dGeographicPoint(f.model, { x, z });
      return [p.longitude, p.latitude] as const;
    });
  const water = {
    ...source,
    id: 'synthetic-water-overlap',
    geometry: { type: 'Polygon' as const, coordinates: [geographic(ring)] },
  };
  const cells = {
    ...f.cells,
    masks: { ...f.cells.masks!, features: [...f.cells.masks!.features, water] },
  };
  expect(f.terrain.sample(item.x, item.z).kind).toBe('land');
  expect(createLandscapeSafety({ ...f, cells }).reject(ring)).toBe(
    'inland-water',
  );
  const withHole = {
    ...water,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        geographic(
          footprintRing({
            ...item,
            width: item.width * 3,
            depth: item.depth * 3,
          }),
        ),
        geographic(
          footprintRing({
            ...item,
            width: item.width * 2,
            depth: item.depth * 2,
          }),
        ),
      ],
    },
  };
  expect(
    createLandscapeSafety({
      ...f,
      cells: { ...cells, masks: { ...cells.masks, features: [withHole] } },
    }).reject(ring),
  ).toBeUndefined();
});
