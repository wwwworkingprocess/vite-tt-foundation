import { describe, expect, it } from 'vitest';
import {
  allocatePassengerDestinations,
  listPassengerDestinationCandidates,
  parsePassengerDemandPlan,
} from './passenger-demand.js';
import {
  addModulo,
  allocatePermutedDestinationCounts,
  derivePassengerDestinationPermutation,
  multiplyModulo,
} from './passenger-destination-permutation.js';

const modelHash = 'd'.repeat(64);
const allocate = (
  candidates: Parameters<typeof allocatePassengerDestinations>[0],
  cursor: number,
  passengerCount: number,
  origin = 'stop-a',
) =>
  allocatePassengerDestinations(
    candidates,
    cursor,
    passengerCount,
    modelHash,
    origin,
  );

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
    expect(allocate(candidates, 0, 6)).toMatchObject({
      allocations: [{ count: 1 }, { count: 2 }, { count: 3 }],
      nextCursor: 0,
    });
    expect(allocate(candidates, 5, 4)).toMatchObject({
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
    const result = allocate(candidates, 0, 3_000_000_000);
    expect(result.allocations.map(({ count }) => count)).toEqual([
      1_000_000_000, 2_000_000_000,
    ]);
    expect(result.nextCursor).toBe(0);
    expect(() => allocate(candidates, 3, 1)).toThrow();
    expect(() =>
      allocate(
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
    expect(allocate([], 0, 50)).toEqual({
      allocations: [],
      nextCursor: 0,
    });
    expect(() => allocate([], 1, 0)).toThrow();
    expect(() => allocate([{ ...candidates[0], weight: 0 }], 0, 1)).toThrow();
    expect(() => allocate([candidates[0], candidates[0]], 0, 1)).toThrow();
  });

  it.each([
    [-1, 0],
    [0.5, 0],
    [0, -1],
    [0, Number.POSITIVE_INFINITY],
  ])(
    'rejects invalid allocation coordinates (%s, %s)',
    (cursor, passengerCount) => {
      expect(() => allocate([], cursor, passengerCount)).toThrow(
        'Invalid allocation.',
      );
    },
  );

  it('wraps a maximum-safe weighted cycle without unsafe cursor addition', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const passengerCount = maximum - 2;
    const result = allocate(
      [
        {
          cellId: 'r0c0',
          row: 0,
          column: 0,
          destinationStopPlaceId: 'a',
          weight: maximum,
        },
      ],
      maximum - 1,
      passengerCount,
    );
    expect(result.allocations[0]?.count).toBe(passengerCount);
    expect(result.nextCursor).toBe(maximum - 3);
  });

  it('conserves near-limit multi-candidate split and batched allocation', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const candidates = [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        destinationStopPlaceId: 'a',
        weight: maximum - 10,
      },
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        destinationStopPlaceId: 'b',
        weight: 10,
      },
    ] as const;
    const original = structuredClone(candidates);
    const cursor = maximum - 5;
    const firstCount = maximum - 20;
    const secondCount = 18;
    const batch = allocate(candidates, cursor, firstCount + secondCount);
    const first = allocate(candidates, cursor, firstCount);
    const second = allocate(candidates, first.nextCursor, secondCount);
    const splitTotals = first.allocations.map(
      (allocation, index) =>
        allocation.count + second.allocations[index]!.count,
    );
    expect(batch.allocations.map(({ count }) => count)).toEqual(splitTotals);
    expect(
      batch.allocations.reduce(
        (total, allocation) => total + allocation.count,
        0,
      ),
    ).toBe(firstCount + secondCount);
    expect(
      batch.allocations.every((allocation) =>
        Number.isSafeInteger(allocation.count),
      ),
    ).toBe(true);
    expect(batch.nextCursor).toBe(second.nextCursor);
    expect(batch.nextCursor).toBe(maximum - 7);
    expect(candidates).toEqual(original);
  });

  it('derives stable origin-specific coprime permutations and dispersed windows', () => {
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      cellId: `r0c${index}`,
      row: 0,
      column: index,
      destinationStopPlaceId: `destination-${index}`,
      weight: 10,
    }));
    const origins = ['origin-a', 'origin-b', 'origin-c'];
    const parameters = origins.map((origin) =>
      derivePassengerDestinationPermutation(modelHash, origin, 60),
    );
    expect(
      new Set(parameters.map(({ phase, stride }) => `${phase}:${stride}`)).size,
    ).toBeGreaterThan(1);
    for (const value of parameters) {
      expect(value.phase).toBeGreaterThanOrEqual(0);
      expect(value.phase).toBeLessThan(60);
      expect([
        1, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 49, 53, 59,
      ]).toContain(value.stride);
    }
    const sequences = origins.map((origin) =>
      allocate(candidates, 0, 8, origin).allocations.map(({ count }) => count),
    );
    expect(
      new Set(sequences.map((value) => JSON.stringify(value))).size,
    ).toBeGreaterThan(1);
    expect(
      sequences.every(
        (counts) => counts.filter((count) => count > 0).length > 1,
      ),
    ).toBe(true);
  });

  it('keeps exact modular arithmetic near the safe-integer limit', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(addModulo(maximum - 2, 1, maximum)).toBe(maximum - 1);
    expect(addModulo(maximum - 1, 1, maximum)).toBe(0);
    expect(multiplyModulo(maximum - 2, maximum - 2, maximum)).toBe(4);
    expect(() => addModulo(maximum, 0, maximum)).toThrow();
    expect(() => multiplyModulo(0, -1, maximum)).toThrow();
    expect(() => multiplyModulo(Number.NaN, 0, maximum)).toThrow();
    expect(() => addModulo(0, Number.NaN, maximum)).toThrow();
    expect(() => addModulo(0, 0, 0)).toThrow();
    expect(() =>
      derivePassengerDestinationPermutation(modelHash, 'a', 0),
    ).toThrow();
    expect(
      allocatePermutedDestinationCounts(
        [],
        0,
        0,
        { phase: 0, stride: 0 },
        () => 0,
      ),
    ).toEqual({ counts: [], nextCursor: 0 });
  });

  it('validates public permutation coordinates and documents giant-cycle fallback', () => {
    const candidate = {
      cellId: 'r0c0',
      row: 0,
      column: 0,
      destinationStopPlaceId: 'destination',
      weight: 0x1_0000_0000,
    } as const;
    expect(() =>
      allocatePassengerDestinations([candidate], 0, 1, 'bad', 'origin'),
    ).toThrow('Invalid destination permutation coordinate.');
    expect(() =>
      allocatePassengerDestinations([candidate], 0, 1, modelHash, ' '),
    ).toThrow('Invalid destination permutation coordinate.');
    expect(
      derivePassengerDestinationPermutation(
        modelHash,
        'origin',
        candidate.weight,
      ).stride,
    ).toBe(1);
    const batch = allocate([candidate], candidate.weight - 1, 20, 'origin');
    const first = allocate([candidate], candidate.weight - 1, 7, 'origin');
    const second = allocate([candidate], first.nextCursor, 13, 'origin');
    expect(batch.allocations[0]!.count).toBe(20);
    expect(batch.nextCursor).toBe(second.nextCursor);
    expect(first.allocations[0]!.count + second.allocations[0]!.count).toBe(20);
  });
});
