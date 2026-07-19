import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import { type ScenarioCoordinate } from '@torrevieja-tycoon/simulation';
import {
  parseGameId,
  parseClientId,
  parseCommandId,
  parseCorrelationId,
  parseSessionId,
  parseTimelineId,
  type GameId,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';
import {
  classifyPersistedSaveRecord,
  parseTransportSaveRecord,
  type TransportSaveRecord,
} from './transport-save-record.js';
import type {
  TransportSimulationClient,
  TransportSnapshotExport,
} from './transport-client.js';

export interface ScenarioResolver {
  resolve(coordinate: ScenarioCoordinate): Promise<CanonicalScenario>;
}

export interface TransportSaveRepositoryPort {
  get(saveId: string): Promise<unknown>;
  put(record: TransportSaveRecord): Promise<void>;
}

export interface TransportApplicationProjection {
  readonly status:
    'idle' | 'starting' | 'ready' | 'restoring' | 'failed' | 'closed';
  readonly gameId?: GameId | undefined;
  readonly timelineId?: TimelineId | undefined;
  readonly scenario?: ScenarioCoordinate | undefined;
  readonly simulationTick?: number | undefined;
  readonly commandRevision?: number | undefined;
  readonly streamOffset?: number | undefined;
  readonly message?: string | undefined;
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Transport operation failed.';

export function createTransportApplicationController(input: {
  readonly createClient: () => TransportSimulationClient;
  readonly repository: TransportSaveRepositoryPort;
  readonly scenarioResolver: ScenarioResolver;
}) {
  let state = freeze<TransportApplicationProjection>({ status: 'idle' });
  let client: TransportSimulationClient | undefined;
  let generation = 0;
  let listenerSequence = 0;
  let commandSequence = 0;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const listeners = new Map<
    number,
    (state: TransportApplicationProjection) => void
  >();
  const set = (next: TransportApplicationProjection) => {
    state = freeze(next);
    for (const listener of [...listeners.values()])
      try {
        listener(state);
      } catch {
        // Projection listeners cannot affect controller operations.
      }
  };
  const readyFrom = async (
    next: TransportSimulationClient,
    gameId: GameId,
    timelineId: TimelineId,
    token: number,
  ) => {
    const exported = await next.exportSnapshot();
    if (token !== generation || closed) {
      await next.close();
      return;
    }
    client = next;
    set({
      status: 'ready',
      gameId,
      timelineId,
      scenario: exported.snapshot.scenario,
      simulationTick: exported.simulationTick,
      commandRevision: exported.commandRevision,
      streamOffset: exported.streamOffset,
    });
  };

  const controller = {
    projection: Object.freeze({
      getState: () => state,
      subscribe(listener: (state: TransportApplicationProjection) => void) {
        const registration = ++listenerSequence;
        listeners.set(registration, listener);
        return () => listeners.delete(registration);
      },
    }),
    async startNew(request: {
      gameId: GameId;
      timelineId: TimelineId;
      scenario: CanonicalScenario;
      initialSimulationTick?: number;
    }) {
      if (closed || client)
        throw new Error('Transport session is unavailable.');
      const token = ++generation;
      set({ status: 'starting' });
      const next = input.createClient();
      try {
        const gameId = parseGameId(request.gameId);
        const timelineId = parseTimelineId(request.timelineId);
        await next.connect({
          kind: 'transport-client-connect',
          contractVersion: 1,
          mode: 'new',
          gameId,
          timelineId,
          initialSimulationTick: request.initialSimulationTick ?? 0,
          scenario: request.scenario,
        });
        await readyFrom(next, gameId, timelineId, token);
      } catch (error) {
        await next.close().catch(() => undefined);
        if (token === generation)
          set({ status: 'failed', message: message(error) });
        throw error;
      }
    },
    async restore(request: { saveId: string; timelineId: TimelineId }) {
      if (closed || !client || state.status !== 'ready')
        throw new Error('No ready transport session.');
      const previous = client;
      const previousState = state;
      const token = ++generation;
      try {
        const raw = await input.repository.get(request.saveId);
        if (raw === undefined) throw new Error('Save was not found.');
        const classified = classifyPersistedSaveRecord(raw);
        if (classified.classification === 'legacy-foundation')
          throw new Error(
            'This save belongs to the foundation version and is incompatible.',
          );
        if (classified.classification !== 'current') throw classified.error;
        const record = classified.record;
        const scenario = await input.scenarioResolver.resolve(record.scenario);
        if (token !== generation || closed) return;
        set({ ...previousState, status: 'restoring', message: undefined });
        client = undefined;
        await previous.close();
        const next = input.createClient();
        const timelineId = parseTimelineId(request.timelineId);
        await next.connect({
          kind: 'transport-client-connect',
          contractVersion: 1,
          mode: 'restore',
          gameId: record.gameId,
          timelineId,
          scenario,
          snapshot: record.snapshot,
        });
        await readyFrom(next, record.gameId, timelineId, token);
      } catch (error) {
        if (client === previous && token === generation)
          set({ ...previousState, message: message(error) });
        else if (token === generation)
          set({ status: 'failed', message: message(error) });
        throw error;
      }
    },
    async save(metadata: {
      saveId: string;
      label?: string;
      createdAtUtcMs: number;
      updatedAtUtcMs: number;
    }) {
      if (!client || state.status !== 'ready')
        throw new Error('No ready transport session.');
      try {
        const exported: TransportSnapshotExport = await client.exportSnapshot();
        const record = parseTransportSaveRecord({
          kind: 'transport-save-record',
          schemaVersion: 1,
          ...metadata,
          gameId: exported.gameId,
          sourceTimelineId: exported.timelineId,
          sourceCommandRevision: exported.commandRevision,
          sourceSimulationTick: exported.simulationTick,
          sourceStreamOffset: exported.streamOffset,
          scenario: exported.snapshot.scenario,
          snapshot: exported.snapshot,
        });
        await input.repository.put(record);
        set({ ...state, message: undefined });
      } catch (error) {
        set({ ...state, message: message(error) });
        throw error;
      }
    },
    async advanceTicks(count: number) {
      if (
        !client ||
        state.status !== 'ready' ||
        !state.gameId ||
        !state.timelineId
      )
        throw new Error('No ready transport session.');
      const id = `transport-pacing-${++commandSequence}`;
      await client.sendCommand({
        kind: 'foundation-command',
        gameId: state.gameId,
        timelineId: state.timelineId,
        commandId: parseCommandId(id),
        correlationId: parseCorrelationId(id),
        clientId: parseClientId('transport-browser'),
        sessionId: parseSessionId('transport-session'),
        command: { type: 'foundation.advance-ticks', count },
      });
      const exported = await client.exportSnapshot();
      set({
        ...state,
        simulationTick: exported.simulationTick,
        commandRevision: exported.commandRevision,
        streamOffset: exported.streamOffset,
        message: undefined,
      });
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      generation += 1;
      const current = client;
      client = undefined;
      closePromise = (async () => {
        try {
          await current?.close();
        } finally {
          set({ status: 'closed' });
          listeners.clear();
        }
      })();
      return closePromise;
    },
  };
  return Object.freeze(controller);
}
