import { expect, it } from 'vitest';
import {
  parseFoundationAppliedCommandResult,
  parseGameId,
  parseTimelineId,
  type FoundationCommandEnvelope,
  type FoundationCommandResult,
} from '@torrevieja-tycoon/protocol';
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

const deferredResult = () => {
  let resolve!: (value: FoundationCommandResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<FoundationCommandResult>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
};

it('derives pre-session rates from tick zero and rejects accumulated bonus overflow', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  const pacing = createFoundationPacingController({ application: app });

  await pacing.setMode('normal');
  expect(pacing.projection.getState()).toMatchObject({
    status: 'running',
    selectedRate: 20,
    effectiveRate: 20,
  });

  await pacing.grantDoubleSpeedBonus(Number.MAX_SAFE_INTEGER);
  expect(pacing.projection.getState()).toMatchObject({
    remainingDoubleSpeedBonusTicks: Number.MAX_SAFE_INTEGER,
    effectiveRate: 40,
  });
  await expect(pacing.grantDoubleSpeedBonus(1)).rejects.toThrow(
    'Bonus overflow.',
  );
  expect(pacing.projection.getState().remainingDoubleSpeedBonusTicks).toBe(
    Number.MAX_SAFE_INTEGER,
  );

  await pacing.close();
  await app.close();
});

it('fails pacing without committing a mismatched applied command result', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  await app.startNew({
    gameId: parseGameId('mismatch-game'),
    timelineId: parseTimelineId('mismatch-timeline'),
    initialSimulationTick: 0,
  });
  const wrapped = Object.freeze({
    ...app,
    sendCommand: async (command: FoundationCommandEnvelope) => {
      const result = await app.sendCommand(command);
      if (
        result.kind !== 'foundation-command-result' ||
        result.status !== 'applied'
      ) {
        return result;
      }
      return parseFoundationAppliedCommandResult({
        ...result,
        resultingSimulationTick: result.resultingSimulationTick + 1,
      });
    },
  });
  const pacing = createFoundationPacingController({ application: wrapped });

  await pacing.setMode('normal');
  await pacing.advanceByElapsedMicroseconds(1_000_000);

  expect(app.projection.getState().authoritative?.simulationTick).toBe(4);
  expect(pacing.projection.getState()).toMatchObject({
    status: 'failed',
    mode: 'paused',
    selectedRate: 0,
    effectiveRate: 0,
    advancedTicksTotal: 0,
    creditGameMicroseconds: 0,
    message: 'Pacing command did not apply as planned.',
  });

  await pacing.close();
  await app.close();
});

it('ignores a successful pacing result after the application generation changes', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  await app.startNew({
    gameId: parseGameId('stale-success-game'),
    timelineId: parseTimelineId('stale-success-timeline'),
    initialSimulationTick: 0,
  });
  const pending = deferredResult();
  let sent!: FoundationCommandEnvelope;
  let markSent!: () => void;
  const sentPromise = new Promise<void>((resolve) => {
    markSent = resolve;
  });
  const wrapped = Object.freeze({
    ...app,
    sendCommand: (command: FoundationCommandEnvelope) => {
      sent = command;
      markSent();
      return pending.promise;
    },
  });
  const pacing = createFoundationPacingController({ application: wrapped });

  await pacing.setMode('normal');
  const advancing = pacing.advanceByElapsedMicroseconds(1_000_000);
  await sentPromise;
  await app.close();
  pending.resolve(
    parseFoundationAppliedCommandResult({
      kind: 'foundation-command-result',
      gameId: sent.gameId,
      timelineId: sent.timelineId,
      commandId: sent.commandId,
      correlationId: sent.correlationId,
      status: 'applied',
      appliedAtTick: 0,
      resultingSimulationTick: 4,
      appliedCommandRevision: 1,
      duplicate: false,
    }),
  );
  await advancing;

  expect(pacing.projection.getState()).toMatchObject({
    status: 'paused',
    mode: 'paused',
    advancedTicksTotal: 0,
    creditGameMicroseconds: 0,
    message: undefined,
  });
  await pacing.close();
});

it('ignores a rejected pacing operation after the application generation changes', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  await app.startNew({
    gameId: parseGameId('stale-failure-game'),
    timelineId: parseTimelineId('stale-failure-timeline'),
    initialSimulationTick: 0,
  });
  const pending = deferredResult();
  let markSent!: () => void;
  const sentPromise = new Promise<void>((resolve) => {
    markSent = resolve;
  });
  const wrapped = Object.freeze({
    ...app,
    sendCommand: () => {
      markSent();
      return pending.promise;
    },
  });
  const pacing = createFoundationPacingController({ application: wrapped });

  await pacing.setMode('normal');
  const advancing = pacing.advanceByElapsedMicroseconds(1_000_000);
  await sentPromise;
  await app.close();
  pending.reject(new Error('late pacing failure'));
  await advancing;

  expect(pacing.projection.getState()).toMatchObject({
    status: 'paused',
    mode: 'paused',
    advancedTicksTotal: 0,
    creditGameMicroseconds: 0,
    message: undefined,
  });
  await pacing.close();
});

it('normalizes a non-Error pacing rejection while the session remains current', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  await app.startNew({
    gameId: parseGameId('non-error-pacing-game'),
    timelineId: parseTimelineId('non-error-pacing-timeline'),
    initialSimulationTick: 0,
  });
  const pacing = createFoundationPacingController({
    application: Object.freeze({
      ...app,
      sendCommand: async () => Promise.reject('non-error pacing failure'),
    }),
  });

  await pacing.setMode('normal');
  await pacing.advanceByElapsedMicroseconds(1_000_000);
  expect(pacing.projection.getState()).toMatchObject({
    status: 'failed',
    mode: 'paused',
    message: 'Pacing operation failed.',
    advancedTicksTotal: 0,
  });

  await pacing.close();
  await app.close();
});

it('resets deterministically when there is no ready current session', async () => {
  const app = createFoundationApplicationController({
    repository: createInMemoryFoundationSaveRepository(),
    clientFactory: createDirectFoundationClient,
  });
  const pacing = createFoundationPacingController({ application: app });

  await pacing.setMode('fast');
  expect(pacing.projection.getState()).toMatchObject({
    status: 'running',
    mode: 'fast',
  });
  await pacing.resetForCurrentSession();
  expect(pacing.projection.getState()).toMatchObject({
    status: 'paused',
    mode: 'paused',
    selectedRate: 0,
    effectiveRate: 0,
    creditGameMicroseconds: 0,
    remainingDoubleSpeedBonusTicks: 0,
  });

  await pacing.close();
  await app.close();
});
