import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import {
  cellCityMap,
  cellCityPopulation,
  cellCityTerrain,
  cellCityMetadata,
  alicanteCellCityFixture,
  elcheCellCityFixture,
} from '../test/street-cell-city-fixture.js';
import { createStreetCellLoader } from './street-cells-loader.js';
import {
  buildStreetCellCity,
  streetCellLandmarkProtections,
} from './d3d-street-cell-city.js';
import { prepareStreetCellMaskQueries } from './d3d-street-cell-masks.js';
import { footprintRing, footprintOverlaps } from './d3d-footprint.js';
const loader = createStreetCellLoader({
  baseUrl: '/',
  digestSha256: async (text) => createHash('sha256').update(text).digest('hex'),
  fetchText: async (url) => ({
    ok: true,
    text: async () =>
      readFileSync(join(import.meta.dirname, '../../public', url), 'utf8'),
  }),
});
const cases = await Promise.all(
  [
    {
      id: 'es-torrevieja',
      model: cellCityMap,
      population: cellCityPopulation,
      terrain: cellCityTerrain,
      view: cellCityMetadata,
      expected: 16231,
    },
    {
      id: 'es-alicante',
      ...alicanteCellCityFixture(),
      view: undefined,
      expected: 13804,
    },
    {
      id: 'es-elche',
      ...elcheCellCityFixture(),
      view: undefined,
      expected: 6510,
    },
  ].map(async (f) => {
    const cells = (await loader.resolve(f.id))!;
    const protections = f.view
      ? streetCellLandmarkProtections(f.model, f.view)
      : undefined;
    const before = buildStreetCellCity(
      f.model,
      f.population,
      undefined,
      { ...cells, masks: undefined },
      f.terrain,
      protections,
    );
    const after = buildStreetCellCity(
      f.model,
      f.population,
      undefined,
      cells,
      f.terrain,
      protections,
    );
    const styled = buildStreetCellCity(
      f.model,
      f.population,
      f.view,
      cells,
      f.terrain,
      protections,
    );
    const query = prepareStreetCellMaskQueries(cells.masks!, f.model);
    const conflicts = after.buildings
      .filter((b) =>
        query.features.some((m) =>
          footprintOverlaps(footprintRing(b), m.rings, 0),
        ),
      )
      .map((b) => b.id);
    return { ...f, cells, before, after, styled, conflicts, protections };
  }),
);
it.each(cases)(
  'keeps full-footprint masks hard and unrelated slots exact for $id',
  (f) => {
    expect(f.after.buildings).toHaveLength(f.expected);
    expect(f.conflicts).toEqual([]);
    const unassociated = (list: typeof f.after.buildings) =>
      list.filter((b) => !f.cells.masks!.cellRefs[b.cellId!]!.length);
    expect(unassociated(f.after.buildings)).toEqual(
      unassociated(f.before.buildings),
    );
    const slot = (b: (typeof f.after.buildings)[number]) => [
      b.id,
      b.cellId,
      b.x,
      b.z,
      b.width,
      b.depth,
      b.rotation,
    ];
    expect(f.after.buildings.map(slot)).toEqual(f.styled.buildings.map(slot));
    expect(
      buildStreetCellCity(
        f.model,
        f.population,
        undefined,
        f.cells,
        f.terrain,
        f.protections,
      ),
    ).toBe(f.after);
    const layout = f.after.streetCellLayout!;
    expect(layout.candidates).toBeLessThanOrEqual(65536);
    expect(layout.outsideSafeZone).toBe(0);
    expect(layout.ineligible).toBe(0);
    expect(
      layout.ledger.every(
        (r) => r.maskIds !== undefined && r.totalSafeArea !== undefined,
      ),
    ).toBe(true);
    expect(
      layout.ledger.some((r) => r.maskIds!.length > 0 && r.buildings > 0),
    ).toBe(f.id !== 'es-alicante');
    if (f.id === 'es-alicante')
      expect(f.after.buildings).toEqual(f.before.buildings);
  },
);
