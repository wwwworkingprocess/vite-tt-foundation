import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { createDirectTransportSimulationClient } from './transport-client.js';
import {
  startTransportWorkerRuntime,
  type TransportWorkerEndpoint,
} from './worker-transport-client.js';

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
const request = (requestId: number, timelineId: string) => ({
  data: {
    kind: 'transport-worker-request',
    contractVersion: 3,
    requestId,
    operation: 'connect',
    payload: {
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId,
      initialSimulationTick: 0,
      scenario: scenario(),
    },
  },
});

describe('transport Worker runtime transactional subscriptions', () => {
  it.each(['reliable', 'render'] as const)(
    'cleans a %s registration failure and permits a later connect',
    async (failurePoint) => {
      let listener!: (event: { data: unknown }) => void;
      const posted: unknown[] = [];
      const failed = createDirectTransportSimulationClient();
      const reliableCleanup = vi.fn();
      const connect = vi.fn(failed.connect);
      const close = vi.fn(() => failed.close());
      let creation = 0;
      const runtime = startTransportWorkerRuntime(
        {
          postMessage: (message) => posted.push(message),
          addEventListener: (_type, next) => {
            listener = next;
          },
          removeEventListener: vi.fn(),
        },
        () => {
          if (++creation > 1) return createDirectTransportSimulationClient();
          return Object.freeze({
            ...failed,
            connect,
            subscribeReliableUpdates: () => {
              if (failurePoint === 'reliable')
                throw new Error('reliable registration failed');
              return reliableCleanup;
            },
            subscribeRenderSnapshots: () => {
              if (failurePoint === 'render')
                throw new Error('render registration failed');
              return vi.fn();
            },
            close,
          });
        },
      );
      listener(request(1, 'failed'));
      await vi.waitFor(() =>
        expect(posted).toContainEqual(
          expect.objectContaining({
            kind: 'transport-worker-failure',
            requestId: 1,
          }),
        ),
      );
      expect(connect).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
      if (failurePoint === 'render')
        expect(reliableCleanup).toHaveBeenCalledOnce();
      listener(request(2, 'retry'));
      await vi.waitFor(() =>
        expect(posted).toContainEqual(
          expect.objectContaining({
            kind: 'transport-worker-result',
            requestId: 2,
            operation: 'connect',
          }),
        ),
      );
      await runtime.close();
    },
  );

  it('shuts down if publishing a setup failure throws despite cleanup errors', async () => {
    let listener!: (event: { data: unknown }) => void;
    const remove = vi.fn();
    const failed = createDirectTransportSimulationClient();
    const close = vi.fn(async () => {
      await failed.close();
      throw new Error('client close failed');
    });
    const endpoint: TransportWorkerEndpoint = {
      postMessage: () => {
        throw new Error('failure post failed');
      },
      addEventListener: (_type, next) => {
        listener = next;
      },
      removeEventListener: remove,
    };
    const runtime = startTransportWorkerRuntime(endpoint, () =>
      Object.freeze({
        ...failed,
        subscribeReliableUpdates: () => () => {
          throw new Error('cleanup failed');
        },
        subscribeRenderSnapshots: () => {
          throw new Error('render registration failed');
        },
        close,
      }),
    );
    listener(request(1, 'failed'));
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledOnce();
    await expect(runtime.close()).resolves.toBeUndefined();
  });
});
