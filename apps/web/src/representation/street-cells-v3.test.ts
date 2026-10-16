import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { indexZip, verifyZipEntry } from '../assets/zip-layer.js';
import { streetCellRoot } from '../test/street-cells-fixture.js';
import {
  parseStreetCellCatalog,
  decodeStreetCells,
  decodeStreetCellAnnotations,
} from './street-cells.js';
const zip = readFileSync(streetCellRoot + 'street-cells.zip');
const entries = indexZip(zip);
const read = (path: string) => {
  const e = entries.get(path)!;
  return Buffer.from(verifyZipEntry(e, inflateRawSync(e.compressed)));
};
// Keep acquisition/CRC/hash/decode work outside timed assertion bodies; retain its results.
const installedCatalog = parseStreetCellCatalog(
  JSON.parse(read('catalog.json').toString('utf8')),
);
const installedCities = Object.entries(installedCatalog.settlements).map(
  ([id, entry]) => {
    const descriptors = [
      ...entry.products,
      entry.annotations,
      entry.hierarchy,
      entry.audit,
    ].map((d) => {
      const bytes = read(d.path);
      return {
        descriptor: d,
        bytes: bytes.length,
        hash: createHash('sha256').update(bytes).digest('hex'),
      };
    });
    const product = entry.products[2]!;
    const model = decodeStreetCells(
      JSON.parse(read(product.path).toString('utf8')),
      id,
      product,
    );
    const annotations = decodeStreetCellAnnotations(
      JSON.parse(read(entry.annotations.path).toString('utf8')),
      model,
      entry.source.products[2]!.sha256,
    );
    return { id, entry, descriptors, model, annotations };
  },
);
it('validates the V4 archive preserves V3 annotations across three cities and preserves null estimates and partial observed evidence', () => {
  expect(zip.length).toBe(6031239);
  expect(createHash('sha256').update(zip).digest('hex')).toBe(
    'e25c3f6bc0c4e134dc3f0d2683b86a7492df8ebbe7c01cd9e5e7bbf9ac5b8164',
  );
  expect(Object.keys(installedCatalog.settlements).sort()).toEqual([
    'es-alicante',
    'es-elche',
    'es-torrevieja',
  ]);
  for (const { entry, descriptors, annotations } of installedCities) {
    for (const { descriptor, bytes, hash } of descriptors) {
      expect(bytes).toBe(descriptor.byteLength);
      expect(hash).toBe(descriptor.sha256);
    }
    const product = entry.products[2]!;
    expect(Object.keys(annotations.cells)).toHaveLength(product.featureCount);
    expect(annotations.evidence.availability).toBe('partial');
    for (const c of Object.values(annotations.cells)) {
      expect(c.buildingEvidence.estimatedBuildingCount).toBeNull();
      expect(c.buildingEvidence.desiredFootprintCoverage).toBeNull();
      expect(Object.isFrozen(c.buildingEvidence)).toBe(true);
    }
  }
});

const rawAnnotations = () =>
  JSON.parse(
    read('es-torrevieja/annotations-c.v3.json').toString('utf8'),
  ) as Record<string, unknown> & {
    cells: unknown[][];
    evidence: {
      availability: string;
      source: unknown;
      policy: string;
      estimate: string;
      sourceCounts: Record<string, unknown>;
      diagnostics: unknown[];
    };
    keys: Record<string, string[]>;
  };
const torreviejaFixture = installedCities.find(
  (c) => c.id === 'es-torrevieja',
)!;
function fixture() {
  return {
    model: torreviejaFixture.model,
    hash: torreviejaFixture.entry.source.products[2]!.sha256,
  };
}

it.each<(a: ReturnType<typeof rawAnnotations>) => void>([
  (a) => {
    a.keys.cell![0] = 'cellId';
  },
  (a) => {
    a.keys.building!.reverse();
  },
  (a) => {
    a.cells[0]![0] = '1';
  },
  (a) => {
    a.cells[0]![0] = 1.5;
  },
  (a) => {
    a.cells[0]![2] = [-0.64888031, 38.0032814];
  },
  (a) => {
    a.geometryPolicy = 'old';
  },
  (a) => {
    a.serializationToleranceM = 0.1;
  },
  (a) => {
    a.evidence.availability = 'unknown';
  },
  (a) => {
    a.evidence.source = null;
  },
  (a) => {
    a.evidence.policy = 'invented';
  },
  (a) => {
    a.evidence.estimate = 'target';
  },
  (a) => {
    a.evidence.sourceCounts.features = -1;
  },
  (a) => {
    a.evidence.sourceCounts.features = 0.1;
  },
  (a) => {
    a.evidence.diagnostics = [{ feature: -1, id: 'x', reason: 'bad' }];
  },
  (a) => {
    a.cells[0]![8] = [1, 1];
  },
  (a) => {
    a.cells[0]![8] = [1, 0, 1, 1, 1, 1, 1, null, null];
  },
  (a) => {
    a.cells[0]![8] = [1, 1, 2, 1, 1, 1, 1, null, null];
  },
  (a) => {
    a.cells[0]![8] = [1, 1, 1, 2, 1, 1, 1, null, null];
  },
  (a) => {
    a.cells[0]![8] = [1, 1, 1, 1, 0, 1, 1, null, null];
  },
  (a) => {
    a.cells[0]![8] = [1, 1, 1, 1, 1, 1, 2, null, null];
  },
  (a) => {
    a.cells[0]![8] = [1, 1, 1, 1, 1, -1, 0, null, null];
  },
  (a) => {
    a.cells[0]![8] = [1, 1, 1, 1, 1, 1, 0, null, null];
  },
  (a) => {
    a.cells[0]![8] = [null, null, null, null, null, null, null, null, null];
  },
  (a) => {
    a.cells[0]![8] = [1, 1, 1, 1, 1, 1, 1, 0, null];
  },
  (a) => {
    a.cells[0]![8] = [1, 1, 1, 1, 1, 1, 1, null, 0];
  },
])(
  'rejects corrupt V3 tuple header, numeric identity, precision and observation semantics %#',
  (mutate) => {
    const a = rawAnnotations();
    mutate(a);
    const f = fixture();
    expect(() => decodeStreetCellAnnotations(a, f.model, f.hash)).toThrow(
      'Invalid StreetCell',
    );
  },
);
it('distinguishes unavailable evidence from observed zero and preserves partial lower bounds', () => {
  const a = rawAnnotations(),
    f = fixture();
  a.evidence.availability = 'unavailable';
  a.evidence.source = null;
  a.evidence.diagnostics = [];
  for (const k of Object.keys(a.evidence.sourceCounts))
    a.evidence.sourceCounts[k] = 0;
  for (const c of a.cells) c[8] = Array(9).fill(null);
  const unavailable = decodeStreetCellAnnotations(a, f.model, f.hash);
  expect(unavailable.evidence.availability).toBe('unavailable');
  expect(
    unavailable.cells['es-torrevieja-sc-1']!.buildingEvidence.ownedFeatureCount,
  ).toBeNull();
  a.evidence.sourceCounts.features = 1;
  expect(() => decodeStreetCellAnnotations(a, f.model, f.hash)).toThrow(
    'unavailable evidence counters',
  );
  const available = rawAnnotations();
  available.evidence.availability = 'available';
  const zero = available.cells.find((c) => (c[8] as unknown[])[0] === 0)!;
  const decoded = decodeStreetCellAnnotations(available, f.model, f.hash);
  expect(
    decoded.cells[`es-torrevieja-sc-${zero[0]}`]!.buildingEvidence
      .ownedFeatureCount,
  ).toBe(0);
  expect(decoded.evidence.availability).toBe('available');
});

it.each([
  {
    ring: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  },
  {
    ring: [
      [0, 0],
      [1, 1],
      [2, 2],
      [0, 0],
    ],
  },
])(
  'rejects collapsed encoded safe rings despite a positive declared measure',
  ({ ring }) => {
    const a = rawAnnotations(),
      f = fixture();
    a.cells[0]![3] = [ring];
    expect(() => decodeStreetCellAnnotations(a, f.model, f.hash)).toThrow(
      'polygon area',
    );
  },
);
