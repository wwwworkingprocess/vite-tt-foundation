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
    count: 12941,
    hash: '6ea3fc7e9ee88362ee62b9541ca899721e923ac9a7113560bb2365793f6a6a54',
  },
  {
    id: 'es-alicante',
    ...alicanteCellCityFixture(),
    view: undefined,
    count: 10444,
    hash: '034e25a426a54b3fcd6c505d94af0a0d0669e8666457b9e2261554bf602db063',
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
it('visual-only keeps the entire ordered building list, including assignments and grounding, exactly equal to the accepted baseline for both cities', async () => {
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
      ).toHaveLength(4);
      expect(
        overlap.find((s) => s.siteId.endsWith('parque-naciones'))?.buildingIds,
      ).toHaveLength(24);
      expect(prepareCityMaterialization(data!, f.model, f.terrain, lod)).toBe(
        plan,
      );
    }
    expect(digest(JSON.stringify(f.city.buildings))).toBe(before);
  }
  expect(await loader.resolve('es-elche', 'near')).toBeUndefined();
});
