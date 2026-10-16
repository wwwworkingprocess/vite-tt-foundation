import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { indexZip, verifyZipEntry } from '../assets/zip-layer.js';
import { parseStreetCellCatalog, decodeStreetCells } from './street-cells.js';
import { decodeStreetCellMasks } from './street-cell-masks.js';
import {
  buildStreetCellCity,
  auditStreetCellBuildings,
} from './d3d-street-cell-city.js';
import {
  cellCityCells,
  cellCityMap,
  cellCityPopulation,
  cellCityTerrain,
} from '../test/street-cell-city-fixture.js';
import { d3dGeographicPoint, d3dProjectedPoint } from './d3d-map-model.js';
import { footprintRing, footprintOverlaps } from './d3d-footprint.js';
import type { StreetCells } from './street-cells.js';
import {
  prepareStreetCellMaskQueries,
  estimateStreetCellRemainder,
} from './d3d-street-cell-masks.js';
import type { StreetCellMasks } from './street-cell-masks.js';

const bytes = readFileSync(
  join(import.meta.dirname, '../../public/street-cells/street-cells.zip'),
);
const entries = indexZip(bytes);
const json = (path: string): unknown => {
  const e = entries.get(path)!;
  return JSON.parse(
    Buffer.from(
      verifyZipEntry(e, e.method ? inflateRawSync(e.compressed) : e.compressed),
    ).toString(),
  );
};
const rawObject = (value: unknown) => value as Record<string, unknown>;
const firstMask = (value: Record<string, unknown>) =>
  (
    value.features as {
      id: string;
      geometry: { type: string; coordinates: number[][][] };
      properties: { t: number; src: string; part: number; sources: number[] };
    }[]
  )[0]!;
const real = () => {
  const catalog = parseStreetCellCatalog(json('catalog.json'));
  const entry = catalog.settlements['es-torrevieja']!;
  const cells = decodeStreetCells(
    json(entry.products[2]!.path),
    'es-torrevieja',
    entry.products[2]!,
  );
  const m = rawObject(json(entry.masks!.path)),
    r = rawObject(json(entry.cellMaskRefs!.path));
  return {
    catalog,
    entry,
    cells,
    m,
    r,
    decode: () =>
      decodeStreetCellMasks(m, r, cells, entry.masks!, entry.cellMaskRefs!),
  };
};
it('validates the owner V4 archive and joins masks to every immutable C ID, retaining source completeness', () => {
  const catalog = parseStreetCellCatalog(json('catalog.json'));
  expect(catalog.schemaVersion).toBe('street-cells-catalog-v4');
  expect(Object.isFrozen(catalog.maskTypes![0])).toBe(true);
  expect(entries.size).toBe(25);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    'e25c3f6bc0c4e134dc3f0d2683b86a7492df8ebbe7c01cd9e5e7bbf9ac5b8164',
  );
  for (const [city, count, touched, availability] of [
    ['es-torrevieja', 1000, 425, 'available'],
    ['es-elche', 919, 246, 'partial'],
    ['es-alicante', 0, 0, 'unavailable'],
  ] as const) {
    const entry = catalog.settlements[city]!;
    const cells = decodeStreetCells(
      json(entry.products[2]!.path),
      city,
      entry.products[2]!,
    );
    const model = decodeStreetCellMasks(
      json(entry.masks!.path),
      json(entry.cellMaskRefs!.path),
      cells,
      entry.masks!,
      entry.cellMaskRefs!,
    );
    expect(model.features).toHaveLength(count);
    expect(Object.values(model.cellRefs).filter((r) => r.length)).toHaveLength(
      touched,
    );
    expect(model.availability).toBe(availability);
    expect(Object.keys(model.cellRefs)).toHaveLength(cells.features.length);
    expect(Object.isFrozen(model.features)).toBe(true);
    expect(Object.isFrozen(model.cellRefs)).toBe(true);
  }
});

it.each<
  [string, (m: Record<string, unknown>, r: Record<string, unknown>) => void]
>([
  [
    'wrong city',
    (m) => {
      m.settlementId = 'es-elche';
    },
  ],
  [
    'wrong reference city',
    (_m, r) => {
      r.settlementId = 'es-elche';
    },
  ],
  [
    'scope identity',
    (m) => {
      rawObject(m.scope).bounds = [-0.74, 37.94, -0.64, 38.01];
    },
  ],
  [
    'source identity',
    (m) => {
      rawObject((m.sources as unknown[])[0]).sha256 = '0'.repeat(64);
    },
  ],
  [
    'missing mask',
    (m) => {
      (m.features as unknown[]).pop();
    },
  ],
  [
    'missing C reference',
    (_m, r) => {
      (r.cells as unknown[]).pop();
    },
  ],
  [
    'duplicate feature',
    (m) => {
      (m.features as unknown[])[1] = structuredClone(firstMask(m));
    },
  ],
  [
    'unregistered type',
    (m) => {
      firstMask(m).properties.t = 15;
    },
  ],
  [
    'wrong feature city',
    (m) => {
      firstMask(m).id = 'es-elche-mask-s%3AR1-0';
    },
  ],
  [
    'wrong source identity',
    (m) => {
      firstMask(m).properties.src = 'W999';
    },
  ],
  [
    'unknown source',
    (m) => {
      firstMask(m).properties.sources = [99];
    },
  ],
  [
    'duplicated source',
    (m) => {
      const p = firstMask(m).properties;
      p.sources.push(p.sources[0]!);
    },
  ],
  [
    'wrong source selector',
    (m) => {
      firstMask(m).properties.sources = [0];
    },
  ],
  [
    'type inventory mismatch',
    (m) => {
      rawObject(rawObject(m.audit).typeCounts)['0'] = 999;
    },
  ],
  [
    'unknown audit type',
    (m) => {
      rawObject(rawObject(m.audit).typeCounts)['6'] = 1;
    },
  ],
  [
    'capacity mismatch',
    (m) => {
      rawObject(m.audit).omittedCapacity = 0;
    },
  ],
  [
    'candidate count mismatch',
    (m) => {
      rawObject(rawObject(m.audit).typeCandidateCounts)['0'] = 99999;
    },
  ],
  [
    'availability mismatch',
    (m) => {
      rawObject(m.audit).availability = 'partial';
    },
  ],
  [
    'missing selector mismatch',
    (m) => {
      rawObject(m.audit).missingSelectors = ['natural=water'];
    },
  ],
  [
    'duplicate C row',
    (_m, r) => {
      const rows = r.cells as unknown[];
      rows[1] = structuredClone(rows[0]);
    },
  ],
  [
    'unknown C identity',
    (_m, r) => {
      (r.cells as [number, string[]][])[0]![0] = 9999999;
    },
  ],
  [
    'unknown mask reference',
    (_m, r) => {
      (r.cells as [number, string[]][])[0]![1] = ['missing'];
    },
  ],
  [
    'duplicate reference',
    (_m, r) => {
      const refs = (r.cells as [number, string[]][])[0]![1];
      refs.push(refs[0]!);
    },
  ],
  [
    'wrong statistics',
    (_m, r) => {
      rawObject(r.statistics).associations = 0;
    },
  ],
  [
    'open ring',
    (m) => {
      firstMask(m).geometry.coordinates[0]!.pop();
    },
  ],
  [
    'self intersection',
    (m) => {
      firstMask(m).geometry.coordinates = [
        [
          [0, 0],
          [0.0003, 0.0003],
          [0, 0.0002],
          [0.0002, 0],
          [0, 0],
        ],
      ];
    },
  ],
  [
    'hole outside',
    (m) => {
      firstMask(m).geometry.coordinates.push([
        [0, 0],
        [0.001, 0],
        [0, 0.001],
        [0, 0],
      ]);
    },
  ],
  [
    'extra coordinate precision',
    (m) => {
      firstMask(m).geometry.coordinates[0]![0]![0]! += 1e-9;
    },
  ],
  [
    'nonfinite coordinate',
    (m) => {
      firstMask(m).geometry.coordinates[0]![0]![0] = Infinity;
    },
  ],
])('rejects corrupt semantic masks/references: %s', (_name, mutate) => {
  const f = real();
  mutate(f.m, f.r);
  expect(f.decode).toThrow();
});

it.each<[string, (c: Record<string, unknown>) => void]>([
  [
    'registry hash',
    (c) => {
      c.maskRegistrySha256 = '0'.repeat(64);
    },
  ],
  [
    'registry version',
    (c) => {
      c.maskRegistryVersion = 'future';
    },
  ],
  [
    'semantics',
    (c) => {
      c.maskSemantics = 'center-only';
    },
  ],
  [
    'reassigned type',
    (c) => {
      rawObject((c.maskTypes as unknown[])[0]).t = 15;
    },
  ],
  [
    'type name',
    (c) => {
      rawObject((c.maskTypes as unknown[])[0]).name = 'sea';
    },
  ],
  [
    'duplicate type',
    (c) => {
      (c.maskTypes as unknown[])[1] = structuredClone(
        (c.maskTypes as unknown[])[0],
      );
    },
  ],
  [
    'too many types',
    (c) => {
      c.maskTypes = Array.from({ length: 17 }, () =>
        rawObject((c.maskTypes as unknown[])[0]),
      );
    },
  ],
  [
    'missing mask descriptor',
    (c) => {
      delete rawObject(rawObject(c.settlements)['es-torrevieja']).masks;
    },
  ],
  [
    'traversal',
    (c) => {
      rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).masks,
      ).path = '../masks.geojson';
    },
  ],
  [
    'cross-city descriptor',
    (c) => {
      rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).cellMaskRefs,
      ).path = 'es-elche/cell-mask-refs.v0.json';
    },
  ],
  [
    'stale C join',
    (c) => {
      rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).cellMaskRefs,
      ).sourceCProductSha256 = '0'.repeat(64);
    },
  ],
  [
    'stale mask join',
    (c) => {
      rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).cellMaskRefs,
      ).sourceMaskProductSha256 = '0'.repeat(64);
    },
  ],
  [
    'wrong reference count',
    (c) => {
      rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).cellMaskRefs,
      ).count = 1;
    },
  ],
  [
    'source traversal',
    (c) => {
      const sources = rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).masks,
      ).sources as unknown[];
      rawObject(sources[0]).path = 'osm-layers/../bad.geojson';
    },
  ],
  [
    'wrong selector',
    (c) => {
      const sources = rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).masks,
      ).sources as unknown[];
      rawObject(sources[0]).selector = 'landuse=retail';
    },
  ],
  [
    'wrong source city',
    (c) => {
      const sources = rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).masks,
      ).sources as unknown[];
      rawObject(sources[0]).path = 'osm-layers/elche/natural-water.geojson';
    },
  ],
  [
    'duplicate source selector',
    (c) => {
      const sources = rawObject(
        rawObject(rawObject(c.settlements)['es-torrevieja']).masks,
      ).sources as unknown[];
      sources[1] = structuredClone(sources[0]);
    },
  ],
])('rejects corrupt V4 registry/descriptors: %s', (_name, mutate) => {
  const c = rawObject(json('catalog.json'));
  mutate(c);
  expect(() => parseStreetCellCatalog(c)).toThrow();
});

it('retains explicit V3 support and rejects mixing V4 policy into it', () => {
  const c = rawObject(json('catalog.json'));
  c.schemaVersion = 'street-cells-catalog-v3';
  c.version = '0.3.0';
  for (const key of [
    'maskRegistryVersion',
    'maskRegistrySha256',
    'maskSemantics',
    'maskTypes',
  ])
    delete c[key];
  for (const city of Object.values(rawObject(c.settlements))) {
    delete rawObject(city).masks;
    delete rawObject(city).cellMaskRefs;
  }
  expect(parseStreetCellCatalog(c).version).toBe('0.3.0');
  c.maskSemantics = 'center-only';
  expect(() => parseStreetCellCatalog(c)).toThrow();
});

it('distinguishes full polygon conflicts, mask holes, overlapping unions and unchanged source rings', () => {
  const ring = (x0: number, z0: number, x1: number, z1: number) =>
    [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
      [x0, z0],
    ] as const;
  const geo = (r: readonly (readonly [number, number])[]) =>
    r.map(([x, z]) => {
      const p = d3dGeographicPoint(cellCityMap, { x, z });
      return [p.longitude, p.latitude] as const;
    });
  const outer = ring(0, 0, 1, 1),
    hole = ring(0.3, 0.3, 0.7, 0.7);
  const masks: StreetCellMasks = {
    sha256: 'm',
    refsSha256: 'r',
    availability: 'available',
    omittedCapacity: 0,
    missingSelectors: [],
    features: [
      {
        id: 'one',
        geometry: { type: 'Polygon', coordinates: [geo(outer), geo(hole)] },
        properties: {
          t: 2,
          src: 'W1',
          part: 0,
          sources: [0],
          areaSqm: 1,
          tags: {},
        },
      },
    ],
    cellRefs: { cell: ['one'] },
  };
  const snapshot = JSON.stringify(masks);
  const query = prepareStreetCellMaskQueries(masks, cellCityMap);
  expect(prepareStreetCellMaskQueries(masks, cellCityMap)).toBe(query);
  expect(query.conflicts('cell', ring(0.35, 0.35, 0.6, 0.6), 0)).toBe(false);
  expect(query.conflicts('cell', ring(0.1, 0.1, 0.2, 0.2), 0)).toBe(true);
  expect(query.conflicts('cell', ring(0.9, 0.9, 1.1, 1.1), 0)).toBe(true);
  expect(query.conflicts('cell', ring(-1, -1, 2, 2), 0)).toBe(true);
  expect(query.conflicts('unknown', outer, 0)).toBe(false);
  const remainder = estimateStreetCellRemainder(
    [ring(-0.1, -0.1, 1.1, 1.1)],
    query.forCell('cell'),
    144,
  );
  const duplicate = estimateStreetCellRemainder(
    [ring(-0.1, -0.1, 1.1, 1.1)],
    [...query.forCell('cell'), ...query.forCell('cell')],
    144,
  );
  expect(remainder.estimatedMaskedAreaSqm).toBe(
    duplicate.estimatedMaskedAreaSqm,
  );
  expect(remainder.estimatedBuildableAreaSqm).toBeGreaterThan(0);
  expect(
    estimateStreetCellRemainder(
      [ring(0.4, 0.4, 0.6, 0.6)],
      query.forCell('cell'),
      4,
    ).estimatedMaskedAreaSqm,
  ).toBe(0);
  expect(
    estimateStreetCellRemainder([ring(2, 2, 3, 3)], query.forCell('cell'), 100)
      .estimatedBuildableAreaSqm,
  ).toBe(100);
  expect(JSON.stringify(masks)).toBe(snapshot);
});

it.each(['empty', 'road-crossed'] as const)(
  'rejects the whole masked footprint in %s while retaining the same cell remainder and all unassociated slots',
  (classification) => {
    const cells = {
      ...cellCityCells,
      features: cellCityCells.features
        .filter(
          (f) =>
            cellCityCells.annotations.cells[f.id]!.classification ===
            classification,
        )
        .slice(0, 10),
    };
    const before = buildStreetCellCity(
      cellCityMap,
      cellCityPopulation,
      undefined,
      cells,
      cellCityTerrain,
    );
    const b = before.buildings[0]!;
    expect(b).toBeDefined();
    const ring = footprintRing({
      ...b,
      width: b.width + cellCityTerrain.metre,
      depth: b.depth + cellCityTerrain.metre,
    }).map(([x, z]) => {
      const p = d3dGeographicPoint(cellCityMap, { x, z });
      return [
        Number(p.longitude.toFixed(7)),
        Number(p.latitude.toFixed(7)),
      ] as const;
    });
    const masked: StreetCells = {
      ...cells,
      masks: {
        sha256: 'm',
        refsSha256: 'r',
        availability: 'available',
        omittedCapacity: 0,
        missingSelectors: [],
        features: [
          {
            id: 'es-torrevieja-mask-s%3AW1-0',
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: {
              t: 2,
              src: 'W1',
              part: 0,
              areaSqm: 100,
              sources: [0],
              tags: { leisure: 'park' },
            },
          },
        ],
        cellRefs: Object.fromEntries(
          cells.features.map((f) => [
            f.id,
            f.id === b.cellId ? ['es-torrevieja-mask-s%3AW1-0'] : [],
          ]),
        ),
      },
    };
    expect(
      auditStreetCellBuildings(cellCityMap, masked, [b]).maskConflicts,
    ).toBe(1);
    const after = buildStreetCellCity(
      cellCityMap,
      cellCityPopulation,
      undefined,
      masked,
      cellCityTerrain,
    );
    const world = [
      ring.map(([longitude, latitude]) => {
        const p = d3dProjectedPoint(cellCityMap, { longitude, latitude });
        return [p.x, p.z] as const;
      }),
    ];
    expect(
      after.buildings
        .filter((a) => a.cellId === b.cellId)
        .every((a) => !footprintOverlaps(footprintRing(a), world, 0)),
    ).toBe(true);
    expect(after.buildings.some((a) => a.cellId === b.cellId)).toBe(true);
    expect(after.buildings.filter((a) => a.cellId !== b.cellId)).toEqual(
      before.buildings.filter((a) => a.cellId !== b.cellId),
    );
    expect(
      buildStreetCellCity(
        cellCityMap,
        cellCityPopulation,
        undefined,
        masked,
        cellCityTerrain,
      ),
    ).toBe(after);
  },
);

it('caches safe-area estimates by source and area, keeps missing refs unmasked and labels unsampled slivers approximate', () => {
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ] as const;
  const geographic = ring.map(([x, z]) => {
    const p = d3dGeographicPoint(cellCityMap, { x, z });
    return [p.longitude, p.latitude] as const;
  });
  const masks: StreetCellMasks = {
    sha256: 'm',
    refsSha256: 'r',
    availability: 'available',
    omittedCapacity: 0,
    missingSelectors: [],
    features: [],
    cellRefs: {},
  };
  const query = prepareStreetCellMaskQueries(masks, cellCityMap);
  const first = query.remainder('missing', [geographic], 100);
  expect(first.estimate.estimatedBuildableAreaSqm).toBe(100);
  const source = [geographic];
  const same = query.remainder('missing', source, 100);
  expect(query.remainder('missing', source, 100)).toBe(same);
  expect(query.remainder('missing', source, 200)).not.toBe(same);
  expect(query.forCell('missing')).toEqual([]);
  const thin = [
    [
      [0, 0],
      [1, 0],
      [1, 1e-9],
      [1e-9, 1e-9],
      [1e-9, 1],
      [0, 1],
      [0, 0],
    ],
  ] as const;
  const mask = {
    id: 'cover',
    type: 4,
    sourceId: 'W1',
    areaSqm: 1,
    rings: [ring],
    contains: () => true,
  };
  const result = estimateStreetCellRemainder(thin, [mask], 0.000000001);
  expect(result.maskIds).toEqual(['cover']);
  expect(result.estimatedMaskedAreaSqm).toBe(0);
  expect(result.estimatedBuildableAreaSqm).toBe(0.000000001);
});
import { preparePolygonQuery } from '../settlement/settlement-metadata-spatial.js';
it('matches point-query quadrature on concavities, holes, row boundaries and crossing hits', () => {
  const safe = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ] as const;
  for (const rings of [
    [
      [
        [1 / 64, 1 / 64],
        [0.8, 1 / 64],
        [0.8, 0.8],
        [1 / 64, 0.8],
        [1 / 64, 1 / 64],
      ],
      [
        [0.2, 0.2],
        [0.4, 0.2],
        [0.4, 0.4],
        [0.2, 0.4],
        [0.2, 0.2],
      ],
    ],
    [
      [
        [1 / 64, 0],
        [1, 0],
        [1, 1],
        [1 / 64, 1],
        [1 / 64, 0],
      ],
    ],
    [
      [
        [0, 0],
        [0.8, 0],
        [0.8, 0.3],
        [0.3, 0.3],
        [0.3, 0.8],
        [0, 0.8],
        [0, 0],
      ],
    ],
  ] as const) {
    const contains = preparePolygonQuery({
      type: 'Polygon',
      coordinates: rings,
    });
    let count = 0;
    for (let row = 0; row < 32; row++)
      for (let col = 0; col < 32; col++)
        if (contains([(col + 0.5) / 32, (row + 0.5) / 32])) count++;
    const result = estimateStreetCellRemainder(
      safe,
      [{ id: 'mask', type: 2, sourceId: 'W1', areaSqm: 1, rings, contains }],
      100,
    );
    expect(result.estimatedMaskedAreaSqm).toBe((count / 1024) * 100);
  }
});
it('retains all slots when a referenced perimeter mask misses the inset safe zone', () => {
  const cell = cellCityCells.features.find(
    (f) =>
      cellCityCells.annotations.cells[f.id]!.classification === 'empty' &&
      cellCityCells.annotations.cells[f.id]!.safeZoneCoordinates,
  )!;
  const cells = { ...cellCityCells, features: [cell] };
  const before = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    undefined,
    cells,
    cellCityTerrain,
  );
  const [x, z] = cell.geometry.coordinates[0]![0]!;
  const ring = [
    [x - 1e-7, z - 1e-7],
    [x + 1e-7, z - 1e-7],
    [x + 1e-7, z + 1e-7],
    [x - 1e-7, z + 1e-7],
    [x - 1e-7, z - 1e-7],
  ] as const;
  const masks: StreetCellMasks = {
    sha256: 'perimeter',
    refsSha256: 'ref',
    availability: 'available',
    omittedCapacity: 0,
    missingSelectors: [],
    features: [
      {
        id: 'perimeter',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          t: 4,
          src: 'W1',
          part: 0,
          sources: [0],
          areaSqm: 0.001,
          tags: {},
        },
      },
    ],
    cellRefs: { [cell.id]: ['perimeter'] },
  };
  const after = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    undefined,
    { ...cells, masks },
    cellCityTerrain,
  );
  expect(after.buildings).toEqual(before.buildings);
  expect(after.streetCellLayout!.ledger[0]!.maskIds).toEqual(['perimeter']);
  expect(after.streetCellLayout!.ledger[0]!.estimatedMaskedAreaSqm).toBe(0);
  const [sx, sz] =
    cellCityCells.annotations.cells[cell.id]!.safeZoneCoordinates![0]![0]!;
  const border = {
    ...masks,
    features: [
      {
        ...masks.features[0]!,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            ring.map(([px, pz]) => [px + sx - x, pz + sz - z] as const),
          ],
        },
      },
    ],
  };
  const onlyBorder = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    undefined,
    { ...cells, masks: border },
    cellCityTerrain,
  );
  expect(onlyBorder.buildings).toEqual(before.buildings);
  expect(onlyBorder.streetCellLayout!.maskRejections).toBe(0);
});

it('allows the composer to retain complete buildings inside a genuine exclusion hole', () => {
  const cell = cellCityCells.features.find(
    (f) =>
      cellCityCells.annotations.cells[f.id]!.classification === 'empty' &&
      cellCityCells.annotations.cells[f.id]!.safeZoneCoordinates,
  )!;
  const safe = cellCityCells.annotations.cells[cell.id]!.safeZoneCoordinates!;
  const cells = { ...cellCityCells, features: [cell] };
  const before = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    undefined,
    cells,
    cellCityTerrain,
  );
  expect(before.buildings.length).toBeGreaterThan(0);
  const masks: StreetCellMasks = {
    sha256: 'courtyard-hole',
    refsSha256: 'hole-ref',
    availability: 'available',
    omittedCapacity: 0,
    missingSelectors: [],
    features: [
      {
        id: 'donut',
        geometry: {
          type: 'Polygon',
          coordinates: [cell.geometry.coordinates[0]!, safe[0]!],
        },
        properties: {
          t: 2,
          src: 'W1',
          part: 0,
          sources: [0],
          areaSqm: 1,
          tags: {},
        },
      },
    ],
    cellRefs: { [cell.id]: ['donut'] },
  };
  const after = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    undefined,
    { ...cells, masks },
    cellCityTerrain,
  );
  expect(after.buildings).toEqual(before.buildings);
  const queries = prepareStreetCellMaskQueries(masks, cellCityMap);
  expect(
    after.buildings.every(
      (b) => !queries.conflicts(cell.id, footprintRing(b), 0),
    ),
  ).toBe(true);
  expect(after.streetCellLayout!.maskRejections).toBe(0);
});
