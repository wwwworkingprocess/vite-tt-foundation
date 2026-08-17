import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  createScenarioCoordinate,
  parsePassengerDemandPlan,
  scenarioCoordinatesEqual,
} from '@torrevieja-tycoon/simulation';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import { createFoundationPacingController } from '../pacing/foundation-pacing-controller.js';
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportFoundationApplication } from './transport-foundation-application.js';
import { createInMemoryTransportSaveRepository } from './transport-save-repository.js';
import type { TransportSaveSummary } from './transport-save-record.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});
const demandPlan = parsePassengerDemandPlan({
  schemaVersion: '1.0.0',
  demandModelContentHash: 'd'.repeat(64),
  scenario: createScenarioCoordinate(scenario),
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
const legacy = {
  kind: 'foundation-save-record',
  schemaVersion: 1,
  saveId: 'legacy',
  gameId: 'game',
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
};

describe('transport-backed foundation application port', () => {
  it('deeply freezes every nested ready and persistence projection value', async () => {
    const application = createTransportFoundationApplication({
      scenario,
      repository: createInMemoryTransportSaveRepository(),
      createClient: createDirectTransportSimulationClient,
      scenarioResolver: { resolve: async () => scenario },
    });
    await application.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 3,
      passengerDemandPlan: demandPlan,
    });
    await application.save({
      saveId: 'slot',
      label: 'Nested summary',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 2,
    });
    const first = application.projection.getState();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.session)).toBe(true);
    expect(Object.isFrozen(first.scenario)).toBe(true);
    expect(Object.isFrozen(first.authoritative)).toBe(true);
    expect(Object.isFrozen(first.synchronization)).toBe(true);
    expect(first.passengerDemand).toMatchObject({
      status: 'active',
      processedThroughTick: 3,
      totalEmittedPassengerCount: 0,
    });
    expect(Object.isFrozen(first.passengerDemand)).toBe(true);
    expect(Object.isFrozen(first.persistence)).toBe(true);
    expect(Object.isFrozen(first.persistence.saves)).toBe(true);
    expect(Object.isFrozen(first.persistence.saves[0])).toBe(true);
    expect(Reflect.set(first.session, 'status', 'failed')).toBe(false);
    expect(Reflect.set(first.authoritative!, 'simulationTick', 999)).toBe(
      false,
    );
    expect(Reflect.set(first.authoritative!, 'commandRevision', 999)).toBe(
      false,
    );
    expect(Reflect.set(first.authoritative!, 'streamOffset', 999)).toBe(false);
    expect(Reflect.set(first.scenario!, 'scenarioId', 'mutated')).toBe(false);
    expect(Reflect.set(first.synchronization, 'status', 'failed')).toBe(false);
    expect(Reflect.set(first.persistence, 'status', 'failed')).toBe(false);
    expect(() =>
      (first.persistence.saves as TransportSaveSummary[]).push(
        first.persistence.saves[0]! as TransportSaveSummary,
      ),
    ).toThrow();
    expect(Reflect.set(first.persistence.saves[0]!, 'label', 'mutated')).toBe(
      false,
    );
    expect(application.projection.getState()).toEqual(first);
    await application.close();
    const closed = application.projection.getState();
    expect(Object.isFrozen(closed)).toBe(true);
    expect(Object.isFrozen(closed.session)).toBe(true);
    expect(Reflect.set(closed.session, 'status', 'ready')).toBe(false);
    expect(application.projection.getState()).toEqual(closed);
  });

  it('drives one transport authority through pacing, saves, legacy listing, and restore', async () => {
    const repository = createInMemoryTransportSaveRepository([
      legacy,
      { saveId: 'corrupt', kind: 'transport-save-record', schemaVersion: 1 },
    ]);
    const application = createTransportFoundationApplication({
      scenario,
      repository,
      createClient: createDirectTransportSimulationClient,
      scenarioResolver: {
        async resolve(coordinate) {
          if (
            !scenarioCoordinatesEqual(
              createScenarioCoordinate(scenario),
              coordinate,
            )
          )
            throw new Error('exact scenario unavailable');
          return scenario;
        },
      },
    });
    await application.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
    });
    expect(await application.listSaves()).toEqual([]);
    const pacing = createFoundationPacingController({ application });
    await pacing.setMode('normal');
    await pacing.advanceByElapsedMicroseconds(250_000);
    expect(
      application.projection.getState().authoritative?.simulationTick,
    ).toBe(1);
    await application.save({
      saveId: 'foundation-slot',
      createdAtUtcMs: 2,
      updatedAtUtcMs: 2,
    });
    await pacing.advanceByElapsedMicroseconds(250_000);
    await application.restore({
      saveId: 'foundation-slot',
      newTimelineId: parseTimelineId('restored'),
    });
    expect(application.projection.getState()).toMatchObject({
      session: { status: 'ready', timelineId: 'restored' },
      authoritative: { simulationTick: 1, commandRevision: 0, streamOffset: 0 },
    });
    await pacing.close();
    await application.close();
  });

  it('normalizes repository failures without losing the application session', async () => {
    const base = createInMemoryTransportSaveRepository();
    const application = createTransportFoundationApplication({
      scenario,
      repository: Object.freeze({
        ...base,
        list: async () => Promise.reject('list failed'),
      }),
      createClient: createDirectTransportSimulationClient,
      scenarioResolver: { resolve: async () => scenario },
    });
    await application.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
    });
    await expect(application.listSaves()).rejects.toBe('list failed');
    expect(application.projection.getState()).toMatchObject({
      session: { status: 'ready' },
      persistence: { status: 'failed', message: 'Persistence failed.' },
    });
    await application.close();
  });

  it('keeps save failures recoverable with complete immutable projections', async () => {
    const base = createInMemoryTransportSaveRepository();
    const application = createTransportFoundationApplication({
      scenario,
      repository: Object.freeze({
        ...base,
        put: async () => Promise.reject(new Error('put failed')),
      }),
      createClient: createDirectTransportSimulationClient,
      scenarioResolver: { resolve: async () => scenario },
    });
    await application.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
    });
    const before = application.projection.getState();
    await expect(
      application.save({
        saveId: 'slot',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      }),
    ).rejects.toThrow('put failed');
    const failed = application.projection.getState();
    expect(failed).toMatchObject({
      session: { status: 'ready' },
      scenario: { scenarioId: 'torrevieja-mini-v1' },
      authoritative: before.authoritative,
      persistence: { status: 'failed', saves: [] },
    });
    expect(Object.isFrozen(failed)).toBe(true);
    expect(Object.isFrozen(failed.scenario)).toBe(true);
    await application.close();
  });

  it('publishes terminal closed even when transport cleanup rejects', async () => {
    const direct = createDirectTransportSimulationClient();
    const close = vi.fn(async () => {
      await direct.close();
      throw new Error('close failed');
    });
    const application = createTransportFoundationApplication({
      scenario,
      repository: createInMemoryTransportSaveRepository(),
      createClient: () => Object.freeze({ ...direct, close }),
      scenarioResolver: { resolve: async () => scenario },
    });
    await application.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
    });
    const first = application.close();
    expect(application.close()).toBe(first);
    await expect(first).rejects.toThrow('cleanup failed');
    expect(application.projection.getState().session).toEqual({
      status: 'closed',
    });
    expect(application.projection.getState().authoritative).toBeUndefined();
  });

  it('keeps the old authority usable when restore resolution fails', async () => {
    const saved = createInMemoryTransportSaveRepository();
    const application = createTransportFoundationApplication({
      scenario,
      repository: saved,
      createClient: createDirectTransportSimulationClient,
      scenarioResolver: {
        resolve: async () => Promise.reject(new Error('scenario missing')),
      },
    });
    await application.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('current'),
      initialSimulationTick: 4,
    });
    await application.save({
      saveId: 'slot',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    const before = application.projection.getState();
    await expect(
      application.restore({
        saveId: 'slot',
        newTimelineId: parseTimelineId('replacement'),
      }),
    ).rejects.toThrow('scenario missing');
    expect(application.projection.getState()).toMatchObject({
      session: before.session,
      authoritative: before.authoritative,
      persistence: {
        status: 'failed',
        saves: [{ saveId: 'slot' }],
        message: 'scenario missing',
      },
    });
    await application.close();
  });

  it('publishes a complete failed session after activation failure', async () => {
    const direct = createDirectTransportSimulationClient();
    const application = createTransportFoundationApplication({
      scenario,
      repository: createInMemoryTransportSaveRepository(),
      createClient: () =>
        Object.freeze({
          ...direct,
          connect: async () => Promise.reject('startup failed'),
        }),
      scenarioResolver: { resolve: async () => scenario },
    });
    await expect(
      application.startNew({
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
      }),
    ).rejects.toBe('startup failed');
    expect(application.projection.getState()).toEqual({
      session: {
        status: 'failed',
        message: 'Transport operation failed.',
      },
      synchronization: { status: 'idle' },
      persistence: { status: 'idle', saves: [] },
    });
    const failed = application.projection.getState();
    expect(Object.isFrozen(failed)).toBe(true);
    expect(Object.isFrozen(failed.session)).toBe(true);
    expect(Reflect.set(failed.session, 'status', 'ready')).toBe(false);
    expect(application.projection.getState()).toEqual(failed);
    await application.close();
  });
});
