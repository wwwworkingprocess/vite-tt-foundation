import {
  advanceTransportTicks,
  createFoundationSimulationSnapshot,
  createFoundationState,
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parseSimulationTick,
  parseTickAdvancement,
  restoreTransportSimulationState,
  type ScenarioCoordinate,
  type TransportSimulationSnapshot,
  type TransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import type {
  FoundationClientLifecycle,
  FoundationCommandEnvelope,
  FoundationCommandResult,
  FoundationRenderSnapshot,
  FoundationStateUpdate,
  FoundationSynchronizationRequest,
  FoundationSynchronizationResponse,
  GameId,
  TimelineId,
} from '@torrevieja-tycoon/protocol';
import { createDirectFoundationClient } from '../simulation-host/direct-client.js';

export const transportClientContractVersion = 1 as const;

export type TransportClientConnectRequest =
  | Readonly<{
      kind: 'transport-client-connect';
      contractVersion: 1;
      mode: 'new';
      gameId: GameId;
      timelineId: TimelineId;
      initialSimulationTick: number;
      scenario: CanonicalScenario;
    }>
  | Readonly<{
      kind: 'transport-client-connect';
      contractVersion: 1;
      mode: 'restore';
      gameId: GameId;
      timelineId: TimelineId;
      scenario: CanonicalScenario;
      snapshot: TransportSimulationSnapshot;
    }>;

export type TransportClientLifecycle =
  | Exclude<FoundationClientLifecycle, { readonly state: 'ready' }>
  | Readonly<{
      state: 'ready';
      gameId: GameId;
      timelineId: TimelineId;
      scenario: ScenarioCoordinate;
    }>;

export interface TransportSnapshotExport {
  readonly kind: 'transport-snapshot-export';
  readonly gameId: GameId;
  readonly timelineId: TimelineId;
  readonly commandRevision: number;
  readonly simulationTick: number;
  readonly streamOffset: number;
  readonly snapshot: TransportSimulationSnapshot;
}

export type TransportSynchronizationResponse =
  | FoundationSynchronizationResponse
  | Readonly<{
      kind: 'transport-synchronization-response';
      foundation: FoundationSynchronizationResponse;
      scenario: ScenarioCoordinate;
    }>;

export interface TransportSimulationClient {
  connect(request: TransportClientConnectRequest): Promise<void>;
  sendCommand(
    command: FoundationCommandEnvelope,
  ): Promise<FoundationCommandResult>;
  synchronize(
    request: FoundationSynchronizationRequest,
  ): Promise<TransportSynchronizationResponse>;
  exportSnapshot(): Promise<TransportSnapshotExport>;
  subscribeReliableUpdates(
    listener: (update: FoundationStateUpdate) => void,
  ): () => void;
  subscribeRenderSnapshots(
    listener: (snapshot: FoundationRenderSnapshot) => void,
  ): () => void;
  getLifecycle(): TransportClientLifecycle;
  subscribeLifecycle(
    listener: (state: TransportClientLifecycle) => void,
  ): () => void;
  getAuthoritativeState(): TransportSimulationState;
  close(): Promise<void>;
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

function assertConnectShape(request: TransportClientConnectRequest): void {
  if (
    request.kind !== 'transport-client-connect' ||
    request.contractVersion !== transportClientContractVersion ||
    (request.mode !== 'new' && request.mode !== 'restore')
  )
    throw new Error('Unsupported transport client connect request.');
}

export function createDirectTransportSimulationClient(): TransportSimulationClient {
  const foundation = createDirectFoundationClient();
  let authority: TransportSimulationState | undefined;
  let lifecycle: TransportClientLifecycle = freeze({ state: 'idle' });
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let registrationSequence = 0;
  const lifecycleListeners = new Map<
    number,
    (state: TransportClientLifecycle) => void
  >();
  const publishLifecycle = (next: TransportClientLifecycle) => {
    lifecycle = freeze(next);
    for (const listener of [...lifecycleListeners.values()])
      try {
        listener(lifecycle);
      } catch {
        // Listener diagnostics cannot affect the authoritative client.
      }
  };
  foundation.subscribeReliableUpdates((update) => {
    if (!authority || update.simulationTick < authority.tick) return;
    authority = advanceTransportTicks(
      authority,
      parseTickAdvancement(update.simulationTick - authority.tick),
    );
  });

  const client: TransportSimulationClient = {
    async connect(request) {
      if (lifecycle.state !== 'idle')
        throw new Error('Transport client can connect only from idle.');
      assertConnectShape(request);
      const nextAuthority =
        request.mode === 'new'
          ? createTransportSimulationState(
              request.scenario,
              request.initialSimulationTick,
            )
          : restoreTransportSimulationState(request.snapshot, request.scenario);
      publishLifecycle({ state: 'connecting' });
      try {
        authority = nextAuthority;
        await foundation.connect(
          request.mode === 'new'
            ? {
                mode: 'new',
                gameId: request.gameId,
                timelineId: request.timelineId,
                initialSimulationTick: authority.tick,
              }
            : {
                mode: 'restore',
                gameId: request.gameId,
                timelineId: request.timelineId,
                snapshot: createFoundationSimulationSnapshot(
                  createFoundationState(authority.tick),
                ),
              },
        );
        publishLifecycle({
          state: 'ready',
          gameId: request.gameId,
          timelineId: request.timelineId,
          scenario: createScenarioCoordinate(authority.scenario),
        });
      } catch (error) {
        authority = undefined;
        publishLifecycle({
          state: 'failed',
          code: 'invalid-worker-message',
          message:
            error instanceof Error
              ? error.message
              : 'Transport startup failed.',
        });
        throw error;
      }
    },
    sendCommand: (command) =>
      closing
        ? Promise.reject(new Error('Transport client is closed.'))
        : foundation.sendCommand(command),
    async synchronize(request) {
      const current = closing ? undefined : authority;
      if (!current) throw new Error('Transport client is not ready.');
      const response = await foundation.synchronize(request);
      return freeze({
        kind: 'transport-synchronization-response',
        foundation: response,
        scenario: createScenarioCoordinate(current.scenario),
      });
    },
    async exportSnapshot() {
      const current = closing ? undefined : authority;
      if (!current) throw new Error('Transport client is not ready.');
      const exported = await foundation.exportSnapshot();
      authority =
        exported.simulationTick === current.tick
          ? current
          : createTransportSimulationState(
              current.scenario,
              parseSimulationTick(exported.simulationTick),
            );
      return freeze({
        kind: 'transport-snapshot-export',
        gameId: exported.gameId,
        timelineId: exported.timelineId,
        commandRevision: exported.commandRevision,
        simulationTick: exported.simulationTick,
        streamOffset: exported.streamOffset,
        snapshot: createTransportSimulationSnapshot(authority),
      });
    },
    subscribeReliableUpdates: (listener) => {
      if (closing) throw new Error('Transport client is closed.');
      return foundation.subscribeReliableUpdates(listener);
    },
    subscribeRenderSnapshots: (listener) => {
      if (closing) throw new Error('Transport client is closed.');
      return foundation.subscribeRenderSnapshots(listener);
    },
    getLifecycle: () => lifecycle,
    subscribeLifecycle(listener) {
      if (closing || lifecycle.state === 'closed')
        throw new Error('Transport client is closed.');
      const registration = ++registrationSequence;
      lifecycleListeners.set(registration, listener);
      return () => lifecycleListeners.delete(registration);
    },
    getAuthoritativeState() {
      if (!authority) throw new Error('Transport client is not ready.');
      return authority;
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      authority = undefined;
      closePromise = (async () => {
        try {
          await foundation.close();
        } finally {
          authority = undefined;
          publishLifecycle({ state: 'closed' });
          lifecycleListeners.clear();
        }
      })();
      return closePromise;
    },
  };
  return Object.freeze(client);
}

export function createStructuredCloneTransportSimulationClient(): TransportSimulationClient {
  const direct = createDirectTransportSimulationClient();
  return Object.freeze({
    ...direct,
    connect: (request: TransportClientConnectRequest) =>
      direct.connect(structuredClone(request)),
    sendCommand: (command: FoundationCommandEnvelope) =>
      direct.sendCommand(structuredClone(command)),
    synchronize: (request: FoundationSynchronizationRequest) =>
      direct.synchronize(structuredClone(request)),
  });
}
