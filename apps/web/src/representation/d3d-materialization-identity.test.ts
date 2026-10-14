import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { join } from 'node:path';
import {
  cellCityMap,
  cellCityPopulation,
  cellCityMetadata,
  cellCityCells,
  cellCityTerrain,
  alicanteCellCityFixture,
} from '../test/street-cell-city-fixture.js';
import {
  buildStreetCellCity,
  streetCellLandmarkProtections,
} from './d3d-street-cell-city.js';
import { groundCity } from './d3d-terrain-model.js';
import { createCityMaterializationLoader } from './city-materialization-loader.js';
import {
  prepareCityMaterialization,
  diagnoseMaterializationOverlaps,
} from './d3d-materialization.js';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
// Test serialization only: Math.pow is implementation-approximated. Preserve
// the renderer's hard density threshold even when decimal noise is normalized.
const baselineDigest = (records: unknown) =>
  digest(
    JSON.stringify(records, (key, value) =>
      key === 'density' && typeof value === 'number'
        ? [Number(value.toPrecision(15)), value >= 0.45]
        : value,
    ),
  );
// Immutable real-city fixtures are composed once, as in the accepted Pass-2 suites.
const fixtures = [
  {
    id: 'es-torrevieja',
    model: cellCityMap,
    population: cellCityPopulation,
    view: cellCityMetadata,
    cells: cellCityCells,
    terrain: cellCityTerrain,
    count: 17562,
    hash: '67a2ddb55e7ed0a9ce133f6abec38177653270b71602a7a2698868b4726609d2',
  },
  {
    id: 'es-alicante',
    ...alicanteCellCityFixture(),
    view: undefined,
    count: 13804,
    hash: 'b5a8f08ce0056c5a37fbc56bf1508a35b9d9157b94eba298e7ed5521d66b3a5f',
  },
].map((f) => {
  const composed = buildStreetCellCity(
    f.model,
    f.population,
    f.view,
    f.cells,
    f.terrain,
    f.view ? streetCellLandmarkProtections(f.model, f.view) : undefined,
  );
  return { ...f, composed, city: groundCity(composed, f.terrain) };
});
it('visual-only keeps the entire ordered building list, including assignments and grounding, exactly equal before/after visual-only POI planning for both cities', async () => {
  const loader = createCityMaterializationLoader({
    baseUrl: '/',
    digestSha256: async (s) => digest(s),
    fetchText: async (url) => ({
      ok: true,
      text: async () =>
        readFileSync(join(import.meta.dirname, '../../public') + url, 'utf8'),
    }),
  });
  for (const f of fixtures) {
    expect(f.city.buildings).toHaveLength(f.count);
    const before = digest(JSON.stringify(f.city.buildings));
    // Math.pow intensity can differ by one ULP between native math libraries.
    // Only the baseline density scalar is normalized; all other fields and the
    // exact unnormalized pre/post record bytes remain protected.
    expect(baselineDigest(f.city.buildings)).toBe(f.hash);
    expect(f.city.buildings).toEqual(
      f.composed.buildings.map((b) => ({
        ...b,
        baseY: f.terrain.ground(b.x, b.z).y,
      })),
    );
    for (const lod of ['far', 'medium', 'near'] as const) {
      const data = await loader.resolve(f.id, lod);
      if (f.id === 'es-alicante') {
        expect(data).toBeUndefined();
        continue;
      }
      const plan = prepareCityMaterialization(data!, f.model, f.terrain, lod);
      expect(plan.triangles).toBeLessThan(131072);
      const overlap = diagnoseMaterializationOverlaps(data!, f.model, f.city);
      expect(
        overlap.find((s) => s.siteId.endsWith('casino-cultural'))?.buildingIds,
      ).toHaveLength(6);
      expect(
        overlap.find((s) => s.siteId.endsWith('parque-naciones'))?.buildingIds,
      ).toHaveLength(27);
      expect(prepareCityMaterialization(data!, f.model, f.terrain, lod)).toBe(
        plan,
      );
    }
    expect(digest(JSON.stringify(f.city.buildings))).toBe(before);
  }
  expect(await loader.resolve('es-elche', 'near')).toBeUndefined();
});

it('portable density pins preserve meaningful changes, exact geometry and the facade threshold', () => {
  const record = {
    id: 'building',
    x: 1,
    baseY: 2,
    density: 0.8241612234051542,
  };
  const linux = { ...record, density: 0.8241612234051541 };
  expect(baselineDigest(linux)).toBe(baselineDigest(record));
  // The purity check deliberately retains the original full precision.
  expect(digest(JSON.stringify(linux))).not.toBe(
    digest(JSON.stringify(record)),
  );
  for (const changed of [
    { ...record, density: record.density + 1e-7 },
    { ...record, x: record.x + 1e-13 },
    { ...record, baseY: record.baseY + 1e-13 },
    { ...record, id: 'other' },
  ])
    expect(baselineDigest(changed)).not.toBe(baselineDigest(record));
  expect(baselineDigest({ ...record, density: 0.44999999999999996 })).not.toBe(
    baselineDigest({ ...record, density: 0.45 }),
  );
});
