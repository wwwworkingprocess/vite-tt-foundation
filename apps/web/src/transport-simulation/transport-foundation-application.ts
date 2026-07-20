import { createStore } from 'zustand/vanilla';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import type { VehicleState } from '@torrevieja-tycoon/simulation';
import type { FoundationApplicationState } from '../application/foundation-controller.js';
import type { TransportSaveSummary } from './transport-save-record.js';
import type { TransportSaveRepository } from './transport-save-repository.js';
import {
  createTransportApplicationController,
  type ScenarioResolver,
  type TransportApplicationProjection,
} from './transport-controller.js';
import type { TransportSimulationClient } from './transport-client.js';

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};
const empty = Object.freeze([]) as readonly TransportSaveSummary[];
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
type TransportFoundationApplicationState = FoundationApplicationState &
  Readonly<{ fleet?: readonly VehicleState[] | undefined }>;

export function createTransportFoundationApplication(input: {
  readonly scenario: CanonicalScenario;
  readonly repository: TransportSaveRepository;
  readonly createClient: () => TransportSimulationClient;
  readonly scenarioResolver: ScenarioResolver;
}) {
  const transport = createTransportApplicationController(input);
  const store = createStore<TransportFoundationApplicationState>(() =>
    freeze({
      session: { status: 'idle' },
      synchronization: { status: 'idle' },
      persistence: { status: 'idle', saves: empty },
    }),
  );
  let persistence: FoundationApplicationState['persistence'] = freeze({
    status: 'idle',
    saves: empty,
  });
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const closedError = () =>
    new Error('Transport foundation application is closed.');
  const assertOpen = () => {
    if (closed) throw closedError();
  };
  const publishTransport = (state: TransportApplicationProjection) => {
    const next: TransportFoundationApplicationState =
      state.status === 'ready'
        ? {
            session: {
              status: 'ready',
              gameId: state.gameId!,
              timelineId: state.timelineId!,
            },
            scenario: state.scenario!,
            authoritative: {
              commandRevision: state.commandRevision!,
              simulationTick: state.simulationTick!,
              streamOffset: state.streamOffset!,
            },
            synchronization: { status: 'synchronized' },
            persistence,
            fleet: state.fleet!,
          }
        : {
            session:
              state.status === 'failed'
                ? { status: 'failed', message: state.message! }
                : { status: state.status },
            synchronization: { status: 'idle' },
            persistence,
          };
    store.setState(freeze(next), true);
  };
  const publishPersistence = (
    next: FoundationApplicationState['persistence'],
  ) => {
    persistence = freeze(next);
    publishTransport(transport.projection.getState());
  };
  const remove = transport.projection.subscribe(publishTransport);
  const listSaves = async () => {
    assertOpen();
    try {
      const classified = await input.repository.list();
      const saves = classified.flatMap((item) =>
        item.classification === 'current' ||
        item.classification === 'migratable-transport-v1' ||
        item.classification === 'legacy-foundation'
          ? [item.summary]
          : [],
      );
      if (!closed) publishPersistence({ status: 'idle', saves });
      return saves;
    } catch (error) {
      if (!closed)
        publishPersistence({
          status: 'failed',
          saves: persistence.saves,
          message: errorMessage(error, 'Persistence failed.'),
        });
      throw error;
    }
  };
  const application = {
    projection: Object.freeze({
      getState: store.getState,
      subscribe: store.subscribe,
    }),
    startNew(request: {
      gameId: Parameters<typeof transport.startNew>[0]['gameId'];
      timelineId: Parameters<typeof transport.startNew>[0]['timelineId'];
      initialSimulationTick: number;
    }) {
      if (closed) return Promise.reject(closedError());
      return transport.startNew({ ...request, scenario: input.scenario });
    },
    sendCommand(command: Parameters<typeof transport.sendCommand>[0]) {
      if (closed) return Promise.reject(closedError());
      return transport.sendCommand(command);
    },
    listSaves,
    async save(metadata: Parameters<typeof transport.save>[0]) {
      assertOpen();
      publishPersistence({ status: 'saving', saves: persistence.saves });
      try {
        await transport.save(metadata);
        await listSaves();
      } catch (error) {
        if (!closed)
          publishPersistence({
            status: 'failed',
            saves: persistence.saves,
            message: errorMessage(error, 'Save failed.'),
          });
        throw error;
      }
    },
    async restore(request: {
      saveId: string;
      newTimelineId: Parameters<typeof transport.restore>[0]['timelineId'];
    }) {
      assertOpen();
      publishPersistence({ status: 'restoring', saves: persistence.saves });
      try {
        await transport.restore({
          saveId: request.saveId,
          timelineId: request.newTimelineId,
        });
        await listSaves();
      } catch (error) {
        if (!closed)
          publishPersistence({
            status: 'failed',
            saves: persistence.saves,
            message: errorMessage(error, 'Restore failed.'),
          });
        throw error;
      }
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      remove();
      closePromise = (async () => {
        try {
          await transport.close();
        } finally {
          persistence = freeze({ status: 'idle', saves: persistence.saves });
          store.setState(
            freeze({
              session: { status: 'closed' },
              synchronization: { status: 'idle' },
              persistence,
            }),
            true,
          );
        }
      })();
      return closePromise;
    },
  };
  return Object.freeze(application);
}
