import type { ScenarioPopulationView } from '../population/population-field-loader.js';
import {
  freezeSettlement,
  type SettlementMetadata,
} from './settlement-metadata.js';
import {
  diagnoseLandmarkAssociations,
  geographicDistanceMetres,
  landmarkReservationMetres,
  lookupSettlementContext,
} from './settlement-metadata-spatial.js';

export type SettlementPopulationInput = Pick<
  ScenarioPopulationView,
  'grid' | 'crop' | 'canonicalCells'
>;
export function enrichSettlementPopulation(
  population: SettlementPopulationInput,
  metadata: SettlementMetadata,
) {
  const cells = population.canonicalCells.map((cell) => {
    const point = [cell.center.longitude, cell.center.latitude] as const;
    return Object.freeze({
      cell,
      ...lookupSettlementContext(metadata, point),
      nearbyLandmarkIds: Object.freeze(
        metadata.landmarks
          .filter(
            (landmark) =>
              geographicDistanceMetres(point, landmark.coordinate) <=
              landmarkReservationMetres(metadata, landmark),
          )
          .map((landmark) => landmark.id)
          .sort(),
      ),
    });
  });
  return Object.freeze({
    population,
    metadata,
    cells: Object.freeze(cells),
    diagnostics: freezeSettlement({
      totalCells:
        (population.crop.rowEnd - population.crop.rowStart) *
        (population.crop.columnEnd - population.crop.columnStart),
      nonzeroCells: cells.length,
      cellsWithZone: cells.filter((cell) => cell.zoneId !== undefined).length,
      cellsWithoutZone: cells.filter((cell) => cell.zoneId === undefined)
        .length,
      cellsWithZoneOverlap: cells.filter(
        (cell) => cell.overlappingZoneIds.length > 1,
      ).length,
      landscapeSuppressedCells: cells.filter(
        (cell) => cell.buildability === 'none',
      ).length,
      landmarkZoneMismatches: diagnoseLandmarkAssociations(metadata),
    }),
  });
}
export type SettlementPopulationOverlay = ReturnType<
  typeof enrichSettlementPopulation
>;
