import { expect, it } from 'vitest';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import { createFoundationApplicationController } from '../application/foundation-controller.js';
import { createInMemoryFoundationSaveRepository } from '../persistence/save-repository.js';
import { createDirectFoundationClient } from '../simulation-host/direct-client.js';
import { createFoundationPacingController } from './foundation-pacing-controller.js';

it('serializes whole-tick commands, commits bonus, resets sessions, and exposes readonly state', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  await app.startNew({
    gameId: parseGameId('pace-game'),
    timelineId: parseTimelineId('pace-one'),
    initialSimulationTick: 0,
  });
  const pacing = createFoundationPacingController({ application: app });
  expect('setState' in pacing.projection).toBe(false);
  await pacing.setMode('normal');
  await pacing.advanceByElapsedMicroseconds(1_000_000);
  expect(app.projection.getState().authoritative?.simulationTick).toBe(4);
  await pacing.grantDoubleSpeedBonus(2);
  await pacing.advanceByElapsedMicroseconds(1_000_000);
  expect(pacing.projection.getState()).toMatchObject({
    remainingDoubleSpeedBonusTicks: 0,
    advancedTicksTotal: 9,
  });
  await app.save({ saveId: 'pace-save', createdAtUtcMs: 1, updatedAtUtcMs: 1 });
  await app.restore({
    saveId: 'pace-save',
    newTimelineId: parseTimelineId('pace-two'),
  });
  expect(pacing.projection.getState()).toMatchObject({
    mode: 'paused',
    creditGameMicroseconds: 0,
    remainingDoubleSpeedBonusTicks: 0,
  });
  await pacing.close();
  await app.close();
});

it('does not advance while paused and closes terminally', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  const pacing = createFoundationPacingController({ application: app });
  await pacing.advanceByElapsedMicroseconds(1_000_000);
  expect(pacing.projection.getState().advancedTicksTotal).toBe(0);
  await expect(pacing.grantDoubleSpeedBonus(0)).rejects.toThrow();
  await app.startNew({
    gameId: parseGameId('pace-second'),
    timelineId: parseTimelineId('pace-second-timeline'),
    initialSimulationTick: 0,
  });
  await pacing.setMode('fast');
  await pacing.advanceByElapsedMicroseconds(100);
  expect(pacing.projection.getState().creditGameMicroseconds).toBe(5_000);
  await pacing.setMode('maximum');
  expect(pacing.projection.getState().selectedRate).toBe(60);
  await pacing.resetForCurrentSession();
  expect(pacing.projection.getState().mode).toBe('paused');
  const firstClose = pacing.close();
  expect(pacing.close()).toBe(firstClose);
  await firstClose;
  await expect(pacing.setMode('normal')).rejects.toThrow('closed');
  await app.close();
});

it('normalizes current failures without committing plans', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  await app.startNew({
    gameId: parseGameId('failure-game'),
    timelineId: parseTimelineId('failure-time'),
    initialSimulationTick: 0,
  });
  const rejected = Object.freeze({
    ...app,
    sendCommand: async () => {
      throw new Error('send failed');
    },
  });
  const pacing = createFoundationPacingController({ application: rejected });
  await pacing.setMode('normal');
  await pacing.advanceByElapsedMicroseconds(1_000_000);
  expect(pacing.projection.getState()).toMatchObject({
    status: 'failed',
    mode: 'paused',
    effectiveRate: 0,
    advancedTicksTotal: 0,
    creditGameMicroseconds: 0,
    message: 'send failed',
  });
  await pacing.resetForCurrentSession();
  await pacing.setMode('normal');
  await pacing.advanceByElapsedMicroseconds(-1);
  expect(pacing.projection.getState().status).toBe('failed');
  await pacing.setMode('normal');
  expect(pacing.projection.getState()).toMatchObject({
    status: 'running',
    message: undefined,
  });
  await pacing.close();
  await app.close();
});

it('does not reuse pacing IDs after a same-timeline reset', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  await app.startNew({
    gameId: parseGameId('ids-game'),
    timelineId: parseTimelineId('ids-time'),
    initialSimulationTick: 0,
  });
  const ids: string[] = [];
  const wrapped = Object.freeze({
    ...app,
    sendCommand: (command: Parameters<typeof app.sendCommand>[0]) => {
      ids.push(command.commandId);
      return app.sendCommand(command);
    },
  });
  const pacing = createFoundationPacingController({ application: wrapped });
  await pacing.setMode('normal');
  await pacing.advanceByElapsedMicroseconds(1_000_000);
  await pacing.resetForCurrentSession();
  await pacing.setMode('normal');
  await pacing.advanceByElapsedMicroseconds(1_000_000);
  expect(ids).toEqual(['pacing-1', 'pacing-2']);
  expect(app.projection.getState().authoritative?.simulationTick).toBe(8);
  await pacing.close();
  await app.close();
});
