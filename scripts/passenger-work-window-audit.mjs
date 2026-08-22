import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  advanceTransportTicksWithEvents,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from '../packages/simulation/dist/index.js';
import { prepareBenchmarkScenario } from './scenario-benchmark-support.mjs';

export const passengerWorkWindowAuditScenarios = Object.freeze([
  'torrevieja-legacy-abc-v1',
  'cartagena-radial-legacy-all-v1',
  'malaga-day-legacy-all-v1',
]);
export const passengerWorkWindowAuditCheckpoints = Object.freeze([
  1, 2, 3, 5, 7, 11, 12, 13, 17, 23, 24, 25, 37, 59, 60, 61, 119, 120, 121,
]);
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evaluatedCells = (cellCount, scheduler, tick) => {
  let total = Math.floor(tick / scheduler.workWindowTicks) * cellCount;
  for (let shard = 0; shard < tick % scheduler.workWindowTicks; shard += 1)
    total += Math.ceil((cellCount - shard) / scheduler.workWindowTicks);
  return total;
};

async function auditScenario(scenarioId, now) {
  const { scenario, demandPlan } = await prepareBenchmarkScenario(scenarioId);
  let reference;
  const windows = [];
  for (let workWindowTicks = 1; workWindowTicks <= 12; workWindowTicks += 1) {
    let state = createTransportSimulationState(scenario, 0, demandPlan, {
      passengerEmissionWorkWindowTicks: workWindowTicks,
    });
    const snapshots = [];
    const transcript = [];
    let scheduledEmissionRecordHighWatermark = 0;
    const start = now();
    for (const checkpoint of passengerWorkWindowAuditCheckpoints) {
      while (state.tick < checkpoint) {
        const advanced = advanceTransportTicksWithEvents(state, 1);
        state = advanced.state;
        transcript.push(...advanced.passengerOriginStopArrivalEvents);
        scheduledEmissionRecordHighWatermark = Math.max(
          scheduledEmissionRecordHighWatermark,
          state.passengerEmissionScheduler.buckets.reduce(
            (total, bucket) => total + bucket[1].length,
            0,
          ),
        );
      }
      snapshots.push(digest(createTransportSimulationSnapshot(state)));
    }
    const elapsedMilliseconds = now() - start;
    const authority = { snapshots, transcriptSha256: digest(transcript) };
    if (reference === undefined) reference = authority;
    else {
      for (let index = 0; index < snapshots.length; index += 1)
        if (snapshots[index] !== reference.snapshots[index])
          throw new Error(
            `${scenarioId} work window ${workWindowTicks} differs at tick ${passengerWorkWindowAuditCheckpoints[index]}: ${reference.snapshots[index]} != ${snapshots[index]}`,
          );
      if (authority.transcriptSha256 !== reference.transcriptSha256)
        throw new Error(
          `${scenarioId} work window ${workWindowTicks} arrival transcript differs.`,
        );
    }
    const scheduler = state.passengerEmissionScheduler;
    windows.push(
      Object.freeze({
        workWindowTicks,
        elapsedMilliseconds,
        millisecondsPerTick: elapsedMilliseconds / state.tick,
        ticksPerSecond:
          elapsedMilliseconds === 0
            ? null
            : (state.tick * 1000) / elapsedMilliseconds,
        demandPlanCells: demandPlan.cells.length,
        bootstrapEvaluatedCells: demandPlan.cells.length,
        averageEvaluatedCellsPerTick:
          evaluatedCells(demandPlan.cells.length, scheduler, state.tick) /
          state.tick,
        maximumEvaluatedCellsPerTick: Math.ceil(
          demandPlan.cells.length / scheduler.workWindowTicks,
        ),
        scheduledEmissionRecordHighWatermark,
        finalSnapshotSha256: snapshots.at(-1),
        transcriptSha256: authority.transcriptSha256,
      }),
    );
  }
  return Object.freeze({ scenarioId, windows: Object.freeze(windows) });
}

export async function runPassengerWorkWindowAudit(
  now = () => performance.now(),
) {
  const results = [];
  for (const scenarioId of passengerWorkWindowAuditScenarios)
    results.push(await auditScenario(scenarioId, now));
  return Object.freeze(results);
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href
) {
  try {
    const results = await runPassengerWorkWindowAudit();
    for (const result of results) {
      console.log(`\n${result.scenarioId}`);
      console.table(result.windows);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
