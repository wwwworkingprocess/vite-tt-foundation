import { expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import { createFoundationPacingController } from '../pacing/foundation-pacing-controller.js';
import {
  createDexieFoundationSaveRepository,
  deleteFoundationSaveDatabase,
} from '../persistence/save-repository.js';
import { createWorkerFoundationClient } from '../simulation-worker/worker-client.js';
import { createStructuredCloneLoopbackWorker } from '../simulation-worker/worker-test-double.js';
import { createFoundationApplicationController } from './foundation-controller.js';

it('crosses Worker, pacing, Dexie save, close, and new-timeline restore boundaries', async () => {
  const database = 'foundation-lifecycle-acceptance';
  await deleteFoundationSaveDatabase(database);
  const clientFactory = () =>
    createWorkerFoundationClient({
      workerFactory: createStructuredCloneLoopbackWorker,
    });
  const first = createFoundationApplicationController({
    repository: createDexieFoundationSaveRepository(database),
    clientFactory,
  });
  await first.startNew({
    gameId: parseGameId('acceptance-game'),
    timelineId: parseTimelineId('acceptance-original'),
    initialSimulationTick: 0,
  });
  const firstPacing = createFoundationPacingController({ application: first });
  await firstPacing.setMode('normal');
  await firstPacing.advanceByElapsedMicroseconds(1_000_000);
  await firstPacing.setMode('paused');
  expect(first.projection.getState().authoritative?.simulationTick).toBe(4);
  await first.save({
    saveId: 'acceptance-save',
    createdAtUtcMs: 1,
    updatedAtUtcMs: 1,
  });
  await firstPacing.close();
  await first.close();

  const second = createFoundationApplicationController({
    repository: createDexieFoundationSaveRepository(database),
    clientFactory,
  });
  expect(await second.listSaves()).toHaveLength(1);
  await second.restore({
    saveId: 'acceptance-save',
    newTimelineId: parseTimelineId('acceptance-restored'),
  });
  expect(second.projection.getState()).toMatchObject({
    session: { status: 'ready', timelineId: 'acceptance-restored' },
    authoritative: { commandRevision: 0, streamOffset: 0, simulationTick: 4 },
  });
  const secondPacing = createFoundationPacingController({
    application: second,
  });
  expect(secondPacing.projection.getState()).toMatchObject({
    mode: 'paused',
    creditGameMicroseconds: 0,
    remainingDoubleSpeedBonusTicks: 0,
  });
  await secondPacing.setMode('normal');
  await secondPacing.advanceByElapsedMicroseconds(1_000_000);
  expect(second.projection.getState().authoritative?.simulationTick).toBe(8);
  await secondPacing.close();
  await second.close();
  await deleteFoundationSaveDatabase(database);
});
