import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { parseVehicleId } from '@torrevieja-tycoon/simulation';
import {
  parseClientId,
  parseCommandId,
  parseCommandRevision,
  parseCorrelationId,
  parseGameId,
  parseSessionId,
  parseTimelineId,
} from '@torrevieja-tycoon/protocol';
import {
  createDirectTransportSimulationClient,
  createStructuredCloneTransportSimulationClient,
  type TransportCommandEnvelope,
  type TransportSimulationClient,
} from './transport-client.js';
import {
  createWorkerTransportSimulationClient,
  startTransportWorkerRuntime,
  type TransportWorkerEvent,
  type TransportWorkerLike,
} from './worker-transport-client.js';

const fixtureRoot = join(
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
  JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });

class LoopbackWorker implements TransportWorkerLike {
  private readonly clientListeners = new Map<
    string,
    Set<(event: TransportWorkerEvent) => void>
  >();
  private readonly runtimeListeners = new Set<
    (event: { data: unknown }) => void
  >();
  private readonly runtime = startTransportWorkerRuntime(
    {
      postMessage: (message) =>
        queueMicrotask(() =>
          this.emitClient('message', { data: structuredClone(message) }),
        ),
      addEventListener: (_type, listener) =>
        this.runtimeListeners.add(listener),
      removeEventListener: (_type, listener) =>
        this.runtimeListeners.delete(listener),
      reportError: (error) =>
        queueMicrotask(() =>
          this.emitClient('error', { data: undefined, error }),
        ),
    },
    createDirectTransportSimulationClient,
  );
  postMessage(message: unknown) {
    queueMicrotask(() => {
      for (const listener of [...this.runtimeListeners])
        listener({ data: structuredClone(message) });
    });
  }
  addEventListener(
    type: string,
    listener: (event: TransportWorkerEvent) => void,
  ) {
    const listeners = this.clientListeners.get(type) ?? new Set();
    listeners.add(listener);
    this.clientListeners.set(type, listeners);
  }
  removeEventListener(
    type: string,
    listener: (event: TransportWorkerEvent) => void,
  ) {
    this.clientListeners.get(type)?.delete(listener);
  }
  terminate() {
    void this.runtime.close();
  }
  private emitClient(type: string, event: TransportWorkerEvent) {
    for (const listener of [...(this.clientListeners.get(type) ?? [])])
      listener(event);
  }
}

const factories: ReadonlyArray<
  readonly [string, () => TransportSimulationClient]
> = [
  ['direct', createDirectTransportSimulationClient],
  ['clone', createStructuredCloneTransportSimulationClient],
  [
    'worker',
    () =>
      createWorkerTransportSimulationClient({
        workerFactory: () => new LoopbackWorker(),
      }),
  ],
];
const envelope = (
  sequence: number,
  command: TransportCommandEnvelope['command'],
): TransportCommandEnvelope => ({
  kind: 'foundation-command',
  gameId: parseGameId('game'),
  timelineId: parseTimelineId('timeline'),
  commandId: parseCommandId(`vehicle-command-${sequence}`),
  correlationId: parseCorrelationId(`vehicle-command-${sequence}`),
  clientId: parseClientId('test-client'),
  sessionId: parseSessionId('test-session'),
  command,
});

describe.each(factories)(
  '%s vehicle client contract',
  (_name, createClient) => {
    it('creates, starts, advances, publishes, exports, and freezes one fleet', async () => {
      const client = createClient();
      const canonical = scenario();
      const patternId = canonical.routes.routes[0]!.patterns[0]!.patternId;
      const updates: unknown[] = [];
      client.subscribeReliableUpdates((update) => updates.push(update));
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 1,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
        scenario: canonical,
      });
      await client.sendCommand(
        envelope(1, {
          kind: 'transport.vehicle.create',
          vehicleId: parseVehicleId('vehicle-demo-1'),
          label: 'Demo vehicle',
          patternId,
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [3, 4, 5, 6],
          },
        }),
      );
      await client.sendCommand(
        envelope(2, {
          kind: 'transport.vehicle.start',
          vehicleId: parseVehicleId('vehicle-demo-1'),
        }),
      );
      await client.sendCommand(
        envelope(3, { type: 'foundation.advance-ticks', count: 5 }),
      );
      const exported = await client.exportSnapshot();
      expect(exported.snapshot.schemaVersion).toBe(2);
      expect(exported.snapshot.state.fleet[0]?.movement).toMatchObject({
        kind: 'running-on-edge',
        edgeSequence: 1,
        progressTicks: 2,
        travelTicks: 4,
      });
      expect(updates).toHaveLength(3);
      expect(Object.isFrozen(exported.snapshot.state.fleet)).toBe(true);
      expect(Object.isFrozen(updates[2])).toBe(true);
      await client.close();
    });

    it('serializes concurrent vehicle commands without losing fleet entries', async () => {
      const client = createClient();
      const canonical = scenario();
      const patternId = canonical.routes.routes[0]!.patterns[0]!.patternId;
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 1,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
        scenario: canonical,
      });
      await Promise.all(
        ['vehicle-a', 'vehicle-b'].map((id, index) =>
          client.sendCommand(
            envelope(index + 10, {
              kind: 'transport.vehicle.create',
              vehicleId: parseVehicleId(id),
              label: id,
              patternId,
              movementPlan: {
                kind: 'vehicle-movement-plan-v1',
                edgeTravelTicks: [1, 2, 3, 4],
              },
            }),
          ),
        ),
      );
      expect(
        (await client.exportSnapshot()).snapshot.state.fleet.map(
          ({ vehicleId }) => vehicleId,
        ),
      ).toEqual(['vehicle-a', 'vehicle-b']);
      await client.close();
    });
  },
);

describe('direct vehicle client failure and idempotency behavior', () => {
  it('isolates listeners, subscriptions, invalid commands, duplicates, and conflicts', async () => {
    const client = createDirectTransportSimulationClient();
    const canonical = scenario();
    const patternId = canonical.routes.routes[0]!.patterns[0]!.patternId;
    const healthy: unknown[] = [];
    const removeFirst = client.subscribeReliableUpdates(() => {
      throw new Error('listener failed');
    });
    client.subscribeReliableUpdates((update) => healthy.push(update));
    removeFirst();
    removeFirst();
    await expect(
      client.sendCommand(
        envelope(1, { type: 'foundation.advance-ticks', count: 1 }),
      ),
    ).rejects.toThrow('not ready');
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 1,
      mode: 'new',
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
      scenario: canonical,
    });
    await expect(
      client.connect({
        kind: 'transport-client-connect',
        contractVersion: 1,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('other'),
        initialSimulationTick: 0,
        scenario: canonical,
      }),
    ).rejects.toThrow('only from idle');
    const create = envelope(2, {
      kind: 'transport.vehicle.create',
      vehicleId: parseVehicleId('vehicle-idempotent'),
      label: 'Vehicle',
      patternId,
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [3, 4, 5, 6],
      },
    });
    expect(await client.sendCommand(create)).toMatchObject({
      status: 'applied',
    });
    expect(await client.sendCommand(create)).toMatchObject({ duplicate: true });
    const conflict = {
      ...create,
      command: { ...create.command, label: 'Changed' },
    };
    expect((await client.sendCommand(conflict)).kind).toBe(
      'foundation-protocol-error',
    );
    const invalid = envelope(3, {
      kind: 'transport.vehicle.create',
      vehicleId: parseVehicleId('invalid-plan'),
      label: 'Invalid',
      patternId,
      movementPlan: { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: [1] },
    });
    expect((await client.sendCommand(invalid)).kind).toBe(
      'foundation-protocol-error',
    );
    expect(
      await client.sendCommand({
        ...envelope(4, { type: 'foundation.advance-ticks', count: 1 }),
        expectedCommandRevision: parseCommandRevision(99),
      }),
    ).toMatchObject({ status: 'rejected' });
    expect(healthy).toHaveLength(1);
    await client.close();
    expect(() => client.subscribeReliableUpdates(() => undefined)).toThrow(
      'closed',
    );
  });
});
