import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import { parseTransportSaveRecord } from './transport-save-record.js';
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportApplicationController } from './transport-controller.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
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
const record = () => {
  const canonical = scenario();
  return parseTransportSaveRecord({
    kind: 'transport-save-record',
    schemaVersion: 1,
    saveId: 'slot',
    gameId: 'game-fixture',
    sourceTimelineId: 'timeline-source',
    sourceCommandRevision: 2,
    sourceSimulationTick: 120,
    sourceStreamOffset: 2,
    createdAtUtcMs: 1,
    updatedAtUtcMs: 2,
    scenario: createScenarioCoordinate(canonical),
    snapshot: createTransportSimulationSnapshot(
      createTransportSimulationState(canonical, 120),
    ),
  });
};

describe('transport application controller', () => {
  it('closes an idle controller and notifies a healthy projection listener', async () => {
    const listener = vi.fn();
    const controller = createTransportApplicationController({
      createClient: createDirectTransportSimulationClient,
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const remove = controller.projection.subscribe(listener);
    await controller.close();
    expect(listener).toHaveBeenCalledWith({ status: 'closed' });
    remove();
  });

  it('cleans up a client whose readiness becomes stale and normalizes non-Error startup failure', async () => {
    const base = createDirectTransportSimulationClient();
    let releaseExport!: () => void;
    const exportGate = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    const delayed = Object.freeze({
      ...base,
      async exportSnapshot() {
        await exportGate;
        return base.exportSnapshot();
      },
    });
    const controller = createTransportApplicationController({
      createClient: () => delayed,
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const starting = controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-delayed'),
      scenario: scenario(),
    });
    await Promise.resolve();
    await controller.close();
    releaseExport();
    await starting;
    expect(controller.projection.getState()).toEqual({ status: 'closed' });

    const failingBase = createDirectTransportSimulationClient();
    const failing = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...failingBase,
          connect: async () => Promise.reject('startup failed'),
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      failing.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('timeline-failed'),
        scenario: scenario(),
      }),
    ).rejects.toBe('startup failed');
    expect(failing.projection.getState()).toEqual({
      status: 'failed',
      message: 'Transport operation failed.',
    });
    await failing.close();
  });

  it('resolves the exact scenario before closing the current client', async () => {
    const events: string[] = [];
    let resolveScenario!: (value: ReturnType<typeof scenario>) => void;
    const first = createDirectTransportSimulationClient();
    const second = createDirectTransportSimulationClient();
    const clients = [
      Object.freeze({
        ...first,
        async close() {
          events.push('close-old');
          await first.close();
        },
      }),
      second,
    ];
    const controller = createTransportApplicationController({
      createClient: () => clients.shift()!,
      repository: { get: async () => record(), put: async () => undefined },
      scenarioResolver: {
        resolve: () =>
          new Promise((resolve) => {
            events.push('resolve-start');
            resolveScenario = resolve;
          }),
      },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    const restoring = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('timeline-restored'),
    });
    await Promise.resolve();
    expect(events).toEqual(['resolve-start']);
    resolveScenario(scenario());
    await restoring;
    expect(events).toEqual(['resolve-start', 'close-old']);
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-restored',
      scenario: { scenarioId: 'torrevieja-mini-v1' },
      simulationTick: 120,
    });
    await controller.close();
  });

  it('keeps the current ready session when resolution fails', async () => {
    const base = createDirectTransportSimulationClient();
    const close = vi.fn(() => base.close());
    const client = Object.freeze({ ...base, close });
    const controller = createTransportApplicationController({
      createClient: () => client,
      repository: { get: async () => record(), put: async () => undefined },
      scenarioResolver: {
        resolve: async () => Promise.reject(new Error('missing scenario')),
      },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('missing scenario');
    expect(close).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
      message: 'missing scenario',
    });
    await controller.close();
  });

  it('saves the queued authoritative export and rejects legacy restore before teardown', async () => {
    const stored: unknown[] = [];
    const base = createDirectTransportSimulationClient();
    const close = vi.fn(() => base.close());
    const controller = createTransportApplicationController({
      createClient: () => Object.freeze({ ...base, close }),
      repository: {
        get: async () => ({
          kind: 'foundation-save-record',
          schemaVersion: 1,
          saveId: 'legacy',
          gameId: 'game-fixture',
          sourceTimelineId: 'old',
          sourceCommandRevision: 0,
          sourceSimulationTick: 0,
          sourceStreamOffset: 0,
          createdAtUtcMs: 1,
          updatedAtUtcMs: 1,
          snapshot: {
            kind: 'foundation-simulation-snapshot',
            schemaVersion: 1,
            simulationVersion: 'foundation-1',
            state: { tick: 0 },
          },
        }),
        put: async (value) => {
          stored.push(value);
        },
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    await controller.advanceTicks(2);
    expect(controller.projection.getState()).toMatchObject({
      simulationTick: 2,
      commandRevision: 1,
      streamOffset: 1,
    });
    await controller.save({
      saveId: 'slot',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 2,
    });
    expect(stored[0]).toMatchObject({
      kind: 'transport-save-record',
      scenario: { scenarioId: 'torrevieja-mini-v1' },
      snapshot: { state: { tick: 2 } },
    });
    await expect(
      controller.restore({
        saveId: 'legacy',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('incompatible');
    expect(close).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      message: expect.stringContaining('incompatible'),
    });
    const listener = vi.fn();
    const remove = controller.projection.subscribe(listener);
    remove();
    remove();
    const firstClose = controller.close();
    expect(controller.close()).toBe(firstClose);
    await firstClose;
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('keeps missing and malformed restore failures recoverable and enforces terminal guards', async () => {
    const client = createDirectTransportSimulationClient();
    const raws: unknown[] = [
      undefined,
      { kind: 'transport-save-record', schemaVersion: 1 },
    ];
    const controller = createTransportApplicationController({
      createClient: () => client,
      repository: {
        get: async () => raws.shift(),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    controller.projection.subscribe(() => {
      throw new Error('projection listener');
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
      initialSimulationTick: 5,
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('another'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      controller.restore({
        saveId: 'missing',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('not found');
    await expect(
      controller.restore({
        saveId: 'malformed',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('Malformed known');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
    });
    await controller.close();
    await expect(
      controller.save({ saveId: 'x', createdAtUtcMs: 1, updatedAtUtcMs: 1 }),
    ).rejects.toThrow('No ready');
    await expect(
      controller.restore({
        saveId: 'x',
        timelineId: parseTimelineId('late'),
      }),
    ).rejects.toThrow('No ready');
  });
});
