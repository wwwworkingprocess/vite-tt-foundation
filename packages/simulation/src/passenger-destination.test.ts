import { describe, expect, it } from 'vitest';
import {
  allocatePassengerDestinations,
  listPassengerDestinationCandidates,
  parsePassengerDemandPlan,
} from './passenger-demand.js';

const plan = () =>
  parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'd'.repeat(64),
    scenario: {
      scenarioSchemaVersion: '1.0.0',
      scenarioId: 'destination-fixture',
      scenarioVersion: '1.0.0',
      contentHash: 'e'.repeat(64),
    },
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 2,
      columns: 3,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 4,
      totalPopulationWeight: 7,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 1,
    },
    accessPolicy: { accessTicksPerCell: 1 },
    cells: [
      {
        cellId: 'r1c2',
        row: 1,
        column: 2,
        populationWeight: 3,
        assignedStopPlaceId: 'stop-c',
        distanceSquaredCells: 1,
      },
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        populationWeight: 2,
        assignedStopPlaceId: 'stop-b',
        distanceSquaredCells: 1,
      },
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        populationWeight: 1,
        assignedStopPlaceId: 'stop-a',
        distanceSquaredCells: 0,
      },
      {
        cellId: 'r1c0',
        row: 1,
        column: 0,
        populationWeight: 1,
        assignedStopPlaceId: null,
        distanceSquaredCells: null,
      },
    ],
    stops: [
      { stopPlaceId: 'stop-c' },
      { stopPlaceId: 'stop-a' },
      { stopPlaceId: 'stop-b' },
    ],
  });

describe('deterministic passenger destination allocation', () => {
  it('derives served, other-stop candidates in canonical row-major order', () => {
    const candidates = listPassengerDestinationCandidates(plan(), 'stop-a');
    expect(candidates).toEqual([
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        destinationStopPlaceId: 'stop-b',
        weight: 2,
      },
      {
        cellId: 'r1c2',
        row: 1,
        column: 2,
        destinationStopPlaceId: 'stop-c',
        weight: 3,
      },
    ]);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(Object.isFrozen(candidates[0])).toBe(true);
  });

  it('allocates weighted cycles, partial intervals, and wrap-around exactly', () => {
    const candidates = [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        destinationStopPlaceId: 'a',
        weight: 1,
      },
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        destinationStopPlaceId: 'b',
        weight: 2,
      },
      {
        cellId: 'r0c2',
        row: 0,
        column: 2,
        destinationStopPlaceId: 'c',
        weight: 3,
      },
    ] as const;
    expect(allocatePassengerDestinations(candidates, 0, 6)).toMatchObject({
      allocations: [{ count: 1 }, { count: 2 }, { count: 3 }],
      nextCursor: 0,
    });
    expect(allocatePassengerDestinations(candidates, 5, 4)).toMatchObject({
      allocations: [{ count: 1 }, { count: 2 }, { count: 1 }],
      nextCursor: 3,
    });
  });

  it('handles huge counts without a per-passenger loop and rejects invalid arithmetic', () => {
    const candidates = [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        destinationStopPlaceId: 'a',
        weight: 1,
      },
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        destinationStopPlaceId: 'b',
        weight: 2,
      },
    ] as const;
    const result = allocatePassengerDestinations(candidates, 0, 3_000_000_000);
    expect(result.allocations.map(({ count }) => count)).toEqual([
      1_000_000_000, 2_000_000_000,
    ]);
    expect(result.nextCursor).toBe(0);
    expect(() => allocatePassengerDestinations(candidates, 3, 1)).toThrow();
    expect(() =>
      allocatePassengerDestinations(
        [
          { ...candidates[0], weight: Number.MAX_SAFE_INTEGER },
          { ...candidates[1], weight: 1 },
        ],
        0,
        2,
      ),
    ).toThrow();
    expect(() =>
      listPassengerDestinationCandidates(plan(), 'missing-stop'),
    ).toThrow(/unknown origin/i);
    expect(allocatePassengerDestinations([], 0, 50)).toEqual({
      allocations: [],
      nextCursor: 0,
    });
    expect(() => allocatePassengerDestinations([], 1, 0)).toThrow();
    expect(() =>
      allocatePassengerDestinations([{ ...candidates[0], weight: 0 }], 0, 1),
    ).toThrow();
    expect(() =>
      allocatePassengerDestinations([candidates[0], candidates[0]], 0, 1),
    ).toThrow();
  });
});
