import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  parseScenarioPackage,
  type CanonicalScenario,
} from '@torrevieja-tycoon/transport-domain';
import {
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parseVehicleId,
} from '@torrevieja-tycoon/simulation';
import {
  parseClientId,
  parseCommandId,
  parseCorrelationId,
  parseGameId,
  parseSessionId,
  parseTimelineId,
} from '@torrevieja-tycoon/protocol';
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportApplicationController } from './transport-controller.js';
import { parseTransportSaveRecord } from './transport-save-record.js';
import { createInMemoryTransportSaveRepository } from './transport-save-repository.js';

const publicRoot = join(import.meta.dirname, '..', '..', 'public', 'scenarios');
const load = (directory: string): CanonicalScenario => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(join(publicRoot, directory, name), 'utf8'),
    ) as unknown;
  return parseScenarioPackage({
    manifest: read('scenario.json'),
    settlements: read('settlements.json'),
    stops: read('stops.json'),
    routes: read('routes.json'),
    presentation: read('presentation.json'),
    provenance: read('provenance.json'),
  });
};
const save = (scenario: CanonicalScenario, saveId: string, tick: number) =>
  parseTransportSaveRecord({
    kind: 'transport-save-record',
    schemaVersion: 7,
    saveId,
    gameId: 'game',
    sourceTimelineId: `source-${saveId}`,
    sourceCommandRevision: 8,
    sourceSimulationTick: tick,
    sourceStreamOffset: 8,
    createdAtUtcMs: 1,
    updatedAtUtcMs: 1,
    scenario: createScenarioCoordinate(scenario),
    snapshot: createTransportSimulationSnapshot(
      createTransportSimulationState(scenario, tick),
    ),
  });

describe('exact cross-scenario restore', () => {
  it('preserves and continues a V2 fleet while resetting host coordinates', async () => {
    const mini = load('torrevieja-mini-v1');
    const repository = createInMemoryTransportSaveRepository();
    const controller = createTransportApplicationController({
      createClient: createDirectTransportSimulationClient,
      repository,
      scenarioResolver: { resolve: async () => mini },
    });
    await controller.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('fleet-source'),
      scenario: mini,
    });
    const common = (id: string) => ({
      kind: 'foundation-command' as const,
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('fleet-source'),
      commandId: parseCommandId(id),
      correlationId: parseCorrelationId(id),
      clientId: parseClientId('test-client'),
      sessionId: parseSessionId('test-session'),
    });
    await controller.sendCommand({
      ...common('create'),
      command: {
        kind: 'transport.vehicle.create',
        vehicleId: parseVehicleId('vehicle-restore'),
        label: 'Restore vehicle',
        patternId: mini.routes.routes[0]!.patterns[0]!.patternId,
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: [3, 4, 5, 6],
        },
      },
    });
    await controller.sendCommand({
      ...common('start'),
      command: {
        kind: 'transport.vehicle.start',
        vehicleId: parseVehicleId('vehicle-restore'),
      },
    });
    await controller.advanceTicks(5);
    const savedFleet = controller.projection.getState().fleet;
    await controller.save({
      saveId: 'fleet-slot',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await controller.restore({
      saveId: 'fleet-slot',
      timelineId: parseTimelineId('fleet-restored'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'fleet-restored',
      commandRevision: 0,
      streamOffset: 0,
      fleet: savedFleet,
    });
    await controller.advanceTicks(1);
    expect(controller.projection.getState().fleet).not.toEqual(savedFleet);
    await controller.close();
  });

  it('resolves saved coordinates before teardown and restores both directions', async () => {
    const full = load('torrevieja-legacy-all-v1');
    const mini = load('torrevieja-mini-v1');
    const repository = createInMemoryTransportSaveRepository([
      save(full, 'full', 41),
      save(mini, 'mini', 17),
    ]);
    const resolved: string[] = [];
    const scenarios = new Map([
      [full.manifest.scenarioId, full],
      [mini.manifest.scenarioId, mini],
    ]);
    const controller = createTransportApplicationController({
      createClient: createDirectTransportSimulationClient,
      repository,
      scenarioResolver: {
        async resolve(coordinate) {
          resolved.push(coordinate.scenarioId);
          return scenarios.get(coordinate.scenarioId)!;
        },
      },
    });
    await controller.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('current-full'),
      scenario: full,
    });
    await controller.restore({
      saveId: 'mini',
      timelineId: parseTimelineId('mini-restored-1'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'mini-restored-1',
      scenario: createScenarioCoordinate(mini),
      simulationTick: 17,
      commandRevision: 0,
      streamOffset: 0,
    });
    await controller.restore({
      saveId: 'full',
      timelineId: parseTimelineId('full-restored-2'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'full-restored-2',
      scenario: createScenarioCoordinate(full),
      simulationTick: 41,
      commandRevision: 0,
      streamOffset: 0,
    });
    expect(resolved).toEqual([
      'torrevieja-mini-v1',
      'torrevieja-legacy-all-v1',
    ]);
    await controller.close();
  });

  it('leaves current authority usable when exact resolution fails', async () => {
    const full = load('torrevieja-legacy-all-v1');
    const mini = load('torrevieja-mini-v1');
    const repository = createInMemoryTransportSaveRepository([
      save(mini, 'mini', 17),
    ]);
    const close = vi.fn();
    const controller = createTransportApplicationController({
      createClient: () => {
        const client = createDirectTransportSimulationClient();
        return Object.freeze({
          ...client,
          close: async () => {
            close();
            await client.close();
          },
        });
      },
      repository,
      scenarioResolver: {
        resolve: async () => Promise.reject(new Error('hash mismatch')),
      },
    });
    await controller.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('current-full'),
      scenario: full,
      initialSimulationTick: 9,
    });
    await expect(
      controller.restore({
        saveId: 'mini',
        timelineId: parseTimelineId('never-active'),
      }),
    ).rejects.toThrow('hash mismatch');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'current-full',
      simulationTick: 9,
    });
    expect(close).not.toHaveBeenCalled();
    await controller.close();
  });

  it('makes restore stale when terminal close begins during old-authority teardown', async () => {
    const full = load('torrevieja-legacy-all-v1');
    const mini = load('torrevieja-mini-v1');
    const repository = createInMemoryTransportSaveRepository([
      save(mini, 'mini', 17),
    ]);
    let creation = 0;
    let release!: () => void;
    let entered!: () => void;
    let delayClose = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closeEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const controller = createTransportApplicationController({
      createClient: () => {
        const direct = createDirectTransportSimulationClient();
        const isCurrentAuthority = ++creation === 1;
        return Object.freeze({
          ...direct,
          async close() {
            if (isCurrentAuthority && delayClose) {
              entered();
              await gate;
            }
            await direct.close();
          },
        });
      },
      repository,
      scenarioResolver: { resolve: async () => mini },
    });
    await controller.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('current'),
      scenario: full,
    });
    delayClose = true;
    const restoring = controller.restore({
      saveId: 'mini',
      timelineId: parseTimelineId('never-ready'),
    });
    await closeEntered;
    const closing = controller.close();
    release();
    await expect(restoring).rejects.toThrow('stale');
    await closing;
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });
});
