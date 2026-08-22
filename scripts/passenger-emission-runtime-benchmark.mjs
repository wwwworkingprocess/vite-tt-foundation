import { performance } from 'node:perf_hooks';
import {
  advancePassengerEmissionScheduler,
  createPassengerEmissionScheduler,
  createTransportSimulationState,
  materializePassengerCellCredits,
} from '../packages/simulation/dist/index.js';
import {
  advanceTrustedPassengerDemandToTick,
  advanceTrustedPassengerDemandToTickWithScheduledEmissions,
} from '../packages/simulation/dist/passenger-demand.js';
import { prepareBenchmarkScenario } from './scenario-benchmark-support.mjs';

export const passengerEmissionBenchmarkScenarios = Object.freeze([
  'torrevieja-legacy-abc-v1',
  'cartagena-radial-legacy-all-v1',
  'malaga-day-legacy-all-v1',
]);
const benchmarkWindows = Object.freeze([1, 4, 8, 12]);

const measure = (advance, initial, warmup, ticks, now) => {
  let authority = initial;
  for (let tick = 0; tick < warmup; tick += 1) authority = advance(authority);
  const start = now();
  for (let tick = 0; tick < ticks; tick += 1) authority = advance(authority);
  const elapsedMilliseconds = now() - start;
  return Object.freeze({
    authority,
    elapsedMilliseconds,
    millisecondsPerTick: elapsedMilliseconds / ticks,
  });
};

export async function runPassengerEmissionRuntimeBenchmark(
  scenarioId,
  { warmup = 200, ticks = 100 } = {},
  now = () => performance.now(),
) {
  const { scenario, demandPlan } = await prepareBenchmarkScenario(scenarioId);
  const simulation = createTransportSimulationState(scenario, 0, demandPlan, {
    passengerEmissionWorkWindowTicks: 1,
  });
  const initial = simulation.passengerDemand;
  const itineraryIndex = simulation.passengerDirectItineraryIndex;
  if (initial.status !== 'active' || itineraryIndex === null)
    throw new Error('Passenger emission benchmark requires active demand.');
  const legacy = measure(
    (state) =>
      advanceTrustedPassengerDemandToTick(
        demandPlan,
        itineraryIndex,
        state,
        state.processedThroughTick + 1,
      ),
    initial,
    warmup,
    ticks,
    now,
  );
  const scheduled = [];
  for (const workWindowTicks of benchmarkWindows) {
    const seed = Object.freeze({
      state: initial,
      scheduler: createPassengerEmissionScheduler(
        demandPlan,
        initial,
        workWindowTicks,
      ),
    });
    const measured = measure(
      ({ state, scheduler }) => {
        const tick = state.processedThroughTick + 1;
        const emission = advancePassengerEmissionScheduler(
          demandPlan,
          scheduler,
          tick,
        );
        return Object.freeze({
          scheduler: emission.scheduler,
          state: advanceTrustedPassengerDemandToTickWithScheduledEmissions(
            demandPlan,
            itineraryIndex,
            state,
            tick,
            emission.emissions,
            () =>
              materializePassengerCellCredits(
                demandPlan,
                emission.scheduler,
                tick,
              ),
          ),
        });
      },
      seed,
      warmup,
      ticks,
      now,
    );
    if (
      JSON.stringify(measured.authority.state) !==
      JSON.stringify(legacy.authority)
    )
      throw new Error(
        `${scenarioId} work window ${workWindowTicks} differs from legacy authority.`,
      );
    scheduled.push(
      Object.freeze({
        workWindowTicks,
        elapsedMilliseconds: measured.elapsedMilliseconds,
        millisecondsPerTick: measured.millisecondsPerTick,
        speedup: legacy.millisecondsPerTick / measured.millisecondsPerTick,
      }),
    );
  }
  return Object.freeze({
    scenarioId,
    warmupTicks: warmup,
    measuredTicks: ticks,
    demandPlanCells: demandPlan.cells.length,
    legacy: Object.freeze({
      elapsedMilliseconds: legacy.elapsedMilliseconds,
      millisecondsPerTick: legacy.millisecondsPerTick,
    }),
    scheduled: Object.freeze(scheduled),
  });
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href
) {
  for (const scenarioId of passengerEmissionBenchmarkScenarios)
    console.log(
      JSON.stringify(
        await runPassengerEmissionRuntimeBenchmark(scenarioId),
        null,
        2,
      ),
    );
}
