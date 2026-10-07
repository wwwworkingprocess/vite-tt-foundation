import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from './terrain-catalog.js';
import { terrainJsonDecoder } from './terrain-json-decoder.js';
it('loads the owner dataset unchanged, preserves every native sample, resolves all five scenarios and validates coastal versus coverage boundaries', () => {
  const root = join(import.meta.dirname, '..', '..', 'public', 'terrain');
  const read = (path: string) =>
    JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
  const catalog = parseTerrainCatalog(read('catalog.json'));
  const resolved = resolveTerrainViewport(
    catalog,
    'es-torrevieja',
    'torrevieja-legacy-abc-v1',
  )!;
  const p = resolved.entry.products;
  for (const product of Object.values(p)) {
    const bytes = readFileSync(join(root, product.path));
    expect(bytes.length).toBe(product.byteLength);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      product.sha256,
    );
  }
  const height = read(p.height.path) as {
    viewports: { elevations: (number | null)[] }[];
  };
  const start = performance.now();
  const terrain = terrainJsonDecoder.decode(
    {
      height,
      surfaceMask: read(p.surfaceMask.path),
      coastline: read(p.coastline.path),
    },
    resolved,
  );
  const decodeMs = performance.now() - start;
  expect(terrain.statistics).toMatchObject({
    nativeSamples: 161680,
    landSamples: 115166,
    waterSamples: 46514,
    minElevation: -6.685429096221924,
    maxElevation: 70.38201141357422,
  });
  let negative = 0,
    mismatches = 0;
  for (let r = 0; r < 430; r++)
    for (let c = 0; c < 376; c++) {
      const value = height.viewports[0]!.elevations[r * 376 + c]!;
      if (!Object.is(terrain.sample(r, c), value)) mismatches++;
      if (value !== null && value < 0) negative++;
    }
  expect(negative).toBe(7232);
  expect(mismatches).toBe(0);
  const scenarios = JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        'public',
        'scenarios',
        'catalog.json',
      ),
      'utf8',
    ),
  ) as { scenarios: { scenarioId: string; manifestPath: string }[] };
  for (const id of resolved.entry.scenarioIds) {
    expect(resolveTerrainViewport(catalog, 'es-torrevieja', id)!.viewport).toBe(
      resolved.viewport,
    );
    const descriptor = scenarios.scenarios.find((s) => s.scenarioId === id)!;
    const manifest = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          'public',
          'scenarios',
          descriptor.manifestPath,
        ),
        'utf8',
      ),
    ) as { primarySettlementId: string };
    expect(manifest.primarySettlementId).toBe('es-torrevieja');
  }
  const boundaryKey = (a: readonly number[], b: readonly number[]) =>
    [a.join(','), b.join(',')].sort().join('|');
  const expected = {
    coastline: new Set<string>(),
    'coverage-edge': new Set<string>(),
  };
  const bounds = terrain.viewport.rasterBounds3035;
  const edges = [
    [0, -1, 0, 0, 1, 0],
    [1, 0, 1, 0, 1, 1],
    [0, 1, 1, 1, 0, 1],
    [-1, 0, 0, 1, 0, 0],
  ];
  for (let r = 0; r < 430; r++)
    for (let c = 0; c < 376; c++) {
      if (terrain.classify(r, c) !== 'land') continue;
      for (const [dc, dr, x1, y1, x2, y2] of edges) {
        const cc = c + dc!,
          rr = r + dr!,
          outside = cc < 0 || cc >= 376 || rr < 0 || rr >= 430;
        if (outside || terrain.classify(rr, cc) === 'water') {
          const a = [
              bounds.west + (c + x1!) * 25,
              bounds.north - (r + y1!) * 25,
            ],
            b = [bounds.west + (c + x2!) * 25, bounds.north - (r + y2!) * 25];
          expected[outside ? 'coverage-edge' : 'coastline'].add(
            boundaryKey(a, b),
          );
        }
      }
    }
  for (const kind of ['coastline', 'coverage-edge'] as const) {
    const actual = new Set<string>();
    for (const f of terrain.coastline.features.filter(
      (f) => f.properties.kind === kind,
    ))
      for (const line of f.geometry.coordinates)
        for (let i = 1; i < line.length; i++)
          actual.add(boundaryKey(line[i - 1]!, line[i]!));
    expect(actual).toEqual(expected[kind]);
  }
  console.info('Native terrain decode milliseconds', decodeMs);
});
