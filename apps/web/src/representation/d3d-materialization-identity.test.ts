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
    hash: '657a27f596be7ef5c59618f58975e4c9fa7aba5493543181635a602231731492',
  },
  {
    id: 'es-alicante',
    ...alicanteCellCityFixture(),
    view: undefined,
    count: 13804,
    hash: '4d08aa01e62fb41d71d847b612d6e8515317f4483c857602ca6d87b662759502',
  },
].map((f) => ({
  ...f,
  city: groundCity(
    buildStreetCellCity(
      f.model,
      f.population,
      f.view,
      f.cells,
      f.terrain,
      f.view ? streetCellLandmarkProtections(f.model, f.view) : undefined,
    ),
    f.terrain,
  ),
}));
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
    expect(before).toBe(f.hash);
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
