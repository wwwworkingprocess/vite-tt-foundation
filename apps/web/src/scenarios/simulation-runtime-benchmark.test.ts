import { describe, expect, it } from 'vitest';
import {
  parseSimulationRuntimeBenchmarkArguments,
  runSimulationRuntimeBenchmark,
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
  }, 30_000);

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
