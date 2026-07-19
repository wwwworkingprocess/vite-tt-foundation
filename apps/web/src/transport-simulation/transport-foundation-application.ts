import { createStore } from 'zustand/vanilla';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import type { FoundationApplicationState } from '../application/foundation-controller.js';
import type { TransportSaveSummary } from './transport-save-record.js';
import type { TransportSaveRepository } from './transport-save-repository.js';
import {
  createTransportApplicationController,
  type ScenarioResolver,
} from './transport-controller.js';
import type { TransportSimulationClient } from './transport-client.js';

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};
const empty = Object.freeze([]) as readonly TransportSaveSummary[];

export function createTransportFoundationApplication(input: {
  readonly scenario: CanonicalScenario;
  readonly repository: TransportSaveRepository;
  readonly createClient: () => TransportSimulationClient;
  readonly scenarioResolver: ScenarioResolver;
}) {
  const transport = createTransportApplicationController({
    createClient: input.createClient,
    repository: input.repository,
    scenarioResolver: input.scenarioResolver,
  });
  const store = createStore<FoundationApplicationState>(() =>
    freeze({
      session: { status: 'idle' },
      synchronization: { status: 'idle' },
      persistence: { status: 'idle', saves: empty },
    }),
  );
  const set = (patch: Partial<FoundationApplicationState>) =>
    store.setState(freeze({ ...store.getState(), ...patch }), true);
  const remove = transport.projection.subscribe((state) => {
    const session: FoundationApplicationState['session'] =
      state.status === 'ready'
        ? {
            status: 'ready',
            gameId: state.gameId!,
            timelineId: state.timelineId!,
          }
        : state.status === 'failed'
          ? { status: 'failed', message: state.message! }
          : { status: state.status };
    set({
      session,
      ...(state.status === 'ready'
        ? {
            authoritative: {
              commandRevision: state.commandRevision!,
              simulationTick: state.simulationTick!,
              streamOffset: state.streamOffset!,
            },
            synchronization: { status: 'synchronized' },
          }
        : {}),
    });
  });
  const listSaves = async () => {
    try {
      const classified = await input.repository.list();
      const saves = classified.flatMap((item) =>
        item.classification === 'current' ||
        item.classification === 'legacy-foundation'
          ? [item.summary]
          : [],
      );
      set({ persistence: { status: 'idle', saves } });
      return saves;
    } catch (error) {
      set({
        persistence: {
          status: 'failed',
          saves: store.getState().persistence.saves,
          message:
            error instanceof Error ? error.message : 'Persistence failed.',
        },
      });
      throw error;
    }
  };
  return Object.freeze({
    projection: Object.freeze({
      getState: store.getState,
      subscribe: store.subscribe,
    }),
    startNew(request: {
      gameId: Parameters<typeof transport.startNew>[0]['gameId'];
      timelineId: Parameters<typeof transport.startNew>[0]['timelineId'];
      initialSimulationTick: number;
    }) {
      return transport.startNew({ ...request, scenario: input.scenario });
    },
    sendCommand: transport.sendCommand,
    listSaves,
    async save(metadata: Parameters<typeof transport.save>[0]) {
      set({
        persistence: {
          status: 'saving',
          saves: store.getState().persistence.saves,
        },
      });
      await transport.save(metadata);
      await listSaves();
    },
    async restore(request: {
      saveId: string;
      newTimelineId: Parameters<typeof transport.restore>[0]['timelineId'];
    }) {
      set({
        persistence: {
          status: 'restoring',
          saves: store.getState().persistence.saves,
        },
      });
      await transport.restore({
        saveId: request.saveId,
        timelineId: request.newTimelineId,
      });
      await listSaves();
    },
    async close() {
      remove();
      await transport.close();
      set({ session: { status: 'closed' } });
    },
  });
}
