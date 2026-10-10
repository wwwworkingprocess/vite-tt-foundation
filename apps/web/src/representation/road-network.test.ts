import { join } from 'node:path';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  parseRoadCatalog,
  decodeRoadProduct,
  roadNetworkLevel,
} from './road-network.js';
const root = join(import.meta.dirname, '../../public/road-network') + '/';
export const catalogInput = () =>
  JSON.parse(readFileSync(root + 'catalog.json', 'utf8'));
const productInput = (path: string) =>
  JSON.parse(readFileSync(root + path, 'utf8'));
it('keeps exact cumulative OSM identities, coordinates and metadata for the accepted package', () => {
  const catalog = parseRoadCatalog(catalogInput());
  let previous = new Map<string, string>();
  for (const [index, descriptor] of catalog.products.entries()) {
    const bytes = readFileSync(root + descriptor.path);
    expect(bytes.length).toBe(descriptor.byteLength);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      descriptor.sha256,
    );
    const input = productInput(descriptor.path);
    const model = decodeRoadProduct(input, catalog, descriptor);
    expect(model.features).toEqual(input.features);
    expect(model.features.length).toBe([124, 664, 4364][index]);
    expect(
      model.features.filter((f) => f.properties.bridge === 'yes').length,
    ).toBe([8, 14, 21][index]);
    expect(
      model.features.filter((f) => f.properties.tunnel !== undefined).length,
    ).toBe([0, 0, 32][index]);
    expect(Object.isFrozen(model.features[0]!.geometry.coordinates[0])).toBe(
      true,
    );
    const current = new Map(
      model.features.map((f) => [f.id, JSON.stringify(f)]),
    );
    for (const [id, feature] of previous) expect(current.get(id)).toBe(feature);
    previous = current;
  }
});
it('uses existing camera bands and mini policy, without stacking cumulative products', () => {
  expect(
    ['far', 'medium', 'near', 'medium', 'far'].map((lod) =>
      roadNetworkLevel('normal', lod as 'far' | 'medium' | 'near'),
    ),
  ).toEqual(['A', 'B', 'C', 'B', 'A']);
  expect(roadNetworkLevel('mini', 'near')).toBe('A');
});
it('rejects unsupported catalog semantics, settlement/path identities and policy/count declarations', () => {
  const mutations = [
    (c: ReturnType<typeof catalogInput>) => {
      c.schemaVersion = 'future';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.version = '1';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.crs = 'EPSG:3035';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.geometry = 'Polygon';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.coordinateSemantics = 'rounded';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.identityPolicy = 'generated';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.products.pop();
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.products[1].level = 'A';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.products[0].path = '../a';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.products[0].path = 'es-elche/roads-a.v0.geojson';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.products[0].name = 'Other';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.products[0].sha256 = 'bad';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.products[0].byteLength = 0;
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.policy.version = 'future';
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.policy.classes.A.push('service');
    },
    (c: ReturnType<typeof catalogInput>) => {
      delete c.products[0].classCounts.trunk;
    },
    (c: ReturnType<typeof catalogInput>) => {
      c.products[0].classCounts.bad = 0;
    },
  ];
  for (const mutate of mutations) {
    const c = catalogInput();
    mutate(c);
    expect(() => parseRoadCatalog(c)).toThrow();
  }
});
it('rejects malformed linework, unsupported tags/classes, duplicate identities and count corruption', () => {
  const catalog = parseRoadCatalog(catalogInput()),
    descriptor = catalog.products[0]!;
  for (const mutate of [
    (d: ReturnType<typeof productInput>) => {
      d.type = 'Other';
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].geometry.type = 'Point';
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].geometry.coordinates = [[0, 0]];
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].geometry.coordinates[0] = [181, 0];
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].geometry.coordinates[0] = [0, -91];
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].geometry.coordinates[0] = [NaN, 0];
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[1].id = d.features[0].id;
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].properties.highway = 'service';
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].properties.bridge = {};
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].properties.otherTag = () => 'invalid JSON';
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].properties.otherTag = NaN;
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].properties.layer = 'oops';
    },
    (d: ReturnType<typeof productInput>) => {
      d.features.pop();
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].properties.bridge = 'yes';
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].properties.tunnel = 'yes';
    },
    (d: ReturnType<typeof productInput>) => {
      d.features[0].properties.highway = 'primary';
    },
  ]) {
    const d = productInput(descriptor.path);
    mutate(d);
    expect(() => decodeRoadProduct(d, catalog, descriptor)).toThrow();
  }
});

it('preserves nested JSON tags and deeply freezes even a shallow-frozen source feature', () => {
  const catalog = parseRoadCatalog(catalogInput()),
    product = catalog.products[0]!,
    input = productInput(product.path);
  input.features[0].properties.otherTag = [
    true,
    null,
    1,
    { nested: ['original'] },
  ];
  Object.freeze(input.features[0]);
  const model = decodeRoadProduct(input, catalog, product);
  expect(model.features[0]!.properties.otherTag).toEqual([
    true,
    null,
    1,
    { nested: ['original'] },
  ]);
  expect(Object.isFrozen(model.features[0]!.geometry.coordinates[0])).toBe(
    true,
  );
});
it('rejects non-JSON objects, metadata cycles and excessive nesting safely', () => {
  const catalog = parseRoadCatalog(catalogInput()),
    product = catalog.products[0]!;
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let deep: unknown = 'end';
  for (let i = 0; i < 130; i++) deep = { child: deep };
  for (const tag of [new Date(0), cycle, deep]) {
    const input = productInput(product.path);
    input.features[0].properties.otherTag = tag;
    expect(() => decodeRoadProduct(input, catalog, product)).toThrow();
  }
});
