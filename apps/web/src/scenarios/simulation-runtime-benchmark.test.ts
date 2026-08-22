import { describe, expect, it } from 'vitest';
import {
  parseSimulationRuntimeBenchmarkArguments,
  runSimulationRuntimeBenchmark,
  summarizePassengerDestinationWaitingBreakdown,
  summarizePassengerRuntimePhases,
  summarizePassengerWaitingActivationBreakdown,
} from '../../../../scripts/simulation-runtime-benchmark.mjs';
import { runPassengerEmissionRuntimeBenchmark } from '../../../../scripts/passenger-emission-runtime-benchmark.mjs';

describe('headless simulation runtime benchmark', () => {
  it('parses deterministic workload controls strictly', () => {
    expect(
      parseSimulationRuntimeBenchmarkArguments([
        '--scenario',
        'torrevieja-legacy-abc-v1',
        '--runs',
        '2',
        '--warmup',
        '3',
        '--ticks',
        '4',
        '--json',
      ]),
    ).toEqual({
      scenario: 'torrevieja-legacy-abc-v1',
      runs: 2,
      warmup: 3,
      ticks: 4,
      json: true,
      passengerWorkWindow: 12,
      profilePassengerPhases: false,
    });
    expect(() => parseSimulationRuntimeBenchmarkArguments([])).toThrow(
      /scenario/i,
    );
    expect(() =>
      parseSimulationRuntimeBenchmarkArguments([
        '--scenario',
        'fixture',
        '--ticks',
        '0',
      ]),
    ).toThrow(/positive safe integer/i);
    expect(() => parseSimulationRuntimeBenchmarkArguments(['--wat'])).toThrow(
      /unknown/i,
    );
  });

  it('profiles canonical passenger phases and aggregates synthetic durations', async () => {
    let clock = 0;
    const result = await runSimulationRuntimeBenchmark(
      {
        scenario: 'torrevieja-legacy-abc-v1',
        runs: 1,
        warmup: 0,
        ticks: 1,
        passengerWorkWindow: 1,
        profilePassengerPhases: true,
      },
      () => clock++,
    );

    expect(result.configuration.passengerEmissionWorkWindowTicks).toBe(1);
    const phases = result.passengerPhases!;
    expect(Object.keys(phases)).toEqual([
      'passenger-emission',
      'passenger-access-arrival',
      'passenger-destination-waiting',
      'passenger-vehicle-transit',
      'passenger-destination-access-completion',
    ]);
    expect(result.measuredPassengerPhaseTotalMs!).toBeGreaterThan(0);
    expect(result.unattributedSimulationMs!).toBeGreaterThanOrEqual(0);
    expect(
      Object.values(phases).reduce(
        (sum, phase) => sum + phase.shareOfMeasuredPassengerTime,
        0,
      ),
    ).toBeCloseTo(100);
  }, 30_000);

  it('measures repeated single-tick advancement with deterministic final authority', async () => {
    let clock = 0;
    const result = await runSimulationRuntimeBenchmark(
      {
        scenario: 'torrevieja-legacy-abc-v1',
        runs: 2,
        warmup: 2,
        ticks: 3,
      },
      () => clock++,
    );

    expect(result).toMatchObject({
      configuration: {
        runs: 2,
        warmupTicks: 2,
        measuredTicks: 3,
        edgeTravelTicks: 120,
        passengerCapacity: 80,
        passengerEmissionWorkWindowTicks: 12,
      },
      structure: { routes: 3, patterns: 6, stopPlaces: 79 },
      timings: {
        elapsedMilliseconds: { min: 1, median: 1, max: 1 },
        millisecondsPerTick: { min: 1 / 3, median: 1 / 3, max: 1 / 3 },
        ticksPerSecond: { min: 3000, median: 3000, max: 3000 },
      },
      finalAuthority: {
        startTick: 2,
        tick: 5,
        fleetSize: 3,
        finalSnapshotSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(result.structure).toMatchObject({
      demandPlanCells: expect.any(Number),
      servedDemandPlanCells: expect.any(Number),
      totalActivePopulationCells: expect.any(Number),
      totalPopulationWeight: expect.any(Number),
      itineraryStopPlaces: 79,
      directItineraryPairCount: 1112,
    });
    expect(result.passengerPhases).toBeUndefined();
  }, 30_000);

  it('summarizes synthetic phase durations and work counts exactly', () => {
    const names = [
      'passenger-emission',
      'passenger-access-arrival',
      'passenger-destination-waiting',
      'passenger-vehicle-transit',
      'passenger-destination-access-completion',
    ];
    const durations = Object.fromEntries(
      names.map((name, index) => [name, index === 0 ? [2, 4] : []]),
    );
    const work = Object.fromEntries(
      names.map((name) => [name, name === names[0] ? { cells: 12 } : {}]),
    );
    expect(
      summarizePassengerRuntimePhases(durations, work, 3, 10),
    ).toMatchObject({
      measuredPassengerPhaseTotalMs: 6,
      unattributedSimulationMs: 4,
      passengerPhases: {
        'passenger-emission': {
          invocations: 2,
          totalMs: 6,
          msPerTick: 2,
          meanMsPerInvocation: 3,
          shareOfMeasuredPassengerTime: 100,
          work: { cells: 12 },
        },
        'passenger-access-arrival': {
          invocations: 0,
          meanMsPerInvocation: 0,
          shareOfMeasuredPassengerTime: 0,
        },
      },
    });
  });

  it('derives destination waiting allocation, activation, and residual timing', () => {
    expect(
      summarizePassengerDestinationWaitingBreakdown(
        100,
        [20],
        [70],
        { destinationAssignedPassengers: 4 },
        { inputWaitingCohorts: 2, resultingWaitingCohorts: 3 },
        10,
      ),
    ).toEqual({
      destinationAllocation: {
        invocations: 1,
        totalMs: 20,
        msPerTick: 2,
        meanMsPerInvocation: 20,
        shareOfDestinationWaitingTime: 20,
        work: { destinationAssignedPassengers: 4 },
      },
      waitingActivation: {
        invocations: 1,
        totalMs: 70,
        msPerTick: 7,
        meanMsPerInvocation: 70,
        shareOfDestinationWaitingTime: 70,
        work: { inputWaitingCohorts: 2, resultingWaitingCohorts: 3 },
      },
      residual: {
        totalMs: 10,
        msPerTick: 1,
        shareOfDestinationWaitingTime: 10,
      },
    });
    expect(
      summarizePassengerDestinationWaitingBreakdown(0, [], [], {}, {}, 1),
    ).toEqual({
      destinationAllocation: {
        invocations: 0,
        totalMs: 0,
        msPerTick: 0,
        meanMsPerInvocation: 0,
        shareOfDestinationWaitingTime: 0,
        work: {},
      },
      waitingActivation: {
        invocations: 0,
        totalMs: 0,
        msPerTick: 0,
        meanMsPerInvocation: 0,
        shareOfDestinationWaitingTime: 0,
        work: {},
      },
      residual: {
        totalMs: 0,
        msPerTick: 0,
        shareOfDestinationWaitingTime: 0,
      },
    });
  });

  it('summarizes the four waiting activation children independently', () => {
    expect(
      summarizePassengerWaitingActivationBreakdown(
        100,
        {
          planPreparation: [70],
          existingAuthorityPreparation: [20],
          newAssignmentActivation: [5],
          orderingFinalization: [5],
        },
        {
          planPreparation: { demandPlanCells: 10 },
          existingAuthorityPreparation: { inputWaitingCohorts: 3 },
          newAssignmentActivation: {
            destinationAssignedGroups: 2,
            destinationAssignedPassengers: 4,
          },
          orderingFinalization: { resultingWaitingCohorts: 4 },
        },
        10,
      ),
    ).toMatchObject({
      planPreparation: { totalMs: 70, shareOfWaitingActivationTime: 70 },
      existingAuthorityPreparation: {
        totalMs: 20,
        shareOfWaitingActivationTime: 20,
      },
      newAssignmentActivation: {
        totalMs: 5,
        shareOfWaitingActivationTime: 5,
      },
      orderingFinalization: {
        totalMs: 5,
        shareOfWaitingActivationTime: 5,
      },
      unattributed: {
        totalMs: 0,
        msPerTick: 0,
        shareOfWaitingActivationTime: 0,
      },
    });
    expect(
      summarizePassengerWaitingActivationBreakdown(
        0,
        {
          planPreparation: [],
          existingAuthorityPreparation: [],
          newAssignmentActivation: [],
          orderingFinalization: [],
        },
        {
          planPreparation: {},
          existingAuthorityPreparation: {},
          newAssignmentActivation: {},
          orderingFinalization: {},
        },
        1,
      ),
    ).toMatchObject({
      planPreparation: { totalMs: 0, shareOfWaitingActivationTime: 0 },
      existingAuthorityPreparation: {
        totalMs: 0,
        shareOfWaitingActivationTime: 0,
      },
      newAssignmentActivation: {
        totalMs: 0,
        shareOfWaitingActivationTime: 0,
      },
      orderingFinalization: {
        totalMs: 0,
        shareOfWaitingActivationTime: 0,
      },
      unattributed: { totalMs: 0, shareOfWaitingActivationTime: 0 },
    });
  });

  it('compares scheduled emission windows with the same-process legacy reducer', async () => {
    let clock = 0;
    const result = await runPassengerEmissionRuntimeBenchmark(
      'torrevieja-legacy-abc-v1',
      { warmup: 1, ticks: 2 },
      () => clock++,
    );
    expect(result).toMatchObject({
      scenarioId: 'torrevieja-legacy-abc-v1',
      warmupTicks: 1,
      measuredTicks: 2,
      demandPlanCells: expect.any(Number),
      legacy: { elapsedMilliseconds: 1, millisecondsPerTick: 0.5 },
      scheduled: [
        { workWindowTicks: 1, millisecondsPerTick: 0.5, speedup: 1 },
        { workWindowTicks: 4, millisecondsPerTick: 0.5, speedup: 1 },
        { workWindowTicks: 8, millisecondsPerTick: 0.5, speedup: 1 },
        { workWindowTicks: 12, millisecondsPerTick: 0.5, speedup: 1 },
      ],
    });
  }, 30_000);
});
