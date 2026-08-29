import { describe, expect, it } from 'vitest';
import {
  createInitialPassengerDemandState,
  createScenarioCoordinate,
  parsePassengerDemandPlan,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  calibratePassengerEmissionWorkWindow,
  selectPassengerEmissionWorkWindow,
} from './passenger-work-window-calibration.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
const plan = () => {
  const canonical = scenario();
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'c'.repeat(64),
    scenario: createScenarioCoordinate(canonical),
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 2,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 2,
      totalPopulationWeight: 3,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 50_000,
    },
    accessPolicy: { accessTicksPerCell: 1 },
    cells: [1, 2].map((populationWeight, column) => ({
      cellId: `r0c${column}`,
      row: 0,
      column,
      populationWeight,
      assignedStopPlaceId: 'tv-place-0053',
      distanceSquaredCells: 0,
    })),
    stops: [{ stopPlaceId: 'tv-place-0053' }],
  });
};

describe('passenger work-window calibration', () => {
  it('selects only material wins and prefers the larger effectively tied window', () => {
    expect(
      selectPassengerEmissionWorkWindow([
        { workWindowTicks: 12, elapsedMilliseconds: 10 },
        { workWindowTicks: 4, elapsedMilliseconds: 11 },
      ]),
    ).toBe(12);
    expect(
      selectPassengerEmissionWorkWindow([
        { workWindowTicks: 12, elapsedMilliseconds: 10 },
        { workWindowTicks: 8, elapsedMilliseconds: 9.6 },
      ]),
    ).toBe(12);
    expect(
      selectPassengerEmissionWorkWindow([
        { workWindowTicks: 12, elapsedMilliseconds: 10 },
        { workWindowTicks: 4, elapsedMilliseconds: 7 },
      ]),
    ).toBe(4);
    expect(
      selectPassengerEmissionWorkWindow([
        { workWindowTicks: 12, elapsedMilliseconds: 10 },
        { workWindowTicks: 1, elapsedMilliseconds: 5 },
      ]),
    ).toBe(1);
    expect(
      selectPassengerEmissionWorkWindow([
        { workWindowTicks: 12, elapsedMilliseconds: 10 },
        { workWindowTicks: 4, elapsedMilliseconds: 6 },
        { workWindowTicks: 8, elapsedMilliseconds: 6.2 },
      ]),
    ).toBe(8);
  });

  it('rejects invalid samples and incomplete evidence conservatively', () => {
    expect(
      selectPassengerEmissionWorkWindow([
        { workWindowTicks: 12, elapsedMilliseconds: 10 },
        { workWindowTicks: 4, elapsedMilliseconds: Number.NaN },
        { workWindowTicks: 13, elapsedMilliseconds: 1 },
      ]),
    ).toBe(12);
    expect(
      selectPassengerEmissionWorkWindow([
        { workWindowTicks: 4, elapsedMilliseconds: 1 },
      ]),
    ).toBe(12);
    expect(selectPassengerEmissionWorkWindow([])).toBe(12);
  });

  it('is bounded, immutable, deterministic, and leaves canonical inputs untouched', () => {
    const demandPlan = plan();
    const state = createInitialPassengerDemandState(demandPlan, 7);
    const beforePlan = structuredClone(demandPlan);
    const beforeState = structuredClone(state);
    let time = 0;
    const run = () =>
      calibratePassengerEmissionWorkWindow({
        demandPlan,
        passengerDemandState: state,
        budgetMilliseconds: 5,
        now: () => (time += 2),
      });
    const first = run();
    time = 0;
    expect(run()).toEqual(first);
    expect(first.selectedWorkWindowTicks).toBeGreaterThanOrEqual(1);
    expect(first.selectedWorkWindowTicks).toBeLessThanOrEqual(12);
    expect(first.measuredCandidateCount).toBe(1);
    expect(first.fallbackUsed).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(demandPlan).toEqual(beforePlan);
    expect(state).toEqual(beforeState);
  });

  it('falls back when timing is unavailable or non-finite', () => {
    const demandPlan = plan();
    const passengerDemandState = createInitialPassengerDemandState(
      demandPlan,
      0,
    );
    for (const now of [
      () => Number.NaN,
      () => {
        throw new Error('clock');
      },
    ])
      expect(
        calibratePassengerEmissionWorkWindow({
          demandPlan,
          passengerDemandState,
          now,
        }),
      ).toMatchObject({
        selectedWorkWindowTicks: 12,
        fallbackUsed: true,
      });

    const decreasing = [0, 0, 5, 4];
    expect(
      calibratePassengerEmissionWorkWindow({
        demandPlan,
        passengerDemandState,
        now: () => decreasing.shift()!,
      }),
    ).toMatchObject({ selectedWorkWindowTicks: 12, fallbackUsed: true });

    const negativeElapsed = [0, 0, -2, -1, Number.POSITIVE_INFINITY];
    expect(
      calibratePassengerEmissionWorkWindow({
        demandPlan,
        passengerDemandState,
        now: () => negativeElapsed.shift()!,
      }),
    ).toMatchObject({ elapsedMilliseconds: 0, fallbackUsed: true });
  });

  it('measures every supported candidate when the budget remains available', () => {
    const demandPlan = plan();
    expect(
      calibratePassengerEmissionWorkWindow({
        demandPlan,
        passengerDemandState: createInitialPassengerDemandState(demandPlan, 0),
        now: () => 0,
      }),
    ).toEqual({
      selectedWorkWindowTicks: 12,
      measuredCandidateCount: 12,
      elapsedMilliseconds: 0,
      fallbackUsed: true,
    });
  });
});
