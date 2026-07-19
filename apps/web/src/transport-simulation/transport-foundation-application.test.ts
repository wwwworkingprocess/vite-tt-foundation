import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  createScenarioCoordinate,
  scenarioCoordinatesEqual,
} from '@torrevieja-tycoon/simulation';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import { createFoundationPacingController } from '../pacing/foundation-pacing-controller.js';
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportFoundationApplication } from './transport-foundation-application.js';
import { createInMemoryTransportSaveRepository } from './transport-save-repository.js';

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
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
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
    expect(await application.listSaves()).toMatchObject([
      { saveId: 'legacy', compatibility: 'legacy-incompatible' },
    ]);
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
        list: async () => Promise.reject(new Error('list failed')),
      }),
      createClient: createDirectTransportSimulationClient,
      scenarioResolver: { resolve: async () => scenario },
    });
    await application.startNew({
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
    });
    await expect(application.listSaves()).rejects.toThrow('list failed');
    expect(application.projection.getState()).toMatchObject({
      session: { status: 'ready' },
      persistence: { status: 'failed', message: 'list failed' },
    });
    await application.close();
  });
});
