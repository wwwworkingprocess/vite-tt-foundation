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
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportApplicationController } from './transport-controller.js';
import {
  classifyPersistedSaveRecord,
  parseTransportSaveRecord,
} from './transport-save-record.js';

const fixture = join(
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
  JSON.parse(readFileSync(join(fixture, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
const start = (
  controller: ReturnType<typeof createTransportApplicationController>,
  timelineId: string,
) =>
  controller.startNew({
    gameId: parseGameId('game-fixture'),
    timelineId: parseTimelineId(timelineId),
    scenario: scenario(),
  });
const currentSave = () => {
  const canonical = scenario();
  return classifyPersistedSaveRecord(
    parseTransportSaveRecord({
      kind: 'transport-save-record',
      schemaVersion: 6,
      saveId: 'slot',
      gameId: 'game-fixture',
      sourceTimelineId: 'source',
      sourceCommandRevision: 0,
      sourceSimulationTick: 0,
      sourceStreamOffset: 0,
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
      scenario: createScenarioCoordinate(canonical),
      snapshot: createTransportSimulationSnapshot(
        createTransportSimulationState(canonical, 0),
      ),
    }),
  );
};

describe('transport controller subscription correction', () => {
  it('fails transactionally when reliable registration throws and permits retry', async () => {
    const failed = createDirectTransportSimulationClient();
    const connect = vi.fn(failed.connect);
    const render = vi.fn(failed.subscribeRenderSnapshots);
    const close = vi.fn(() => failed.close());
    let creation = 0;
    const controller = createTransportApplicationController({
      createClient: () =>
        ++creation === 1
          ? Object.freeze({
              ...failed,
              connect,
              subscribeReliableUpdates: () => {
                throw new Error('reliable registration failed');
              },
              subscribeRenderSnapshots: render,
              close,
            })
          : createDirectTransportSimulationClient(),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });

    await expect(start(controller, 'failed')).rejects.toThrow(
      'reliable registration failed',
    );
    expect(connect).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'reliable registration failed',
    });
    await expect(start(controller, 'retry')).resolves.toBeUndefined();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'retry',
    });
    await controller.close();
  });

  it('removes a partial registration, preserves the primary failure, and ignores its stale callback', async () => {
    const failed = createDirectTransportSimulationClient();
    const unsubscribe = vi.fn(() => {
      throw new Error('reliable cleanup failed');
    });
    const close = vi.fn(async () => {
      await failed.close();
      throw new Error('candidate close failed');
    });
    let retained!: Parameters<typeof failed.subscribeReliableUpdates>[0];
    let creation = 0;
    const controller = createTransportApplicationController({
      createClient: () =>
        ++creation === 1
          ? Object.freeze({
              ...failed,
              subscribeReliableUpdates(listener: typeof retained) {
                retained = listener;
                return unsubscribe;
              },
              subscribeRenderSnapshots: () => {
                throw new Error('render registration failed');
              },
              close,
            })
          : createDirectTransportSimulationClient(),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });

    const failure = await start(controller, 'failed').catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'render registration failed' }),
      expect.objectContaining({ message: 'reliable cleanup failed' }),
      expect.objectContaining({ message: 'candidate close failed' }),
    ]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'render registration failed',
    });
    await start(controller, 'retry');
    const ready = controller.projection.getState();
    retained({
      simulationTick: 999,
      commandRevision: 999,
      streamOffset: 999,
    } as never);
    expect(controller.projection.getState()).toBe(ready);
    await controller.close();
  });

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    'attempts every unsubscribe when failures are %s/%s',
    async (failReliable, failRender) => {
      const base = createDirectTransportSimulationClient();
      const reliableCleanup = vi.fn(() => {
        if (failReliable) throw new Error('reliable cleanup failed');
      });
      const renderCleanup = vi.fn(() => {
        if (failRender) throw new Error('render cleanup failed');
      });
      const controller = createTransportApplicationController({
        createClient: () =>
          Object.freeze({
            ...base,
            subscribeReliableUpdates: () => reliableCleanup,
            subscribeRenderSnapshots: () => renderCleanup,
          }),
        repository: { get: async () => undefined, put: async () => undefined },
        scenarioResolver: { resolve: async () => scenario() },
      });
      await start(controller, 'cleanup');
      if (failReliable || failRender)
        await expect(controller.close()).rejects.toBeInstanceOf(AggregateError);
      else await controller.close();
      expect(reliableCleanup).toHaveBeenCalledOnce();
      expect(renderCleanup).toHaveBeenCalledOnce();
      expect(controller.projection.getState()).toEqual({ status: 'closed' });
    },
  );

  it('aggregates subscription, client, and repository close failures and closes synchronously safely', async () => {
    const base = createDirectTransportSimulationClient();
    const reliableCleanup = vi.fn(() => {
      throw new Error('reliable cleanup failed');
    });
    const renderCleanup = vi.fn(() => {
      throw new Error('render cleanup failed');
    });
    const clientClose = vi.fn(async () => {
      await base.close();
      throw new Error('client close failed');
    });
    const repositoryClose = vi.fn(async () => {
      throw new Error('repository close failed');
    });
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          subscribeReliableUpdates: () => reliableCleanup,
          subscribeRenderSnapshots: () => renderCleanup,
          close: clientClose,
        }),
      repository: {
        get: async () => undefined,
        put: async () => undefined,
        close: repositoryClose,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await start(controller, 'terminal');
    let first!: Promise<void>;
    expect(() => {
      first = controller.close();
    }).not.toThrow();
    expect(controller.close()).toBe(first);
    expect(() => controller.projection.subscribe(() => undefined)).toThrow(
      'closed',
    );
    const failure = await first.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(4);
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
    expect(reliableCleanup).toHaveBeenCalledOnce();
    expect(renderCleanup).toHaveBeenCalledOnce();
    expect(clientClose).toHaveBeenCalledOnce();
    expect(repositoryClose).toHaveBeenCalledOnce();
    expect(controller.close()).toBe(first);
  });

  it('exhausts failed restore teardown and releases the unusable session for recovery', async () => {
    const first = createDirectTransportSimulationClient();
    const reliableCleanup = vi.fn(() => {
      throw new Error('restore reliable cleanup failed');
    });
    const renderCleanup = vi.fn();
    const oldClose = vi.fn(() => first.close());
    let creation = 0;
    const controller = createTransportApplicationController({
      createClient: () =>
        ++creation === 1
          ? Object.freeze({
              ...first,
              subscribeReliableUpdates: () => reliableCleanup,
              subscribeRenderSnapshots: () => renderCleanup,
              close: oldClose,
            })
          : createDirectTransportSimulationClient(),
      repository: {
        get: async () => currentSave(),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await start(controller, 'current');
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('restored'),
      }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(reliableCleanup).toHaveBeenCalledOnce();
    expect(renderCleanup).toHaveBeenCalledOnce();
    expect(oldClose).toHaveBeenCalledOnce();
    expect(controller.projection.getState()).toMatchObject({
      status: 'failed',
    });
    await expect(start(controller, 'recovered')).resolves.toBeUndefined();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'recovered',
    });
    await controller.close();
  });
});
