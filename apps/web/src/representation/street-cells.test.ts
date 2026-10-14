import { createHash } from 'node:crypto';
import { readFileSync as rawRead } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { indexZip, verifyZipEntry } from '../assets/zip-layer.js';
import {
  streetCellRoot,
  streetCellJson,
  streetCellFixture,
} from '../test/street-cells-fixture.js';
import {
  parseStreetCellCatalog,
  decodeStreetCells,
  decodeStreetCellAnnotations,
} from './street-cells.js';
type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};
// The real JSON fixture is intentionally mutable for boundary corruption tests.
const catalogInput = streetCellJson('catalog.json') as Mutable<
  ReturnType<typeof parseStreetCellCatalog>
>;
const catalog = () => parseStreetCellCatalog(catalogInput);
const descriptor = () => catalog().settlements['es-torrevieja']!.products[2]!;
it('preserves the accepted archive CRCs, provenance, all descriptors and immutable exact polygons including holes', () => {
  const zip = rawRead(streetCellRoot + 'street-cells.zip');
  expect(createHash('sha256').update(zip).digest('hex')).toBe(
    '710e6aaaec11c8003cda936502d1b65769810a8c4bedf5b09dd5f5d4960976c3',
  );
  const entries = indexZip(zip);
  expect(entries.size).toBe(19);
  for (const entry of Object.values(catalog().settlements))
    for (const p of [
      ...entry.products,
      entry.audit,
      entry.annotations,
      entry.hierarchy,
    ]) {
      const e = entries.get(p.path)!;
      const b = verifyZipEntry(e, inflateRawSync(e.compressed));
      expect(b.length).toBe(p.byteLength);
      expect(createHash('sha256').update(b).digest('hex')).toBe(p.sha256);
    }
  const city = catalog().settlements['es-torrevieja']!;
  expect(city.products.map((p) => p.featureCount)).toEqual([84, 584, 1623]);
  for (const p of [
    ...city.products,
    city.audit,
    city.annotations,
    city.hierarchy,
  ]) {
    const e = entries.get(p.path)!;
    const b = verifyZipEntry(e, inflateRawSync(e.compressed));
    expect(b.length).toBe(p.byteLength);
    expect(createHash('sha256').update(b).digest('hex')).toBe(p.sha256);
  }
  expect(
    createHash('sha256')
      .update(rawRead(streetCellRoot + '../road-network/road-network.zip'))
      .digest('hex'),
  ).toBe(city.source.roadArchiveSha256);
  const data = streetCellJson(descriptor().path);
  const model = decodeStreetCells(data, 'es-torrevieja', descriptor());
  expect(model.features).toEqual((data as { features: unknown[] }).features);
  expect(model.features).toHaveLength(1623);
  expect(
    model.features.reduce((n, f) => n + f.geometry.coordinates.length - 1, 0),
  ).toBe(8);
  expect(Object.isFrozen(model.features[0]!.geometry.coordinates[0]![0])).toBe(
    true,
  );
  expect(Object.isFrozen(model.features[0]!.properties.sourceRoadIds)).toBe(
    true,
  );
  expect(
    Object.isFrozen(catalog().settlements['es-torrevieja']!.source.products),
  ).toBe(true);
});
it.each([
  (x: typeof catalogInput) => {
    Reflect.set(x, 'version', '1');
  },
  (x: typeof catalogInput) => {
    Reflect.set(x, 'coordinateSemantics', 'clipped');
  },
  (x: typeof catalogInput) => {
    Reflect.set(x, 'extra', true);
  },
  (x: typeof catalogInput) => {
    x.settlements['../bad'] = x.settlements['es-torrevieja']!;
  },
  (x: typeof catalogInput) => {
    x.settlements['es-torrevieja']!.products[0]!.path = '../other';
  },
  (x: typeof catalogInput) => {
    x.settlements['es-torrevieja']!.audit.path = 'es-elche/audit.v0.json';
  },
  (x: typeof catalogInput) => {
    x.settlements['es-torrevieja']!.source.products[0]!.path =
      'es-elche/roads-a.v0.geojson';
  },
  (x: typeof catalogInput) => {
    x.settlements['es-torrevieja']!.products[1]!.level = 'A';
  },
  (x: typeof catalogInput) => {
    x.settlements['es-torrevieja']!.products.pop();
  },
  (x: typeof catalogInput) => {
    x.settlements['es-torrevieja']!.source.products[1]!.level = 'A';
  },
  (x: typeof catalogInput) => {
    x.settlements['es-torrevieja']!.products[0]!.byteLength = 0;
  },
  (x: typeof catalogInput) => {
    x.settlements['es-torrevieja']!.products[0]!.sha256 = 'x';
  },
  (x: typeof catalogInput) => {
    Reflect.set(
      x.settlements['es-torrevieja']!.source,
      'roadCatalogSchema',
      'future',
    );
  },
])(
  'rejects malformed catalog identity, paths, descriptors and provenance %#',
  (mutate) => {
    const copy = structuredClone(catalogInput);
    mutate(copy);
    expect(() => parseStreetCellCatalog(copy)).toThrow();
  },
);
it.each<(x: ReturnType<typeof streetCellFixture>) => void>([
  (x: ReturnType<typeof streetCellFixture>) => {
    x.type = 'Polygon';
  },
  (x) => {
    x.features.pop();
  },
  (x) => {
    x.features[1]!.id = x.features[0]!.id;
  },
  (x) => {
    x.features[0]!.properties.level = 'B';
  },
  (x) => {
    x.features[0]!.properties.settlementId = 'es-elche';
  },
  (x) => {
    x.features[0]!.properties.areaSqm = 0;
  },
  (x) => {
    x.features[0]!.properties.perimeterM = Infinity;
  },
  (x) => {
    x.features[0]!.properties.sourceRoadIds = [];
  },
  (x) => {
    x.features[0]!.geometry.coordinates[0]![0]![0] = 181;
  },
  (x) => {
    x.features[0]!.geometry.coordinates[0]![0]!.push(2);
  },
  (x) => {
    x.features[0]!.geometry.coordinates[0]!.pop();
  },
  (x) => {
    x.features[1]!.geometry.coordinates[1]!.pop();
  },
  (x) => {
    x.features[0]!.geometry.coordinates[0]![1] =
      x.features[0]!.geometry.coordinates[0]![0]!;
  },
])('rejects corrupted C without repairing source rings %#', (mutate) => {
  const data = streetCellFixture();
  mutate(data);
  expect(() =>
    decodeStreetCells(data, 'es-torrevieja', {
      ...descriptor(),
      featureCount: 2,
    }),
  ).toThrow();
});

it('rejects a non-C declared product even if feature metadata claims C', () => {
  expect(() =>
    decodeStreetCells(streetCellFixture(), 'es-torrevieja', {
      ...descriptor(),
      level: 'B',
      featureCount: 2,
    }),
  ).toThrow('city-scoped feature ID');
});

it.each([null, [], 'catalog', new Date()])(
  'rejects non-JSON catalog object %#',
  (value) => {
    expect(() => parseStreetCellCatalog(value)).toThrow('object');
  },
);
it('accepts an empty valid coverage dictionary and JSON dictionaries with null prototypes', () => {
  const copy = structuredClone(catalogInput);
  copy.settlements = Object.create(null) as typeof copy.settlements;
  expect(parseStreetCellCatalog(copy).settlements).toEqual({});
  Object.assign(copy.settlements, catalogInput.settlements);
  expect(Object.isFrozen(parseStreetCellCatalog(copy).settlements)).toBe(true);
});
it.each<(x: typeof catalogInput) => void>([
  (x) => {
    Reflect.set(x, 'settlements', []);
  },
  (x) => {
    Reflect.set(x.settlements['es-torrevieja']!, 'products', 'bad');
  },
  (x) => {
    x.settlements['es-torrevieja']!.products[0]!.byteLength = 1.5;
  },
  (x) => {
    Reflect.set(x.settlements['es-torrevieja']!.products[0]!, 'level', 'D');
  },
  (x) => {
    const o = x.settlements['es-torrevieja']!.audit;
    Reflect.deleteProperty(o, 'sha256');
    Reflect.set(o, 'other', 'x');
  },
])(
  'rejects wrong dictionary/array/integer/level and disguised missing fields %#',
  (mutate) => {
    const copy = structuredClone(catalogInput);
    mutate(copy);
    expect(() => parseStreetCellCatalog(copy)).toThrow();
  },
);
it.each<(x: ReturnType<typeof streetCellFixture>) => void>([
  (x) => {
    x.features[0]!.id = '';
  },
  (x) => {
    x.features[0]!.type = 'Other';
  },
  (x) => {
    x.features[0]!.geometry.type = 'LineString';
  },
  (x) => {
    x.features[0]!.geometry.coordinates = [];
  },
  (x) => {
    x.features[1]!.geometry.coordinates[1] = [];
  },
  (x) => {
    x.features[0]!.geometry.coordinates[0]![0]![0] = NaN;
  },
  (x) => {
    x.features[0]!.geometry.coordinates[0]![0]![1] = 91;
  },
  (x) => {
    x.features[0]!.geometry.coordinates[0]![0]![1] = Infinity;
  },
  (x) => {
    Reflect.set(x.features[0]!.geometry.coordinates[0]![0]!, 0, 'longitude');
  },
  (x) => {
    Reflect.set(x.features[0]!.properties, 'areaSqm', 'area');
  },
  (x) => {
    x.features[0]!.properties.sourceRoadIds = [''];
  },
  (x) => {
    x.features[0]!.geometry.coordinates[0]![4] = [-0.699, 37.98];
  },
])(
  'rejects malformed feature/holes/pairs/metadata without source repair %#',
  (mutate) => {
    const copy = streetCellFixture();
    mutate(copy);
    expect(() =>
      decodeStreetCells(copy, 'es-torrevieja', {
        ...descriptor(),
        featureCount: 2,
      }),
    ).toThrow();
  },
);

// Decode immutable installed products once; test bodies retain every city/level assertion.
const installedV3Products = (() => {
  const entries = indexZip(rawRead(streetCellRoot + 'street-cells.zip'));
  const json = (path: string): unknown => {
    const e = entries.get(path)!;
    return JSON.parse(
      Buffer.from(verifyZipEntry(e, inflateRawSync(e.compressed))).toString(
        'utf8',
      ),
    );
  };
  const installed = parseStreetCellCatalog(json('catalog.json'));
  return Object.entries(installed.settlements).map(([city, entry]) => ({
    city,
    entry,
    products: entry.products.map((product) => {
      const model = decodeStreetCells(json(product.path), city, product);
      const annotations =
        product.level === 'C'
          ? decodeStreetCellAnnotations(
              json(entry.annotations.path),
              model,
              entry.source.products[2]!.sha256,
            )
          : undefined;
      return { product, model, annotations };
    }),
  }));
})();
it('consumes the actual V3 dictionary and stable-ID annotations for all three installed cities', () => {
  for (const { city, entry, products } of installedV3Products) {
    const counts =
      city === 'es-torrevieja'
        ? [84, 584, 1623, 1437]
        : city === 'es-alicante'
          ? [348, 1411, 3201, 2759]
          : [326, 815, 1865, 1561];
    expect(entry.products.map((p) => p.featureCount)).toEqual(
      counts.slice(0, 3),
    );
    for (const { product, model, annotations } of products) {
      expect(model.level).toBe(product.level);
      expect(model.features).toHaveLength(product.featureCount);
      if (annotations) {
        expect(
          Object.values(annotations.cells).filter(
            (c) => c.safeZoneCoordinates !== null,
          ),
        ).toHaveLength(counts[3]!);
        expect(Object.isFrozen(annotations.cells)).toBe(true);
      }
    }
  }
});

const annotationTemplate = streetCellJson(
  'es-torrevieja/annotations-c.v3.json',
) as Record<string, unknown>;
function annotationFixture(): Record<string, unknown> & {
  cells: unknown[][];
  roadMetadata: Record<string, unknown[]>;
} {
  const raw = annotationTemplate;
  return {
    ...raw,
    cells: streetCellFixture().features.map(
      (f) =>
        [
          Number(f.id.split('-sc-')[1]),
          'empty',
          f.geometry.coordinates[0]![0]!,
          f.geometry.coordinates,
          f.properties.areaSqm,
          [],
          [[['W1'], 4]],
          [
            [
              'W1',
              0,
              'internal',
              2,
              null,
              [
                [-0.7, 37.98],
                [-0.699, 37.98],
              ],
            ],
          ],
          [1, 1, 1, 1, 1, 0, 0, null, null],
        ] as unknown[],
    ),
    roadMetadata: {
      '"W1"': [
        'residential',
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        true,
        [4, 'class-fallback'],
      ],
    },
  };
}
const annotationModel = () =>
  decodeStreetCells(streetCellFixture(), 'es-torrevieja', {
    ...descriptor(),
    featureCount: 2,
  });
const annotationRoadHash =
  catalog().settlements['es-torrevieja']!.source.products[2]!.sha256;
it('preserves named safe-zone holes, margins and clipped guide records independently of tuple order', () => {
  const raw = annotationFixture();
  raw.cells.reverse();
  const a = decodeStreetCellAnnotations(
    raw,
    annotationModel(),
    annotationRoadHash,
  );
  expect(a.cells['es-torrevieja-sc-2']!.safeZoneCoordinates).toEqual(
    streetCellFixture().features[1]!.geometry.coordinates,
  );
  expect(a.cells['es-torrevieja-sc-1']!.roads[0]).toEqual({
    roadId: 'W1',
    sourceSegment: 0,
    disposition: 'internal',
    lengthM: 2,
    corridorAreaSqm: null,
    clippedCoordinates: [
      [-0.7, 37.98],
      [-0.699, 37.98],
    ],
  });
  expect(a.cells['es-torrevieja-sc-1']!.margins[0]).toEqual({
    roadIds: ['W1'],
    appliedClearanceM: 4,
  });
  expect(
    Object.isFrozen(
      a.cells['es-torrevieja-sc-1']!.roads[0]!.clippedCoordinates![0],
    ),
  ).toBe(true);
  expect(Object.isFrozen(a.roadMetadata)).toBe(true);
});
it.each<(x: ReturnType<typeof annotationFixture>) => void>([
  (x) => {
    x.schemaVersion = 'old';
  },
  (x) => {
    x.settlementId = 'es-elche';
  },
  (x) => {
    x.roadProductSha256 = 'a'.repeat(64);
  },
  (x) => {
    x.marginPolicy = 'invented';
  },
  (x) => {
    x.coordinateEncoding = 'rounded';
  },
  (x) => {
    x.crs = 'EPSG:3035';
  },
  (x) => {
    x.keys = {};
  },
  (x) => {
    x.widthConfidence = { other: 'high', tag: 'medium' };
  },
  (x) => {
    x.candidatePairs = 0.5;
  },
  (x) => {
    x.cells[0]!.pop();
  },
  (x) => {
    x.cells[0]![0] = 'unknown';
  },
  (x) => {
    x.cells.push(x.cells[0]!);
  },
  (x) => {
    x.cells.pop();
  },
  (x) => {
    x.cells[0]![1] = 'unbuilt';
  },
  (x) => {
    x.cells[0]![3] = null;
  },
  (x) => {
    x.cells[0]![4] = 0;
  },
  (x) => {
    x.cells[0]![1] = 'non-drawable';
  },
  (x) => {
    x.cells[0]![4] = -1;
  },
  (x) => {
    x.cells[0]![3] = [
      [
        [-0.7, 37.98],
        [-0.699, 37.98],
        [-0.699, 37.981],
      ],
    ];
  },
  (x) => {
    x.cells[0]![3] = [
      streetCellFixture().features[0]!.geometry.coordinates[0],
      [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ],
    ];
  },
  (x) => {
    x.cells[0]![6] = [[[], 4]];
  },
  (x) => {
    x.cells[0]![6] = [[['unknown'], 4]];
  },
  (x) => {
    x.cells[0]![6] = [[['W1'], 0]];
  },
  (x) => {
    x.cells[0]![6] = [[['W1'], 4, 5]];
  },
  (x) => {
    x.cells[0]![7] = [['W1', 0, 'internal']];
  },
  (x) => {
    x.cells[0]![7] = [
      [
        'W1',
        0.1,
        'internal',
        2,
        null,
        [
          [1, 1],
          [2, 2],
        ],
      ],
    ];
  },
  (x) => {
    x.cells[0]![7] = [['W1', 0, 'other']];
  },
  (x) => {
    x.cells[0]![7] = [['W1', 0, 'internal', 2, null, [[1, 1]]]];
  },
  (x) => {
    x.cells[0]![7] = [
      [
        'W1',
        0,
        'internal',
        2,
        -1,
        [
          [1, 1],
          [2, 2],
        ],
      ],
    ];
  },
  (x) => {
    x.cells[0]![7] = [['W1', 0]];
  },
  (x) => {
    x.roadMetadata = { '"W1"': [] };
  },
  (x) => {
    x.roadMetadata = {
      '"W1"': [
        'residential',
        {},
        null,
        null,
        null,
        null,
        null,
        false,
        true,
        [4, 'class-fallback'],
      ],
    };
  },
  (x) => {
    x.roadMetadata = {
      '"W1"': [
        'residential',
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        true,
        [4, 'class-fallback'],
      ],
    };
  },
  (x) => {
    x.roadMetadata = {
      '"W1"': [
        'residential',
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        true,
        [4],
      ],
    };
  },
  (x) => {
    x.roadMetadata = {
      '"W1"': [
        'residential',
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        true,
        [4, 'guessed'],
      ],
    };
  },
  (x) => {
    x.roadMetadata = {
      '"W1"': [
        'residential',
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        0,
        [4, 'class-fallback'],
      ],
    };
  },
  (x) => {
    x.cells[0]![2] = [0, Infinity];
  },
  (x) => {
    x.cells[0]![5] = [''];
  },
])(
  'rejects corrupt V3 annotations without inventing safe zones %#',
  (mutate) => {
    const input = annotationFixture();
    mutate(input);
    expect(() =>
      decodeStreetCellAnnotations(input, annotationModel(), annotationRoadHash),
    ).toThrow();
  },
);
it('retains explicit non-drawables and compact unmeasured associations', () => {
  const input = annotationFixture();
  input.cells[0]![1] = 'non-drawable';
  input.cells[0]![3] = null;
  input.cells[0]![4] = 0;
  input.cells[0]![8] = [0, 0, null, null, null, null, null, null, null];
  input.cells[0]![7] = [
    ['W1', 0, 'non-drawable-candidate'],
    ['W1', 1, 'grade-separated'],
  ];
  const a = decodeStreetCellAnnotations(
    input,
    annotationModel(),
    annotationRoadHash,
  );
  expect(a.cells['es-torrevieja-sc-1']!.safeZoneCoordinates).toBeNull();
  expect(a.cells['es-torrevieja-sc-1']!.roads[0]!.lengthM).toBeNull();
});
it('rejects non-finite exporter metadata and wrong merged policies while retaining numeric/boolean/null provenance', () => {
  const copy = structuredClone(catalogInput);
  Reflect.set(copy.settlements['es-torrevieja']!.source, 'roadCity', {
    ...(copy.settlements['es-torrevieja']!.source.roadCity as object),
    source: { invalid: Infinity },
  });
  expect(() => parseStreetCellCatalog(copy)).toThrow('finite metadata');
  const d = catalog().settlements['es-torrevieja']!.products[0]!;
  const input = streetCellJson(d.path) as {
    features: { properties: { mergePolicy: string } }[];
  };
  input.features[0]!.properties.mergePolicy = 'bad';
  expect(() => decodeStreetCells(input, 'es-torrevieja', d)).toThrow(
    'merge policy',
  );
});
it.each(['es-torrevieja', 'es-alicante'])(
  'checks all %s archive descriptors, source road identities and hierarchy footprint conservation offline',
  (city) => {
    const e = catalog().settlements[city]!;
    const models = Object.fromEntries(
      e.products.map((p) => [
        p.level,
        decodeStreetCells(streetCellJson(p.path), city, p),
      ]),
    );
    const h = streetCellJson(e.hierarchy.path) as {
      schemaVersion: string;
      settlementId: string;
      aToB: [string, string[]][];
      bToC: [string, string[]][];
      nextIds: Record<string, number>;
    };
    expect(h.schemaVersion).toBe('street-cells-hierarchy-v2');
    expect(h.settlementId).toBe(city);
    for (const [mapping, parent, child] of [
      [h.aToB, 'A', 'B'],
      [h.bToC, 'B', 'C'],
    ] as const) {
      const parents = new Map(models[parent]!.features.map((f) => [f.id, f])),
        children = new Map(models[child]!.features.map((f) => [f.id, f]));
      expect(mapping).toHaveLength(parents.size);
      expect(new Set(mapping.flatMap((t) => t[1])).size).toBe(children.size);
      expect(mapping.flatMap((t) => t[1])).toHaveLength(children.size);
      for (const [id, ids] of mapping) {
        const edges = (rings: readonly (readonly (readonly number[])[])[]) =>
          rings.flatMap((r) =>
            r
              .slice(1)
              .map((p, i) =>
                [JSON.stringify(p), JSON.stringify(r[i])].sort().join('|'),
              ),
          );
        const parity = new Set<string>();
        for (const childId of ids)
          for (const edge of edges(
            children.get(childId)!.geometry.coordinates,
          )) {
            if (parity.has(edge)) parity.delete(edge);
            else parity.add(edge);
          }
        expect(new Set(edges(parents.get(id)!.geometry.coordinates))).toEqual(
          parity,
        );
        expect(parents.has(id)).toBe(true);
        expect(ids.every((id) => children.has(id))).toBe(true);
        expect(parents.get(id)!.properties.areaSqm).toBeCloseTo(
          ids.reduce(
            (sum, id) => sum + children.get(id)!.properties.areaSqm,
            0,
          ),
          5,
        );
      }
      expect(h.nextIds[parent]).toBe(parents.size + 1);
    }
    const entries = indexZip(rawRead(streetCellRoot + 'street-cells.zip'));
    for (const d of [...e.products, e.annotations, e.audit, e.hierarchy]) {
      const entry = entries.get(d.path)!;
      const b = verifyZipEntry(entry, inflateRawSync(entry.compressed));
      expect(b.length).toBe(d.byteLength);
      expect(createHash('sha256').update(b).digest('hex')).toBe(d.sha256);
    }
    const roadEntries = indexZip(
      rawRead(streetCellRoot + '../road-network/road-network.zip'),
    );
    const roadRoot = roadEntries.get('catalog.json')!;
    const roads = JSON.parse(
      Buffer.from(
        verifyZipEntry(roadRoot, inflateRawSync(roadRoot.compressed)),
      ).toString('utf8'),
    ) as {
      settlements: Record<
        string,
        {
          products: {
            level: string;
            path: string;
            sha256: string;
            byteLength: number;
          }[];
        }
      >;
    };
    for (const source of e.source.products) {
      const road = roads.settlements[city]!.products.find(
        (p) => p.level === source.level,
      )!;
      expect({
        path: road.path,
        sha256: road.sha256,
        byteLength: road.byteLength,
      }).toEqual({
        path: source.path,
        sha256: source.sha256,
        byteLength: source.byteLength,
      });
    }
  },
);
