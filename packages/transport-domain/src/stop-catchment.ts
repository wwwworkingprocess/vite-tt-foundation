import type { CanonicalScenario, StopPlaceId } from './index.js';
import {
  CityPopulationDomainError,
  cityPopulationGridResolutionDegrees,
  listActivePopulationCells,
  type CityId,
  type CityPopulationCellId,
  type CityPopulationGrid,
  type Wgs84Position,
} from './city-population-grid.js';

const distanceTieToleranceSquaredCells = 1e-9;

export interface EligibleStopPlace {
  readonly stopPlaceId: StopPlaceId;
  readonly position: Readonly<Wgs84Position>;
}

export interface StopCatchmentCellAssignment {
  readonly cellId: CityPopulationCellId;
  readonly row: number;
  readonly column: number;
  readonly center: Readonly<Wgs84Position>;
  readonly populationWeight: number;
  readonly assignedStopPlaceId: StopPlaceId | null;
  readonly distanceSquaredCells: number | null;
}

export interface StopCatchmentStopSummary {
  readonly stopPlaceId: StopPlaceId;
  readonly assignedActiveCellCount: number;
  readonly assignedPopulationWeight: number;
}

export interface StopCatchmentResult {
  readonly grid: Readonly<{
    cityId: CityId;
    populationGridSchemaVersion: '1.0.0';
    gridVersion: string;
    rows: number;
    columns: number;
    resolutionDegrees: 0.001;
    totalActiveCellCount: number;
    totalPopulationWeight: number;
  }>;
  readonly cellAssignments: readonly Readonly<StopCatchmentCellAssignment>[];
  readonly stopSummaries: readonly Readonly<StopCatchmentStopSummary>[];
  readonly coverage: Readonly<{
    totalPopulationWeight: number;
    servedPopulationWeight: number;
    unservedPopulationWeight: number;
    servedActiveCellCount: number;
    unservedActiveCellCount: number;
    coverageBasisPoints: number;
  }>;
}

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const compareIds = (left: string, right: string) => (left < right ? -1 : 1);

const checkedAdd = (left: number, right: number, context: string) => {
  const result = left + right;
  if (!Number.isSafeInteger(result))
    throw new CityPopulationDomainError('arithmetic-overflow', context);
  return result;
};

const isValidPosition = (
  value: Readonly<Wgs84Position> | undefined,
): value is Readonly<Wgs84Position> =>
  value !== undefined &&
  Number.isFinite(value.latitude) &&
  value.latitude >= -90 &&
  value.latitude <= 90 &&
  Number.isFinite(value.longitude) &&
  value.longitude >= -180 &&
  value.longitude <= 180;

export function listEligibleStopPlaces(
  scenario: CanonicalScenario,
): readonly Readonly<EligibleStopPlace>[] {
  const referenced = new Set(
    scenario.stops.stopNodes.flatMap((node) =>
      node.stopPlaceId === null ? [] : [node.stopPlaceId],
    ),
  );
  const eligible = scenario.stops.stopPlaces
    .filter((place) => referenced.has(place.stopPlaceId))
    .map((place) => {
      if (!isValidPosition(place.position))
        throw new CityPopulationDomainError(
          'invalid-stop-place',
          `${place.stopPlaceId} requires a canonical WGS84 position`,
        );
      return {
        stopPlaceId: place.stopPlaceId,
        position: { ...place.position },
      };
    })
    .sort((left, right) => compareIds(left.stopPlaceId, right.stopPlaceId));
  return deepFreeze(eligible);
}

export function buildStopCatchments(input: {
  readonly grid: CityPopulationGrid;
  readonly scenario: CanonicalScenario;
  readonly maxAccessDistanceCells: number;
}): StopCatchmentResult {
  if (
    !Number.isSafeInteger(input.maxAccessDistanceCells) ||
    input.maxAccessDistanceCells <= 0
  )
    throw new CityPopulationDomainError(
      'invalid-catchment-configuration',
      'maxAccessDistanceCells must be a positive safe integer',
    );
  const maximumDistanceSquared =
    input.maxAccessDistanceCells * input.maxAccessDistanceCells;
  if (!Number.isSafeInteger(maximumDistanceSquared))
    throw new CityPopulationDomainError(
      'invalid-catchment-configuration',
      'squared maximum access distance must be safe',
    );
  const cells = listActivePopulationCells(input.grid);
  const stops = listEligibleStopPlaces(input.scenario);
  const totals = new Map<
    StopPlaceId,
    { activeCells: number; populationWeight: number }
  >(
    stops.map((stop) => [
      stop.stopPlaceId,
      { activeCells: 0, populationWeight: 0 },
    ]),
  );
  let totalPopulationWeight = 0;
  let servedPopulationWeight = 0;
  let servedActiveCellCount = 0;
  const cellAssignments = cells.map((cell) => {
    totalPopulationWeight = checkedAdd(
      totalPopulationWeight,
      cell.populationWeight,
      'total population weight',
    );
    let nearest: Readonly<EligibleStopPlace> | undefined;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const stop of stops) {
      const deltaLatitudeCells =
        (stop.position.latitude - cell.center.latitude) /
        cityPopulationGridResolutionDegrees;
      const deltaLongitudeCells =
        (stop.position.longitude - cell.center.longitude) /
        cityPopulationGridResolutionDegrees;
      const distanceSquared =
        deltaLatitudeCells * deltaLatitudeCells +
        deltaLongitudeCells * deltaLongitudeCells;
      if (
        distanceSquared <
          nearestDistanceSquared - distanceTieToleranceSquaredCells ||
        (Math.abs(distanceSquared - nearestDistanceSquared) <=
          distanceTieToleranceSquaredCells &&
          nearest !== undefined &&
          compareIds(stop.stopPlaceId, nearest.stopPlaceId) < 0)
      ) {
        nearest = stop;
        nearestDistanceSquared = distanceSquared;
      }
    }
    const assigned =
      nearest !== undefined &&
      nearestDistanceSquared <=
        maximumDistanceSquared + distanceTieToleranceSquaredCells
        ? nearest
        : undefined;
    if (assigned) {
      servedActiveCellCount = checkedAdd(
        servedActiveCellCount,
        1,
        'served active-cell count',
      );
      servedPopulationWeight = checkedAdd(
        servedPopulationWeight,
        cell.populationWeight,
        'served population weight',
      );
      const total = totals.get(assigned.stopPlaceId)!;
      total.activeCells = checkedAdd(
        total.activeCells,
        1,
        `assigned cells for ${assigned.stopPlaceId}`,
      );
      total.populationWeight = checkedAdd(
        total.populationWeight,
        cell.populationWeight,
        `assigned weight for ${assigned.stopPlaceId}`,
      );
    }
    return {
      ...cell,
      assignedStopPlaceId: assigned?.stopPlaceId ?? null,
      distanceSquaredCells:
        assigned === undefined ? null : nearestDistanceSquared,
    };
  });
  const unservedPopulationWeight =
    totalPopulationWeight - servedPopulationWeight;
  const unservedActiveCellCount = cells.length - servedActiveCellCount;
  const stopSummaries = stops.map((stop) => {
    const total = totals.get(stop.stopPlaceId)!;
    return {
      stopPlaceId: stop.stopPlaceId,
      assignedActiveCellCount: total.activeCells,
      assignedPopulationWeight: total.populationWeight,
    };
  });
  const coverageBasisPoints =
    totalPopulationWeight === 0
      ? 10_000
      : Math.floor((servedPopulationWeight / totalPopulationWeight) * 10_000);
  return deepFreeze({
    grid: {
      cityId: input.grid.cityId,
      populationGridSchemaVersion: input.grid.schemaVersion,
      gridVersion: input.grid.gridVersion,
      rows: input.grid.rows,
      columns: input.grid.columns,
      resolutionDegrees: input.grid.resolutionDegrees,
      totalActiveCellCount: cells.length,
      totalPopulationWeight,
    },
    cellAssignments,
    stopSummaries,
    coverage: {
      totalPopulationWeight,
      servedPopulationWeight,
      unservedPopulationWeight,
      servedActiveCellCount,
      unservedActiveCellCount,
      coverageBasisPoints,
    },
  });
}
