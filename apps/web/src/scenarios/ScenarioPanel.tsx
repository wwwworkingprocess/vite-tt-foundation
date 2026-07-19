import { useEffect, useRef, useState } from 'react';
import {
  createScenarioCoordinate,
  scenarioCoordinatesEqual,
} from '@torrevieja-tycoon/simulation';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import {
  createBrowserTransportWorker,
  isBrowserTransportWorkerAvailable,
} from '../transport-simulation/browser-transport-worker.js';
import {
  createTransportApplicationController,
  type TransportApplicationProjection,
} from '../transport-simulation/transport-controller.js';
import {
  createDexieTransportSaveRepository,
  type TransportSaveRepository,
} from '../transport-simulation/transport-save-repository.js';
import { createWorkerTransportSimulationClient } from '../transport-simulation/worker-transport-client.js';
import {
  browserSha256,
  createScenarioLoader,
  type ScenarioLoaderState,
} from './scenario-loader.js';

const fetchText = async (url: string) => {
  const response = await fetch(url);
  return { ok: response.ok, text: () => response.text() };
};

export function ScenarioPanel() {
  const [state, setState] = useState<ScenarioLoaderState>({ status: 'idle' });
  const [loader] = useState(() =>
    createScenarioLoader({
      baseUrl: import.meta.env.BASE_URL,
      fetchText,
      digestSha256: browserSha256,
    }),
  );
  const [authority, setAuthority] = useState<TransportApplicationProjection>({
    status: 'idle',
  });
  const controllerRef = useRef<
    ReturnType<typeof createTransportApplicationController> | undefined
  >(undefined);
  const repositoryRef = useRef<TransportSaveRepository | undefined>(undefined);
  const restoreSequenceRef = useRef(0);
  useEffect(() => {
    const remove = loader.projection.subscribe((next) => setState(next));
    void loader.loadCatalog().then(() => {
      const first = loader.projection.getState().catalog?.scenarios[0];
      if (first) void loader.loadScenario(first.scenarioId);
    });
    return () => {
      remove();
      void controllerRef.current?.close();
      void repositoryRef.current?.close();
    };
  }, [loader]);
  const startSelected = async () => {
    const selected = loader.projection.getState().scenario;
    if (!selected || !isBrowserTransportWorkerAvailable()) return;
    const repository = createDexieTransportSaveRepository(
      'transport-simulation',
    );
    const controller = createTransportApplicationController({
      repository,
      createClient: () =>
        createWorkerTransportSimulationClient({
          workerFactory: createBrowserTransportWorker,
        }),
      scenarioResolver: {
        async resolve(coordinate) {
          const current = loader.projection.getState().scenario;
          if (
            current &&
            scenarioCoordinatesEqual(
              createScenarioCoordinate(current),
              coordinate,
            )
          )
            return current;
          await loader.loadScenario(coordinate.scenarioId);
          const resolved = loader.projection.getState().scenario;
          if (
            !resolved ||
            !scenarioCoordinatesEqual(
              createScenarioCoordinate(resolved),
              coordinate,
            )
          )
            throw new Error('The exact saved scenario package is unavailable.');
          return resolved;
        },
      },
    });
    repositoryRef.current = repository;
    controllerRef.current = controller;
    controller.projection.subscribe(setAuthority);
    await controller.startNew({
      gameId: parseGameId('browser-transport-game'),
      timelineId: parseTimelineId('browser-transport-timeline'),
      scenario: selected,
    });
  };
  const transportAction = (action: () => Promise<void>) => () => {
    void action().catch(() => undefined);
  };
  const graph = state.graph;
  return (
    <section aria-labelledby="scenario-title">
      <h2 id="scenario-title">Transport scenario</h2>
      <p data-testid="scenario-status">
        Scenario status: {state.status}
        {state.message ? `: ${state.message}` : ''}
      </p>
      <label>
        Scenario
        <select
          value={state.selectedScenarioId ?? ''}
          disabled={!state.catalog || state.status === 'loading-scenario'}
          onChange={(event) => {
            void loader.loadScenario(event.target.value);
          }}
        >
          <option value="" disabled>
            Select a scenario
          </option>
          {state.catalog?.scenarios.map((scenario) => (
            <option key={scenario.scenarioId} value={scenario.scenarioId}>
              {scenario.title}
            </option>
          ))}
        </select>
      </label>
      {graph ? (
        <dl aria-label="Scenario graph summary">
          <div>
            <dt>Selected scenario</dt>
            <dd>{state.title}</dd>
          </div>
          <div>
            <dt>Settlements</dt>
            <dd>{state.settlementCount}</dd>
          </div>
          <div>
            <dt>Stop nodes</dt>
            <dd>{graph.summary.nodes}</dd>
          </div>
          <div>
            <dt>Routes</dt>
            <dd>{state.routeCount}</dd>
          </div>
          <div>
            <dt>Patterns</dt>
            <dd>{graph.summary.patterns}</dd>
          </div>
          <div>
            <dt>Directed edges</dt>
            <dd>{graph.summary.edges}</dd>
          </div>
        </dl>
      ) : null}
      <div aria-label="Authoritative transport session">
        <p data-testid="transport-authority-status">
          Authoritative scenario status: {authority.status}
        </p>
        {authority.scenario ? (
          <p data-testid="transport-authority-coordinate">
            Authoritative scenario: {authority.scenario.scenarioId}@
            {authority.scenario.scenarioVersion} (
            {authority.scenario.contentHash.slice(0, 8)})
          </p>
        ) : null}
        <p data-testid="transport-authority-tick">
          Authoritative transport tick: {authority.simulationTick ?? 'pending'}
        </p>
        {authority.status === 'idle' ||
        authority.status === 'closed' ||
        authority.status === 'failed' ? (
          <button
            disabled={!state.scenario || !isBrowserTransportWorkerAvailable()}
            onClick={transportAction(startSelected)}
          >
            Start selected scenario
          </button>
        ) : (
          <>
            <button
              disabled={authority.status !== 'ready'}
              onClick={transportAction(
                () =>
                  controllerRef.current?.advanceTicks(1) ?? Promise.resolve(),
              )}
            >
              Advance selected scenario
            </button>
            <button
              disabled={authority.status !== 'ready'}
              onClick={transportAction(
                () =>
                  controllerRef.current?.save({
                    saveId: 'transport-slot',
                    label: 'Transport save',
                    createdAtUtcMs: Date.now(),
                    updatedAtUtcMs: Date.now(),
                  }) ?? Promise.resolve(),
              )}
            >
              Save selected scenario
            </button>
            <button
              disabled={authority.status !== 'ready'}
              onClick={transportAction(
                () =>
                  controllerRef.current?.restore({
                    saveId: 'transport-slot',
                    timelineId: parseTimelineId(
                      `browser-transport-restored-${++restoreSequenceRef.current}`,
                    ),
                  }) ?? Promise.resolve(),
              )}
            >
              Restore selected scenario
            </button>
            <button
              onClick={transportAction(
                () => controllerRef.current?.close() ?? Promise.resolve(),
              )}
            >
              Close selected scenario
            </button>
          </>
        )}
        {authority.message ? <p role="alert">{authority.message}</p> : null}
      </div>
    </section>
  );
}
