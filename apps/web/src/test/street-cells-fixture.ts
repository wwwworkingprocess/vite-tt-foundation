import type { StreetCells } from '../representation/street-cells.js';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { join } from 'node:path';
export const streetCellRoot =
  join(import.meta.dirname, '../../public/street-cells') + '/';
export const streetCellJson = (name: string): unknown =>
  JSON.parse(readFileSync(streetCellRoot + name, 'utf8'));
export function streetCellFixture() {
  const feature = (id: string, rings: number[][][]) => ({
    type: 'Feature',
    id,
    properties: {
      settlementId: 'es-torrevieja',
      level: 'C',
      areaSqm: 100,
      perimeterM: 40,
      sourceRoadIds: ['W1'],
    },
    geometry: { type: 'Polygon', coordinates: rings },
  });
  return {
    type: 'FeatureCollection',
    features: [
      feature('es-torrevieja-sc-1', [
        [
          [-0.7, 37.98],
          [-0.699, 37.98],
          [-0.699, 37.981],
          [-0.7, 37.981],
          [-0.7, 37.98],
        ],
      ]),
      feature('es-torrevieja-sc-2', [
        [
          [-0.699, 37.98],
          [-0.698, 37.98],
          [-0.698, 37.981],
          [-0.699, 37.981],
          [-0.699, 37.98],
        ],
        [
          [-0.6988, 37.9802],
          [-0.6986, 37.9802],
          [-0.6986, 37.9804],
          [-0.6988, 37.9802],
        ],
      ]),
    ],
  };
}

/** Synthetic named annotations preserve fixture polygons by default; individual
 * tests replace safe zones/classifications explicitly to exercise the join. */
export function withStreetCellZones(model: StreetCells): StreetCells {
  return Object.freeze({
    ...model,
    annotations: Object.freeze({
      roadProductSha256: 'a'.repeat(64),
      roadMetadata: Object.freeze({}),
      cells: Object.freeze(
        Object.fromEntries(
          model.features.map((f) => [
            f.id,
            Object.freeze({
              cellId: f.id,
              classification: 'empty' as const,
              representativePoint: f.geometry.coordinates[0]![0]!,
              safeZoneCoordinates: f.geometry.coordinates,
              safeAreaSqm: f.properties.areaSqm,
              reasons: Object.freeze([]),
              margins: Object.freeze([]),
              roads: Object.freeze([]),
            }),
          ]),
        ),
      ),
    }),
  });
}
