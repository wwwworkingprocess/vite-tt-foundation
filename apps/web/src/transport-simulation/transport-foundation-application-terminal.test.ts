import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportFoundationApplication } from './transport-foundation-application.js';
import type { TransportSaveRepository } from './transport-save-repository.js';
import { createInMemoryTransportSaveRepository } from './transport-save-repository.js';

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
const canonicalScenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });

describe('terminal transport foundation application', () => {
  it('rejects every action after close without dependencies or projection updates', async () => {
    const createClient = vi.fn(createDirectTransportSimulationClient);
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const repository: TransportSaveRepository = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
      close: vi.fn(() => closeGate),
    };
    const application = createTransportFoundationApplication({
      scenario: canonicalScenario(),
      repository,
      createClient,
      scenarioResolver: { resolve: async () => canonicalScenario() },
    });
    await application.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
    });
    const listener = vi.fn();
    const remove = application.projection.subscribe(listener);
    const firstClose = application.close();
    expect(application.close()).toBe(firstClose);
    const counts = {
      create: createClient.mock.calls.length,
      get: vi.mocked(repository.get).mock.calls.length,
      put: vi.mocked(repository.put).mock.calls.length,
      list: vi.mocked(repository.list).mock.calls.length,
    };

    await expect(
      application.startNew({
        gameId: parseGameId('new-game'),
        timelineId: parseTimelineId('new-timeline'),
        initialSimulationTick: 0,
      }),
    ).rejects.toThrow('closed');
    await expect(application.sendCommand({} as never)).rejects.toThrow(
      'closed',
    );
    await expect(
      application.save({
        saveId: 'slot',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      }),
    ).rejects.toThrow('closed');
    await expect(
      application.restore({
        saveId: 'slot',
        newTimelineId: parseTimelineId('restore'),
      }),
    ).rejects.toThrow('closed');
    await expect(application.listSaves()).rejects.toThrow('closed');

    expect(createClient).toHaveBeenCalledTimes(counts.create);
    expect(repository.get).toHaveBeenCalledTimes(counts.get);
    expect(repository.put).toHaveBeenCalledTimes(counts.put);
    expect(repository.list).toHaveBeenCalledTimes(counts.list);
    expect(listener).not.toHaveBeenCalled();
    releaseClose();
    await firstClose;
    expect(listener).toHaveBeenCalledOnce();
    listener.mockClear();
    const closedState = application.projection.getState();
    expect(application.projection.getState()).toBe(closedState);
    expect(closedState).toEqual({
      session: { status: 'closed' },
      synchronization: { status: 'idle' },
      persistence: expect.any(Object),
    });
    remove();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a pending list %s after terminal close',
    async (completion) => {
      let resolveList!: (value: readonly never[]) => void;
      let rejectList!: (reason: unknown) => void;
      const repository: TransportSaveRepository = {
        get: async () => undefined,
        put: async () => undefined,
        list: () =>
          new Promise((resolve, reject) => {
            resolveList = resolve;
            rejectList = reject;
          }),
        delete: async () => undefined,
        close: async () => undefined,
      };
      const application = createTransportFoundationApplication({
        scenario: canonicalScenario(),
        repository,
        createClient: createDirectTransportSimulationClient,
        scenarioResolver: { resolve: async () => canonicalScenario() },
      });
      const pending = application.listSaves();
      await application.close();
      const closedState = application.projection.getState();
      const listener = vi.fn();
      const remove = application.projection.subscribe(listener);
      if (completion === 'resolve') resolveList([]);
      else rejectList(new Error('late list failed'));
      if (completion === 'resolve') await expect(pending).resolves.toEqual([]);
      else await expect(pending).rejects.toThrow('late list failed');
      expect(application.projection.getState()).toBe(closedState);
      expect(listener).not.toHaveBeenCalled();
      remove();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'normalizes terminal persistence when a pending save %s',
    async (completion) => {
      const backing = createInMemoryTransportSaveRepository();
      let releasePut!: () => void;
      let enteredPut!: () => void;
      const putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      const putEntered = new Promise<void>((resolve) => {
        enteredPut = resolve;
      });
      let delayPut = false;
      const repository: TransportSaveRepository = Object.freeze({
        ...backing,
        async put(record: Parameters<typeof backing.put>[0]) {
          if (delayPut) {
            enteredPut();
            await putGate;
            if (completion === 'reject') throw new Error('late save failed');
          }
          await backing.put(record);
        },
      });
      const application = createTransportFoundationApplication({
        scenario: canonicalScenario(),
        repository,
        createClient: createDirectTransportSimulationClient,
        scenarioResolver: { resolve: async () => canonicalScenario() },
      });
      await application.startNew({
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 4,
      });
      delayPut = true;
      const saving = application.save({
        saveId: 'slot',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      });
      await putEntered;
      const closing = application.close();
      releasePut();
      if (completion === 'resolve')
        await expect(saving).rejects.toThrow('closed');
      else await expect(saving).rejects.toThrow('late save failed');
      await closing;
      expect(application.projection.getState()).toEqual({
        session: { status: 'closed' },
        synchronization: { status: 'idle' },
        persistence: { status: 'idle', saves: [] },
      });
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'normalizes terminal persistence when a pending restore %s',
    async (completion) => {
      const repository = createInMemoryTransportSaveRepository();
      let resolveScenario!: (
        value: ReturnType<typeof canonicalScenario>,
      ) => void;
      let rejectScenario!: (reason: unknown) => void;
      let delayResolution = false;
      const application = createTransportFoundationApplication({
        scenario: canonicalScenario(),
        repository,
        createClient: createDirectTransportSimulationClient,
        scenarioResolver: {
          resolve: () =>
            delayResolution
              ? new Promise((resolve, reject) => {
                  resolveScenario = resolve;
                  rejectScenario = reject;
                })
              : Promise.resolve(canonicalScenario()),
        },
      });
      await application.startNew({
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 4,
      });
      await application.save({
        saveId: 'slot',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      });
      delayResolution = true;
      const restoring = application.restore({
        saveId: 'slot',
        newTimelineId: parseTimelineId('restored'),
      });
      await vi.waitFor(() => expect(resolveScenario).toBeTypeOf('function'));
      const closing = application.close();
      if (completion === 'resolve') resolveScenario(canonicalScenario());
      else rejectScenario(new Error('late restore failed'));
      await expect(restoring).rejects.toThrow(
        completion === 'resolve' ? 'stale' : 'late restore failed',
      );
      await closing;
      expect(application.projection.getState()).toEqual({
        session: { status: 'closed' },
        synchronization: { status: 'idle' },
        persistence: {
          status: 'idle',
          saves: [expect.objectContaining({ saveId: 'slot' })],
        },
      });
    },
  );
});
