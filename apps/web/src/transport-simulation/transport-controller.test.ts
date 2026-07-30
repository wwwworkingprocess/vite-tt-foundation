import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parsePassengerDemandPlan,
  type PassengerDemandPlanV1,
} from '@torrevieja-tycoon/simulation';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import {
  classifyPersistedSaveRecord,
  parseTransportSaveRecord,
} from './transport-save-record.js';
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportApplicationController } from './transport-controller.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
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
    schemaVersion: 4,
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
const demandPlan = () => {
  const canonical = scenario();
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'd'.repeat(64),
    scenario: createScenarioCoordinate(canonical),
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 1,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 1,
      totalPopulationWeight: 1,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 1,
    },
    accessPolicy: { accessTicksPerCell: 1 },
    cells: [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        populationWeight: 1,
        assignedStopPlaceId: 'tv-place-0053',
        distanceSquaredCells: 0,
      },
    ],
    stops: [{ stopPlaceId: 'tv-place-0053' }],
  });
};

describe('transport application controller', () => {
  it('rejects obsolete pre-release saves before replacing authority', async () => {
    const canonical = scenario();
    const value = record();
    const v1 = {
      ...value,
      schemaVersion: 1,
      snapshot: {
        kind: 'transport-simulation-snapshot',
        schemaVersion: 1,
        simulationVersion: 'transport-1',
        scenario: createScenarioCoordinate(canonical),
        state: { tick: value.sourceSimulationTick },
      },
    };
    const controller = createTransportApplicationController({
      createClient: () => createDirectTransportSimulationClient(),
      repository: {
        get: async () => classifyPersistedSaveRecord(v1),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('timeline-v1-restored'),
      }),
    ).rejects.toThrow('obsolete');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
    });
    await controller.close();
  });

  it('resolves the exact active demand plan before restore teardown', async () => {
    const canonical = scenario();
    const plan = demandPlan();
    const activeRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'active-demand',
      sourceSimulationTick: 2,
      snapshot: createTransportSimulationSnapshot(
        advanceTransportTicks(
          createTransportSimulationState(canonical, 0, plan),
          2,
        ),
      ),
    });
    let resolutionFails = true;
    const resolver = vi.fn(async () => {
      if (resolutionFails) throw new Error('demand plan unavailable');
      return plan;
    });
    const controller = createTransportApplicationController({
      createClient: () => createDirectTransportSimulationClient(),
      repository: {
        get: async () => classifyPersistedSaveRecord(activeRecord),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
      passengerDemandPlanResolver: { resolve: resolver },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
    });
    await expect(
      controller.restore({
        saveId: 'active-demand',
        timelineId: parseTimelineId('timeline-demand'),
      }),
    ).rejects.toThrow('demand plan unavailable');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
      passengerDemand: { status: 'disabled' },
    });
    resolutionFails = false;
    await controller.restore({
      saveId: 'active-demand',
      timelineId: parseTimelineId('timeline-demand'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-demand',
      passengerDemand: {
        status: 'active',
        processedThroughTick: 2,
        totalEmittedPassengerCount: 2,
      },
    });
    expect(resolver).toHaveBeenCalledTimes(2);
    await controller.close();
  });

  it('preflights resolved active plans before touching current authority', async () => {
    const canonical = scenario();
    const plan = demandPlan();
    const activeRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'active-demand-preflight',
      sourceSimulationTick: 2,
      snapshot: createTransportSimulationSnapshot(
        advanceTransportTicks(
          createTransportSimulationState(canonical, 0, plan),
          2,
        ),
      ),
    });
    const current = createDirectTransportSimulationClient();
    const currentClose = vi.fn(() => current.close());
    let clientCreations = 0;
    let resolved: unknown = plan;
    let storedRecord = activeRecord;
    const controller = createTransportApplicationController({
      createClient: () => {
        clientCreations += 1;
        return clientCreations === 1
          ? Object.freeze({ ...current, close: currentClose })
          : createDirectTransportSimulationClient();
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(storedRecord),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
      passengerDemandPlanResolver: {
        resolve: async () => resolved as PassengerDemandPlanV1,
      },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
      passengerDemandPlan: plan,
    });
    await controller.advanceTicks(1);
    const expected = controller.projection.getState();

    const wrongHash = structuredClone(plan);
    (wrongHash as { demandModelContentHash: string }).demandModelContentHash =
      'e'.repeat(64);
    resolved = wrongHash;
    await expect(
      controller.restore({
        saveId: 'active-demand-preflight',
        timelineId: parseTimelineId('timeline-wrong'),
      }),
    ).rejects.toThrow(/demand plan/i);
    expect(controller.projection.getState()).toEqual({
      ...expected,
      message: expect.stringMatching(/demand plan/i),
    });
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    resolved = {};
    await expect(
      controller.restore({
        saveId: 'active-demand-preflight',
        timelineId: parseTimelineId('timeline-malformed'),
      }),
    ).rejects.toThrow();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
      simulationTick: expected.simulationTick,
      fleet: expected.fleet,
      passengerDemand: expected.passengerDemand,
    });
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    resolved = plan;
    const backlog = structuredClone(activeRecord);
    if (backlog.snapshot.state.passengerDemand.status !== 'active')
      throw new Error('Expected active fixture.');
    const mutableDemand = backlog.snapshot.state.passengerDemand as unknown as {
      stopArrivals: Array<{ awaitingDestinationCount: number }>;
      totalArrivedAtStopPassengerCount: number;
      servedEmittedPassengerCount: number;
      totalEmittedPassengerCount: number;
    };
    mutableDemand.stopArrivals[0]!.awaitingDestinationCount = 1;
    mutableDemand.totalArrivedAtStopPassengerCount += 1;
    mutableDemand.servedEmittedPassengerCount += 1;
    mutableDemand.totalEmittedPassengerCount += 1;
    storedRecord = parseTransportSaveRecord(backlog);
    await expect(
      controller.restore({
        saveId: 'active-demand-preflight',
        timelineId: parseTimelineId('timeline-backlog'),
      }),
    ).rejects.toThrow(/destination backlog/i);
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
      simulationTick: expected.simulationTick,
    });
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    storedRecord = activeRecord;
    const inconsistent = structuredClone(plan);
    (
      inconsistent as { accessPolicy: { accessTicksPerCell: number } }
    ).accessPolicy.accessTicksPerCell = 2;
    resolved = inconsistent;
    await expect(
      controller.restore({
        saveId: 'active-demand-preflight',
        timelineId: parseTimelineId('timeline-inconsistent'),
      }),
    ).rejects.toThrow(/demand plan/i);
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    resolved = plan;
    await controller.restore({
      saveId: 'active-demand-preflight',
      timelineId: parseTimelineId('timeline-restored'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-restored',
      simulationTick: 2,
      passengerDemand: { status: 'active', processedThroughTick: 2 },
    });
    expect(currentClose).toHaveBeenCalledTimes(1);
    expect(clientCreations).toBe(2);
    await controller.close();
  });

  it('publishes failed and permits retry after synchronous initial construction failure', async () => {
    const reliable = vi.fn();
    const render = vi.fn();
    const close = vi.fn();
    const valid = createDirectTransportSimulationClient();
    let calls = 0;
    const controller = createTransportApplicationController({
      createClient: () => {
        if (++calls === 1) throw new Error('construction failed');
        return Object.freeze({
          ...valid,
          subscribeReliableUpdates(
            listener: Parameters<typeof valid.subscribeReliableUpdates>[0],
          ) {
            reliable();
            return valid.subscribeReliableUpdates(listener);
          },
          subscribeRenderSnapshots(
            listener: Parameters<typeof valid.subscribeRenderSnapshots>[0],
          ) {
            render();
            return valid.subscribeRenderSnapshots(listener);
          },
          async close() {
            close();
            await valid.close();
          },
        });
      },
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('failed-timeline'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('construction failed');
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'construction failed',
    });
    expect(reliable).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('retry-timeline'),
      scenario: scenario(),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'retry-timeline',
    });
    await controller.close();
  });

  it('normalizes a non-Error initial construction failure', async () => {
    const controller = createTransportApplicationController({
      createClient: () => {
        throw 'construction failed';
      },
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('failed-timeline'),
        scenario: scenario(),
      }),
    ).rejects.toBe('construction failed');
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'Transport operation failed.',
    });
    await controller.close();
  });

  it('finishes terminal close when construction failure starts close', async () => {
    const holder: {
      controller?: ReturnType<typeof createTransportApplicationController>;
    } = {};
    const controller = createTransportApplicationController({
      createClient: () => {
        void holder.controller!.close();
        throw new Error('construction failed during close');
      },
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    holder.controller = controller;
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('failed-timeline'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('construction failed during close');
    await controller.close();
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('rejects every authority operation while idle and subscriptions after close', async () => {
    const controller = createTransportApplicationController({
      createClient: createDirectTransportSimulationClient,
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.save({
        saveId: 'idle',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      }),
    ).rejects.toThrow('No ready');
    await expect(controller.advanceTicks(1)).rejects.toThrow('No ready');
    await expect(
      controller.restore({
        saveId: 'idle',
        timelineId: parseTimelineId('idle-restore'),
      }),
    ).rejects.toThrow('No ready');
    await controller.close();
    expect(() => controller.projection.subscribe(() => undefined)).toThrow(
      'closed',
    );
  });

  it('serializes duplicate start and save behind a pending activation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = createDirectTransportSimulationClient();
    const stored: unknown[] = [];
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async connect(request: Parameters<typeof base.connect>[0]) {
            await gate;
            await base.connect(request);
          },
        }),
      repository: {
        get: async () => undefined,
        put: async (value) => {
          stored.push(value);
        },
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const starting = controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-queued'),
      scenario: scenario(),
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('duplicate'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('unavailable');
    const saving = controller.save({
      saveId: 'queued',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    expect(stored).toHaveLength(0);
    release();
    await starting;
    await saving;
    expect(stored).toHaveLength(1);
    await controller.close();
  });

  it('serializes commands and saves behind restore resolution', async () => {
    let resolve!: (value: ReturnType<typeof scenario>) => void;
    const clients = [
      createDirectTransportSimulationClient(),
      createDirectTransportSimulationClient(),
    ];
    const stored: unknown[] = [];
    const controller = createTransportApplicationController({
      createClient: () => clients.shift()!,
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async (value) => {
          stored.push(value);
        },
      },
      scenarioResolver: {
        resolve: () => new Promise((accept) => (resolve = accept)),
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
    const advancing = controller.advanceTicks(1);
    const saving = controller.save({
      saveId: 'after-restore',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(scenario());
    await restoring;
    await advancing;
    await saving;
    expect(controller.projection.getState()).toMatchObject({
      timelineId: 'timeline-restored',
      simulationTick: 121,
    });
    expect(stored[0]).toMatchObject({ sourceTimelineId: 'timeline-restored' });
    await controller.close();
  });

  it('makes close terminal while snapshot export is pending and suppresses the stale save', async () => {
    const base = createDirectTransportSimulationClient();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exportEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let delay = false;
    const put = vi.fn(async () => undefined);
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async exportSnapshot() {
            if (delay) {
              entered();
              await gate;
            }
            return base.exportSnapshot();
          },
        }),
      repository: { get: async () => undefined, put },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-close-save'),
      scenario: scenario(),
    });
    delay = true;
    const saving = controller.save({
      saveId: 'stale',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await exportEntered;
    const closing = controller.close();
    release();
    await saving;
    await closing;
    expect(put).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('serializes two competing restores and leaves only the last timeline active', async () => {
    const clients = Array.from({ length: 3 }, () =>
      createDirectTransportSimulationClient(),
    );
    const controller = createTransportApplicationController({
      createClient: () => clients.shift()!,
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    const first = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('timeline-one'),
    });
    const second = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('timeline-two'),
    });
    await Promise.all([first, second]);
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-two',
      simulationTick: 120,
    });
    await controller.close();
  });

  it('isolates command/save failures and aggregates both cleanup failures', async () => {
    const base = createDirectTransportSimulationClient();
    let failCommand = false;
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          sendCommand: (command: Parameters<typeof base.sendCommand>[0]) =>
            failCommand
              ? Promise.reject(new Error('command failed'))
              : base.sendCommand(command),
          async close() {
            await base.close();
            throw new Error('client close failed');
          },
        }),
      repository: {
        get: async () => undefined,
        put: async () => Promise.reject(new Error('put failed')),
        close: async () => Promise.reject(new Error('repository close failed')),
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const remove = controller.projection.subscribe(() => undefined);
    remove();
    remove();
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-failures'),
      scenario: scenario(),
    });
    await expect(
      controller.save({
        saveId: 'slot',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      }),
    ).rejects.toThrow('put failed');
    expect(controller.projection.getState().message).toBe('put failed');
    failCommand = true;
    await expect(controller.advanceTicks(1)).rejects.toThrow('command failed');
    await expect(controller.close()).rejects.toThrow('cleanup failed');
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('closes a replacement whose readiness export fails', async () => {
    const base = createDirectTransportSimulationClient();
    const close = vi.fn(() => base.close());
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          exportSnapshot: async () =>
            Promise.reject(new Error('readiness failed')),
          close,
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('timeline-readiness'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('readiness failed');
    expect(close).toHaveBeenCalledOnce();
    expect(controller.projection.getState()).toMatchObject({
      status: 'failed',
      message: 'readiness failed',
    });
    await controller.close();
  });

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
    await expect(starting).rejects.toThrow('stale');
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
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
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
    await vi.waitFor(() => expect(events).toEqual(['resolve-start']));
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
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
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
        get: async () =>
          classifyPersistedSaveRecord({
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
    ).rejects.toThrow('obsolete');
    expect(close).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      message: expect.stringContaining('obsolete'),
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
    const raws = [
      undefined,
      classifyPersistedSaveRecord({
        kind: 'transport-save-record',
        schemaVersion: 1,
      }),
      classifyPersistedSaveRecord({ saveId: 'other', kind: 'other-product' }),
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
    ).rejects.toThrow('obsolete');
    await expect(
      controller.restore({
        saveId: 'unrelated',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('not a transport save');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
    });
    await controller.close();
    await expect(
      controller.save({ saveId: 'x', createdAtUtcMs: 1, updatedAtUtcMs: 1 }),
    ).rejects.toThrow('closed');
    await expect(
      controller.restore({
        saveId: 'x',
        timelineId: parseTimelineId('late'),
      }),
    ).rejects.toThrow('closed');
  });

  it('releases the session claim after invalid start and failed restore teardown', async () => {
    const first = createDirectTransportSimulationClient();
    const clients = [
      Object.freeze({
        ...first,
        async close() {
          await first.close();
          throw new Error('old close failed');
        },
      }),
      createDirectTransportSimulationClient(),
    ];
    const controller = createTransportApplicationController({
      createClient: () => clients.shift()!,
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.startNew({
        gameId: '' as never,
        timelineId: parseTimelineId('invalid'),
        scenario: scenario(),
      }),
    ).rejects.toThrow();
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('replacement'),
      }),
    ).rejects.toThrow('old close failed');
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'old close failed',
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('recovered'),
      scenario: scenario(),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'recovered',
    });
    await controller.close();
  });

  it('recovers after synchronous replacement construction failure', async () => {
    const clients = [
      createDirectTransportSimulationClient(),
      createDirectTransportSimulationClient(),
    ];
    let calls = 0;
    const controller = createTransportApplicationController({
      createClient: () => {
        if (++calls === 2) throw new Error('construction failed');
        return clients.shift()!;
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('replacement'),
      }),
    ).rejects.toThrow('construction failed');
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'construction failed',
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('recovered'),
      scenario: scenario(),
    });
    await controller.close();
  });
});
