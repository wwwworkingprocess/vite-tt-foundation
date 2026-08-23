import { describe, expect, it } from 'vitest';
import * as simulationPackage from './index.js';
import { deepFreeze, freezeTrustedAuthority } from './authority-utils.js';
import {
  allocatePassengerDestinations,
  advanceTrustedPassengerDemandToTick,
  createInitialPassengerDemandState,
  createPassengerDemandPlan,
  listPassengerDestinationCandidates,
} from './passenger-demand.js';
import {
  allocateTrustedPassengerDestinations,
  passengerDemandRuntimeIndex,
} from './passenger-demand-runtime.js';

const plan = () =>
  createPassengerDemandPlan({
    demandModelContentHash: 'a'.repeat(64),
    catchment: {
      scenario: {
        scenarioSchemaVersion: '1.0.0',
        scenarioId: 'runtime-index',
        scenarioVersion: '1.0.0',
        contentHash: 'b'.repeat(64),
      },
      grid: {
        cityId: 'Q1',
        populationGridSchemaVersion: '1.0.0',
        gridVersion: '1.0.0',
        rows: 2,
        columns: 3,
        resolutionDegrees: 0.001,
        totalActiveCellCount: 5,
        totalPopulationWeight: 18,
      },
      cellAssignments: [
        ['r0c0', 0, 0, 2, 'a'],
        ['r0c1', 0, 1, 3, 'b'],
        ['r0c2', 0, 2, 5, 'c'],
        ['r1c0', 1, 0, 7, 'a'],
        ['r1c1', 1, 1, 1, null],
      ].map(([cellId, row, column, populationWeight, assignedStopPlaceId]) => ({
        cellId,
        row,
        column,
        center: { latitude: 1, longitude: 1 },
        populationWeight,
        assignedStopPlaceId,
        distanceSquaredCells: assignedStopPlaceId ? 1 : null,
      })),
      stopSummaries: ['a', 'b', 'c'].map((stopPlaceId) => ({
        stopPlaceId,
        assignedActiveCellCount: 0,
        assignedPopulationWeight: 0,
      })),
      coverage: {
        totalPopulationWeight: 18,
        servedPopulationWeight: 17,
        unservedPopulationWeight: 1,
        servedActiveCellCount: 4,
        unservedActiveCellCount: 1,
        coverageBasisPoints: 9444,
      },
      catchmentPolicy: { maxAccessDistanceCells: 5 },
    } as never,
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 50_000,
    },
    accessPolicy: { accessTicksPerCell: 1 },
  });

describe('internal passenger-demand runtime', () => {
  it('does not expose the trusted reducer from the package root', () => {
    expect(simulationPackage).not.toHaveProperty(
      'advanceTrustedPassengerDemandToTick',
    );
    expect(simulationPackage).not.toHaveProperty(
      'activateTrustedPassengerDirectItineraries',
    );
  });
  it.each([0, 1, 8, 9, 10, 37])(
    'matches the public allocator for %i passengers',
    (passengerCount) => {
      const value = plan();
      const index = passengerDemandRuntimeIndex(value);
      for (const origin of ['a', 'b', 'c']) {
        const referenceCandidates = listPassengerDestinationCandidates(
          value,
          origin,
        );
        const total = referenceCandidates.reduce(
          (sum, candidate) => sum + candidate.weight,
          0,
        );
        const cursor = total > 1 ? total - 1 : 0;
        const reference = allocatePassengerDestinations(
          referenceCandidates,
          cursor,
          passengerCount,
          value.demandModelContentHash,
          origin,
        );
        expect(
          allocateTrustedPassengerDestinations(
            index,
            origin,
            cursor,
            passengerCount,
          ),
        ).toEqual({
          allocations: reference.allocations.filter(({ count }) => count > 0),
          nextCursor: reference.nextCursor,
        });
      }
    },
  );

  it('retains only linear shared cell and StopPlace index records', () => {
    const value = plan();
    const index = passengerDemandRuntimeIndex(value);
    expect(passengerDemandRuntimeIndex(value)).toBe(index);
    expect(index.planCellCount).toBe(5);
    expect(index.findCell('r0c0')).toBe(value.cells[0]);
    expect(index.findCell('r0c2')).toBe(value.cells[2]);
    expect(index.findCell('r1c1')).toBe(value.cells[4]);
    expect(index.findCell('r9c9')).toBeUndefined();
    expect(Object.isFrozen(index.findCell('r0c0'))).toBe(true);
    expect(Object.isFrozen(index)).toBe(true);
    expect(index).not.toHaveProperty('cellsById');
    expect(index.servedCandidates).toHaveLength(4);
    expect(index.assignedWeightByStopPlace.size).toBe(3);
    const exclusionRecords = [...index.exclusionByStopPlace.values()].reduce(
      (total, exclusion) =>
        total + exclusion.indexes.length + exclusion.cumulativeEnds.length,
      0,
    );
    expect({
      candidates: index.servedCandidates.length,
      cumulativeEnds: index.cumulativeWeightEnds.length,
      exclusionRecords,
      assignedStops: index.assignedWeightByStopPlace.size,
      exclusionStops: index.exclusionByStopPlace.size,
      cellLookupEntries: index.planCellCount,
    }).toEqual({
      candidates: 4,
      cumulativeEnds: 4,
      exclusionRecords: 8,
      assignedStops: 3,
      exclusionStops: 3,
      cellLookupEntries: 5,
    });
  });

  it('returns no allocation when the compact index has no alternate destination', () => {
    expect(
      allocateTrustedPassengerDestinations(
        {
          demandModelContentHash: 'a'.repeat(64),
          servedCandidates: [],
          totalServedDestinationWeight: 0,
          assignedWeightByStopPlace: new Map(),
          exclusionByStopPlace: new Map(),
          cumulativeWeightEnds: [],
          planCellCount: 0,
          findCell: () => undefined,
        },
        'a',
        0,
        10,
      ),
    ).toEqual({ allocations: [], nextCursor: 0 });
  });

  it('keeps a moderately large index linear without weight-unit expansion', () => {
    const base = plan();
    const cellCount = 600;
    const stopCount = 30;
    const large = {
      ...base,
      grid: {
        ...base.grid,
        rows: 20,
        columns: 30,
        totalActiveCellCount: cellCount,
        totalPopulationWeight: cellCount * 10_000,
      },
      cells: Array.from({ length: cellCount }, (_, index) => ({
        cellId: `r${Math.floor(index / 30)}c${index % 30}`,
        row: Math.floor(index / 30),
        column: index % 30,
        populationWeight: 10_000,
        assignedStopPlaceId: `stop-${String(index % stopCount).padStart(2, '0')}`,
        distanceSquaredCells: 1,
      })),
      stops: Array.from({ length: stopCount }, (_, index) => ({
        stopPlaceId: `stop-${String(index).padStart(2, '0')}`,
      })),
    } as unknown as typeof base;
    const index = passengerDemandRuntimeIndex(large);
    const exclusionRecords = [...index.exclusionByStopPlace.values()].reduce(
      (total, exclusion) =>
        total + exclusion.indexes.length + exclusion.cumulativeEnds.length,
      0,
    );
    expect(index.servedCandidates).toHaveLength(cellCount);
    expect(index.cumulativeWeightEnds).toHaveLength(cellCount);
    expect(exclusionRecords).toBe(cellCount * 2);
    expect(index.assignedWeightByStopPlace.size).toBe(stopCount);
    expect(index.exclusionByStopPlace.size).toBe(stopCount);
    expect(index.servedCandidates).toHaveLength(cellCount);
    expect(index.planCellCount).toBe(cellCount);
    expect(index.findCell('r0c0')).toBe(large.cells[0]);
    expect(index.findCell('r19c29')).toBe(large.cells[cellCount - 1]);
  });

  it('uses the compact global index when the origin has no excluded cells', () => {
    const index = passengerDemandRuntimeIndex(plan());
    expect(
      allocateTrustedPassengerDestinations(index, 'external-origin', 0, 1)
        .allocations,
    ).toHaveLength(1);
  });

  it('accounts for arrivals with no alternate destination in trusted advancement', () => {
    const value = plan();
    const singleStop = {
      ...value,
      emissionPolicy: {
        emissionCreditsPerWeightPerTick: 1,
        creditsPerPassenger: 1,
      },
      cells: value.cells.map((cell) => ({
        ...cell,
        assignedStopPlaceId: 'a',
        distanceSquaredCells: 0,
      })),
      stops: [{ stopPlaceId: 'a' }],
    } as unknown as typeof value;
    const initial = createInitialPassengerDemandState(singleStop, 0);
    if (initial.status !== 'active') throw new Error('Expected active demand.');
    const advanced = advanceTrustedPassengerDemandToTick(
      singleStop,
      {} as never,
      initial,
      1,
    );
    expect(advanced.destinationUnavailableAtStopPassengerCount).toBe(18);
    expect(advanced.totalDestinationAssignedPassengerCount).toBe(0);
  });

  it('deep-freezes descendants of shallow-frozen containers', () => {
    const child = { value: 1 };
    const array = Object.freeze([child]);
    const frozen = deepFreeze({ array });
    expect(Object.isFrozen(frozen.array)).toBe(true);
    expect(Object.isFrozen(child)).toBe(true);
    expect(() => {
      child.value = 2;
    }).toThrow();
  });

  it('trusted freezing preserves canonical frozen subtrees', () => {
    const child = deepFreeze({ value: 1 });
    const array = deepFreeze([child]);
    const frozen = freezeTrustedAuthority({ array });
    expect(frozen.array).toBe(array);
    expect(frozen.array[0]).toBe(child);
  });
});
