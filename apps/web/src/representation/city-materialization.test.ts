import { expect, it } from 'vitest';
import {
  parseMaterializationCatalog,
  parseMaterializationKits,
  decodeMaterializationGeometry,
} from './city-materialization.js';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { join } from 'node:path';

const source = join(import.meta.dirname, '../../public/urban-assets/');
const read = (path: string) =>
  JSON.parse(readFileSync(source + path, 'utf8')) as unknown;
it('accepts all four verified examples and preserves their immutable source identities', () => {
  const catalog = parseMaterializationCatalog(
    read('es-torrevieja/materialization/catalog.v0.json'),
    'es-torrevieja',
  );
  expect(catalog.sites).toHaveLength(8);
  expect(Object.isFrozen(catalog.sites)).toBe(true);
  expect(
    parseMaterializationKits(read('shared/materialization/kits.v0.json')).kits,
  ).toHaveLength(7);
  for (const site of catalog.sites)
    for (const ref of site.geometries) {
      const geometry = decodeMaterializationGeometry(read(ref.path), ref);
      expect(geometry.id).toBe(ref.sourceFeatureId);
      expect(Object.isFrozen(geometry.geometry.coordinates)).toBe(true);
    }
});
it('installed unrelated population remains accessible through the original ZIP infrastructure', () => {
  expect(
    readFileSync(
      join(import.meta.dirname, '../../public/population-fields/catalog.json'),
      'utf8',
    ),
  ).toContain('es-torrevieja');
});

const sourceCatalog = () =>
  read('es-torrevieja/materialization/catalog.v0.json') as {
    sites: Record<string, unknown>[];
    kitCatalogPath: string;
    settlementId: string;
  };
it.each([
  '../x',
  '/x',
  'x/../y',
  'x/./y',
  'C:/x',
  'x\\y',
  'https://x',
  'x?y',
  'x#y',
  'x%2fy',
  '..',
])('rejects noncanonical path %s', (path) => {
  const data = sourceCatalog();
  data.kitCatalogPath = path;
  expect(() => parseMaterializationCatalog(data, 'es-torrevieja')).toThrow();
});
it('rejects city mismatch, duplicate sites/geometry, empty ready recipes and physical reservations', () => {
  const data = sourceCatalog();
  expect(() => parseMaterializationCatalog(data, 'es-alicante')).toThrow(
    'settlement',
  );
  data.sites.push(data.sites[0]!);
  expect(() => parseMaterializationCatalog(data, 'es-torrevieja')).toThrow(
    'duplicate site',
  );
  const empty = sourceCatalog();
  empty.sites[0]!.recipes = [];
  expect(() => parseMaterializationCatalog(empty, 'es-torrevieja')).toThrow(
    'ready site',
  );
  const bad = sourceCatalog();
  bad.sites[0]!.physical = {
    mode: 'reserve-reviewed-extent',
    approved: true,
    approvalId: 'test',
  };
  expect(() => parseMaterializationCatalog(bad, 'es-torrevieja')).toThrow(
    'unsupported',
  );
  const duplicate = sourceCatalog();
  const refs = duplicate.sites[0]!.geometries as unknown[];
  refs.push(refs[0]);
  expect(() => parseMaterializationCatalog(duplicate, 'es-torrevieja')).toThrow(
    'duplicate geometry',
  );
  const other = sourceCatalog();
  (other.sites[0]!.geometries as { path: string }[])[0]!.path =
    'es-elche/materialization/shape.geojson';
  expect(() => parseMaterializationCatalog(other, 'es-torrevieja')).toThrow(
    'another city',
  );
  const shared = sourceCatalog();
  shared.kitCatalogPath = 'other/kits.json';
  expect(() => parseMaterializationCatalog(shared, 'es-torrevieja')).toThrow(
    'shared kit',
  );
  const malformed = sourceCatalog();
  malformed.sites[0]!.lod = { A: 'other', B: 'full', C: 'full' };
  expect(() =>
    parseMaterializationCatalog(malformed, 'es-torrevieja'),
  ).toThrow();
});
it('supports disabled/unmaterialized sites without geometry and rejects duplicate kit identities', () => {
  const data = sourceCatalog();
  data.sites = [
    { ...data.sites[0], stage: 'disabled', geometries: [], recipes: [] },
  ];
  expect(
    parseMaterializationCatalog(data, 'es-torrevieja').sites[0]!.stage,
  ).toBe('disabled');
  data.sites[0]!.stage = 'unmaterialized';
  expect(
    parseMaterializationCatalog(data, 'es-torrevieja').sites[0]!.stage,
  ).toBe('unmaterialized');
  const kits = read('shared/materialization/kits.v0.json') as {
    kits: unknown[];
  };
  kits.kits.push(kits.kits[0]);
  expect(() => parseMaterializationKits(kits)).toThrow('duplicate kit');
});
it('validates roles, holes, closures, self intersections, precision and source identity without rewriting input', () => {
  const ref = parseMaterializationCatalog(sourceCatalog(), 'es-torrevieja')
    .sites[0]!.geometries[0]!;
  const outer = [
    [0, 0],
    [0.01, 0],
    [0.01, 0.01],
    [0, 0.01],
    [0, 0],
  ];
  const shape = (coordinates: number[][][]) => ({
    type: 'Feature',
    id: ref.sourceFeatureId,
    properties: {},
    geometry: { type: 'Polygon', coordinates },
  });
  const hole = [
    [0.002, 0.002],
    [0.002, 0.003],
    [0.003, 0.003],
    [0.003, 0.002],
    [0.002, 0.002],
  ];
  const value = shape([outer, hole]),
    before = JSON.stringify(value);
  expect(decodeMaterializationGeometry(value, ref).geometry.type).toBe(
    'Polygon',
  );
  expect(JSON.stringify(value)).toBe(before);
  expect(() =>
    decodeMaterializationGeometry({ ...value, id: 'wrong' }, ref),
  ).toThrow('identity');
  expect(() =>
    decodeMaterializationGeometry(shape([outer.slice(0, -1)]), ref),
  ).toThrow();
  expect(() =>
    decodeMaterializationGeometry(
      shape([
        [
          [0, 0],
          [0.01, 0],
          [0, 0],
          [0, 0],
        ],
      ]),
      ref,
    ),
  ).toThrow('degenerate');
  expect(() =>
    decodeMaterializationGeometry(
      shape([
        [
          [0, 0],
          [0.01, 0.01],
          [0.01, 0],
          [0, 0.008],
          [0, 0],
        ],
      ]),
      ref,
    ),
  ).toThrow('self-intersecting');
  expect(() =>
    decodeMaterializationGeometry(
      shape([
        outer,
        [
          [0.02, 0.02],
          [0.03, 0.02],
          [0.03, 0.03],
          [0.02, 0.02],
        ],
      ]),
      ref,
    ),
  ).toThrow('hole outside');
  const precise = structuredClone(shape([outer]));
  precise.geometry.coordinates[0]![1]![0] = 0.010000001;
  expect(() => decodeMaterializationGeometry(precise, ref)).toThrow(
    'seven decimals',
  );
  const duplicated = shape([
    [
      [0, 0],
      [0.01, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
      [0, 0],
    ],
  ]);
  expect(
    decodeMaterializationGeometry(duplicated, ref).geometry.coordinates,
  ).toEqual(duplicated.geometry.coordinates);
  expect(
    decodeMaterializationGeometry(
      {
        ...value,
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[outer], [outer, hole]],
        },
      },
      ref,
    ).geometry.type,
  ).toBe('MultiPolygon');
  for (const role of ['layout-guide', 'mooring-line'] as const) {
    expect(
      decodeMaterializationGeometry(
        {
          ...value,
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0.01, 0.01],
            ],
          },
        },
        { ...ref, role },
      ).geometry.type,
    ).toBe('LineString');
    expect(
      decodeMaterializationGeometry(
        {
          ...value,
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [0, 0],
                [0.01, 0.01],
              ],
            ],
          },
        },
        { ...ref, role },
      ).geometry.type,
    ).toBe('MultiLineString');
    expect(() =>
      decodeMaterializationGeometry(value, { ...ref, role }),
    ).toThrow('guide geometry');
  }
  expect(
    decodeMaterializationGeometry(
      { ...value, geometry: { type: 'Point', coordinates: [0, 0] } },
      { ...ref, role: 'anchor' },
    ).geometry.type,
  ).toBe('Point');
  expect(() =>
    decodeMaterializationGeometry(value, { ...ref, role: 'anchor' }),
  ).toThrow('anchor geometry');
  expect(() =>
    decodeMaterializationGeometry(
      { ...value, geometry: { type: 'Point', coordinates: [0, 0] } },
      ref,
    ),
  ).toThrow('extent geometry');
});

it('rejects touching/self-overlapping rings and holes crossing a concave exterior or another hole', () => {
  const ref = parseMaterializationCatalog(sourceCatalog(), 'es-torrevieja')
    .sites[0]!.geometries[0]!;
  const shape = (coordinates: number[][][]) => ({
    type: 'Feature',
    id: ref.sourceFeatureId,
    properties: {},
    geometry: { type: 'Polygon', coordinates },
  });
  const outer = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.002],
      [0.002, 0.002],
      [0.002, 0.008],
      [0.01, 0.008],
      [0.01, 0.01],
      [0, 0.01],
      [0, 0],
    ],
    hole = [
      [0.001, 0.001],
      [0.009, 0.001],
      [0.009, 0.009],
      [0.001, 0.009],
      [0.001, 0.001],
    ];
  expect(() =>
    decodeMaterializationGeometry(shape([outer, hole]), ref),
  ).toThrow('hole');
  const square = [
      [0, 0],
      [0.02, 0],
      [0.02, 0.02],
      [0, 0.02],
      [0, 0],
    ],
    h1 = [
      [0.002, 0.002],
      [0.01, 0.002],
      [0.01, 0.01],
      [0.002, 0.01],
      [0.002, 0.002],
    ],
    h2 = [
      [0.006, 0.006],
      [0.015, 0.006],
      [0.015, 0.015],
      [0.006, 0.015],
      [0.006, 0.006],
    ];
  expect(() =>
    decodeMaterializationGeometry(shape([square, h1, h2]), ref),
  ).toThrow('hole');
  const touch = [
    [0, 0],
    [0.01, 0],
    [0.005, 0.005],
    [0.01, 0.01],
    [0, 0.01],
    [0.005, 0.005],
    [0, 0],
  ];
  expect(() => decodeMaterializationGeometry(shape([touch]), ref)).toThrow(
    'self-intersecting',
  );
});

it('accepts separate holes but rejects both orders of nested holes', () => {
  const ref = parseMaterializationCatalog(sourceCatalog(), 'es-torrevieja')
    .sites[0]!.geometries[0]!;
  const outer = [
      [0, 0],
      [0.02, 0],
      [0.02, 0.02],
      [0, 0.02],
      [0, 0],
    ],
    small = [
      [0.003, 0.003],
      [0.004, 0.003],
      [0.004, 0.004],
      [0.003, 0.004],
      [0.003, 0.003],
    ],
    large = [
      [0.002, 0.002],
      [0.01, 0.002],
      [0.01, 0.01],
      [0.002, 0.01],
      [0.002, 0.002],
    ],
    other = [
      [0.012, 0.012],
      [0.015, 0.012],
      [0.015, 0.015],
      [0.012, 0.015],
      [0.012, 0.012],
    ];
  const shape = (coordinates: number[][][]) => ({
    type: 'Feature',
    id: ref.sourceFeatureId,
    properties: {},
    geometry: { type: 'Polygon', coordinates },
  });
  expect(
    decodeMaterializationGeometry(shape([outer, small, other]), ref).geometry
      .type,
  ).toBe('Polygon');
  for (const holes of [
    [small, large],
    [large, small],
  ])
    expect(() =>
      decodeMaterializationGeometry(shape([outer, ...holes]), ref),
    ).toThrow('overlapping holes');
});
