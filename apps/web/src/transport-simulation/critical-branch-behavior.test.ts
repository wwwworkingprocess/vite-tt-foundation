import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportApplicationController } from './transport-controller.js';
import { parseTransportWorkerResponse } from './transport-worker-wire.js';

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

describe('critical transport branch behavior', () => {
  it('rejects every direct-client authority surface after terminal close', async () => {
    const client = createDirectTransportSimulationClient();
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 2,
      mode: 'new',
      gameId: 'game',
      timelineId: 'timeline',
      initialSimulationTick: 0,
      scenario: scenario(),
    } as never);
    await client.close();
    await expect(client.sendCommand({} as never)).rejects.toThrow('closed');
    await expect(
      client.synchronize({
        kind: 'foundation-synchronization-request',
        gameId: 'game',
      } as never),
    ).rejects.toThrow('ready');
    await expect(client.exportSnapshot()).rejects.toThrow('ready');
    expect(() => client.subscribeReliableUpdates(vi.fn())).toThrow('closed');
    expect(() => client.subscribeRenderSnapshots(vi.fn())).toThrow('closed');
    expect(() => client.subscribeLifecycle(vi.fn())).toThrow('closed');
  });

  it('accepts a protocol-error command result across the strict Worker wire', () => {
    expect(
      parseTransportWorkerResponse({
        kind: 'transport-worker-result',
        contractVersion: 2,
        requestId: 1,
        operation: 'send-command',
        payload: {
          kind: 'foundation-protocol-error',
          gameId: 'game',
          commandId: 'command',
          code: 'command-id-conflict',
          message: 'conflict',
        },
      }),
    ).toMatchObject({ operation: 'send-command' });
  });

  it('accepts a generic full synchronization response during activation', async () => {
    const base = createDirectTransportSimulationClient();
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async synchronize(request: Parameters<typeof base.synchronize>[0]) {
            const response = await base.synchronize(request);
            return response.kind === 'transport-synchronization-response'
              ? response.foundation
              : response;
          },
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: 'game' as never,
      timelineId: 'generic-sync' as never,
      scenario: scenario(),
    });
    expect(controller.projection.getState()).toMatchObject({ status: 'ready' });
    await controller.close();
  });

  it('rejects a non-full synchronization response and idle commands', async () => {
    const idle = createTransportApplicationController({
      createClient: createDirectTransportSimulationClient,
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(idle.sendCommand({} as never)).rejects.toThrow('ready');
    await idle.close();
    const base = createDirectTransportSimulationClient();
    const invalid = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          synchronize: async () =>
            ({
              kind: 'foundation-synchronization-identity-mismatch',
              code: 'identity-mismatch',
              gameId: 'game',
            }) as never,
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      invalid.startNew({
        gameId: 'game' as never,
        timelineId: 'invalid-sync' as never,
        scenario: scenario(),
      }),
    ).rejects.toThrow('Full transport synchronization');
    await invalid.close();
  });

  it('does not export or publish a command completion made stale by close', async () => {
    const base = createDirectTransportSimulationClient();
    let release!: () => void;
    let entered!: () => void;
    let delay = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commandEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const exported = vi.fn(() => base.exportSnapshot());
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async sendCommand(command: Parameters<typeof base.sendCommand>[0]) {
            if (delay) {
              entered();
              await gate;
            }
            return base.sendCommand(command);
          },
          exportSnapshot: exported,
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: 'game' as never,
      timelineId: 'stale-command' as never,
      scenario: scenario(),
    });
    exported.mockClear();
    delay = true;
    const command = controller.sendCommand({
      kind: 'foundation-command',
      gameId: 'game',
      timelineId: 'stale-command',
      commandId: 'command',
      correlationId: 'correlation',
      clientId: 'client',
      sessionId: 'session',
      command: { type: 'foundation.advance-ticks', count: 1 },
    } as never);
    await commandEntered;
    const closing = controller.close();
    release();
    await command;
    await closing;
    expect(exported).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('rejects activation whose readiness export becomes stale during close', async () => {
    const base = createDirectTransportSimulationClient();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exportEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async exportSnapshot() {
            entered();
            await gate;
            return base.exportSnapshot();
          },
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const starting = controller.startNew({
      gameId: 'game' as never,
      timelineId: 'stale-export' as never,
      scenario: scenario(),
    });
    await exportEntered;
    const closing = controller.close();
    release();
    await expect(starting).rejects.toThrow('stale');
    await closing;
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });
});
