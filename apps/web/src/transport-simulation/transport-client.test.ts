import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import {
  parseClientId,
  parseCommandId,
  parseCorrelationId,
  parseGameId,
  parseSessionId,
  parseTimelineId,
} from '@torrevieja-tycoon/protocol';
import {
  createDirectTransportSimulationClient,
  createStructuredCloneTransportSimulationClient,
} from './transport-client.js';
import {
  createWorkerTransportSimulationClient,
  startTransportWorkerRuntime,
  type TransportWorkerEndpoint,
  type TransportWorkerLike,
} from './worker-transport-client.js';

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
const createLoopbackWorker = (): TransportWorkerLike => {
  const workerListeners = new Set<(event: { data: unknown }) => void>();
  const runtimeListeners = new Set<(event: { data: unknown }) => void>();
  const endpoint: TransportWorkerEndpoint = {
    postMessage(message) {
      const cloned = structuredClone(message);
      queueMicrotask(() => {
        for (const listener of [...workerListeners]) listener({ data: cloned });
      });
    },
    addEventListener: (_type, listener) => runtimeListeners.add(listener),
    removeEventListener: (_type, listener) => runtimeListeners.delete(listener),
  };
  const runtime = startTransportWorkerRuntime(endpoint);
  return {
    postMessage(message) {
      const cloned = structuredClone(message);
      queueMicrotask(() => {
        for (const listener of [...runtimeListeners])
          listener({ data: cloned });
      });
    },
    addEventListener: (_type, listener) => workerListeners.add(listener),
    removeEventListener: (_type, listener) => workerListeners.delete(listener),
    terminate() {
      void runtime.close();
      workerListeners.clear();
    },
  };
};
const factories = [
  ['direct', createDirectTransportSimulationClient],
  ['structured clone', createStructuredCloneTransportSimulationClient],
  [
    'Worker',
    () =>
      createWorkerTransportSimulationClient({
        workerFactory: createLoopbackWorker,
      }),
  ],
] as const;

describe.each(factories)('%s transport client', (_name, createClient) => {
  it('guards readiness, validates connect, and isolates lifecycle subscriptions', async () => {
    const client = createClient();
    expect(() => client.getAuthoritativeState()).toThrow('not ready');
    await expect(client.exportSnapshot()).rejects.toThrow('not ready');
    await expect(
      client.synchronize({
        kind: 'foundation-synchronization-request',
        gameId: parseGameId('game-fixture'),
      }),
    ).rejects.toThrow('not ready');
    const healthy = vi.fn();
    const removeFirst = client.subscribeLifecycle(healthy);
    const removeSecond = client.subscribeLifecycle(healthy);
    client.subscribeLifecycle(() => {
      throw new Error('listener');
    });
    removeFirst();
    removeFirst();
    await expect(client.connect({ kind: 'wrong' } as never)).rejects.toThrow(
      'Unsupported',
    );
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 1,
      mode: 'new',
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-lifecycle'),
      initialSimulationTick: 0,
      scenario: scenario(),
    });
    expect(healthy).toHaveBeenCalledTimes(2);
    removeSecond();
    await client.close();
  });

  it('has new/restore parity and exposes coordinate without static data', async () => {
    const canonical = scenario();
    const client = createClient();
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 1,
      mode: 'new',
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-new'),
      initialSimulationTick: 0,
      scenario: canonical,
    });
    expect(client.getLifecycle()).toMatchObject({
      state: 'ready',
      scenario: { scenarioId: 'torrevieja-mini-v1' },
    });
    const snapshot = await client.exportSnapshot();
    expect(snapshot.snapshot.scenario.scenarioId).toBe('torrevieja-mini-v1');
    expect(JSON.stringify(snapshot)).not.toContain('stopNodes');
    expect(
      await client.synchronize({
        kind: 'foundation-synchronization-request',
        gameId: parseGameId('game-fixture'),
      }),
    ).toMatchObject({
      kind: 'transport-synchronization-response',
      scenario: { scenarioId: 'torrevieja-mini-v1' },
    });
    await client.close();

    const restored = createClient();
    await restored.connect({
      kind: 'transport-client-connect',
      contractVersion: 1,
      mode: 'restore',
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-restored'),
      scenario: canonical,
      snapshot: createTransportSimulationSnapshot(
        createTransportSimulationState(canonical, 120),
      ),
    });
    expect(await restored.exportSnapshot()).toMatchObject({
      commandRevision: 0,
      streamOffset: 0,
      simulationTick: 120,
      snapshot: { scenario: { scenarioId: 'torrevieja-mini-v1' } },
    });
    await restored.close();
  });

  it('keeps command A -> export -> command B FIFO ordering', async () => {
    const client = createClient();
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 1,
      mode: 'new',
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-fifo'),
      initialSimulationTick: 0,
      scenario: scenario(),
    });
    const command = (id: string, count: number) => ({
      kind: 'foundation-command' as const,
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-fifo'),
      commandId: parseCommandId(id),
      correlationId: parseCorrelationId(id),
      clientId: parseClientId('client'),
      sessionId: parseSessionId('session'),
      command: { type: 'foundation.advance-ticks' as const, count },
    });
    const a = client.sendCommand(command('a', 2));
    const exported = client.exportSnapshot();
    const b = client.sendCommand(command('b', 3));
    await Promise.all([a, b]);
    expect((await exported).snapshot.state.tick).toBe(2);
    expect((await client.exportSnapshot()).snapshot.state.tick).toBe(5);
    await client.close();
  });

  it('reparses and deeply freezes the scenario at the clone boundary', async () => {
    const client = createClient();
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 1,
      mode: 'new',
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-freeze'),
      initialSimulationTick: 0,
      scenario: structuredClone(scenario()),
    });
    const authority = client.getAuthoritativeState();
    expect(Object.isFrozen(authority.scenario)).toBe(true);
    expect(Object.isFrozen(authority.scenario.stops.stopNodes)).toBe(true);
    expect(Object.isFrozen(authority.graph.edges)).toBe(true);
    await client.close();
  });

  it('publishes compact updates and retains authoritative static identity', async () => {
    const client = createClient();
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 1,
      mode: 'new',
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-update'),
      initialSimulationTick: 0,
      scenario: scenario(),
    });
    const reliable = vi.fn();
    const renders = vi.fn();
    const removeReliable = client.subscribeReliableUpdates(reliable);
    const removeRender = client.subscribeRenderSnapshots(renders);
    const before = client.getAuthoritativeState();
    await client.sendCommand({
      kind: 'foundation-command',
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-update'),
      commandId: parseCommandId('advance'),
      correlationId: parseCorrelationId('advance'),
      clientId: parseClientId('client'),
      sessionId: parseSessionId('session'),
      command: { type: 'foundation.advance-ticks', count: 1 },
    });
    expect(reliable).toHaveBeenCalledWith(
      expect.not.objectContaining({ scenario: expect.anything() }),
    );
    expect(renders).toHaveBeenCalledTimes(1);
    const after = client.getAuthoritativeState();
    expect(after.scenario).toBe(before.scenario);
    expect(after.graph).toBe(before.graph);
    removeReliable();
    removeRender();
    await client.close();
  });
});
