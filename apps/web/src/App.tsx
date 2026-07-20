import {
  parseClientId,
  parseCommandId,
  parseCorrelationId,
  parseSessionId,
  protocolContractVersion,
} from '@torrevieja-tycoon/protocol';
import {
  createScenarioCoordinate,
  parseVehicleId,
  scenarioCoordinatesEqual,
  simulationFoundationLabel,
  type ScenarioCoordinate,
  type VehicleState,
} from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  createFoundationSessionComposition,
  type FoundationSessionCompositionState,
} from './foundation-session-composition.js';
import { createDefaultBrowserPacingDriver } from './pacing/browser-pacing-driver.js';
import { createFoundationPacingController } from './pacing/foundation-pacing-controller.js';
import { VehicleMovementSvg } from './transport-representation/VehicleMovementSvg.js';
import { createBrowserTransportWorker } from './transport-simulation/browser-transport-worker.js';
import { createTransportFoundationApplication } from './transport-simulation/transport-foundation-application.js';
import { createDexieTransportSaveRepository } from './transport-simulation/transport-save-repository.js';
import { createWorkerTransportSimulationClient } from './transport-simulation/worker-transport-client.js';

type Actions = Readonly<{
  mode: (mode: 'paused' | 'normal' | 'fast' | 'maximum') => Promise<void>;
  bonus: () => Promise<void>;
  save: () => Promise<void>;
  restore: () => Promise<void>;
  saveMode: (mode: 'manual' | 'autosave') => Promise<void>;
  close: () => Promise<void>;
  start: () => Promise<void>;
  createVehicle: () => Promise<void>;
  startVehicle: () => Promise<void>;
}>;

const scenarioKey = (coordinate: ScenarioCoordinate) =>
  `${coordinate.scenarioSchemaVersion}:${coordinate.scenarioId}@${coordinate.scenarioVersion}#${coordinate.contentHash}`;

export function App() {
  const [state, setState] = useState<FoundationSessionCompositionState>();
  const [actions, setActions] = useState<Actions>();
  const [selectedScenario, setSelectedScenario] = useState<CanonicalScenario>();
  const [activeScenario, setActiveScenario] = useState<CanonicalScenario>();
  const [, setScenarioCacheRevision] = useState(0);
  const scenarioCache = useRef(new Map<string, CanonicalScenario>());
  const scenarioResolver = useRef<
    ((coordinate: ScenarioCoordinate) => Promise<CanonicalScenario>) | undefined
  >(undefined);
  const cacheScenario = useCallback((next: CanonicalScenario) => {
    scenarioCache.current.set(
      scenarioKey(createScenarioCoordinate(next)),
      next,
    );
    setScenarioCacheRevision((revision) => revision + 1);
  }, []);
  const handleResolverReady = useCallback(
    (
      resolve: (coordinate: ScenarioCoordinate) => Promise<CanonicalScenario>,
    ) => {
      scenarioResolver.current = async (coordinate) => {
        const resolved = await resolve(coordinate);
        cacheScenario(resolved);
        return resolved;
      };
    },
    [cacheScenario],
  );
  const handleScenarioReady = useCallback(
    (next: CanonicalScenario) => {
      cacheScenario(next);
      setSelectedScenario(next);
      setActiveScenario((current) => current ?? next);
    },
    [cacheScenario],
  );
  useEffect(() => {
    if (typeof Worker === 'undefined' || !activeScenario) return;
    let currentApplication:
      ReturnType<typeof createTransportFoundationApplication> | undefined;
    let vehicleCommandSequence = 0;
    const sendVehicleCommand = async (
      command:
        | Readonly<{
            kind: 'transport.vehicle.create';
            vehicleId: ReturnType<typeof parseVehicleId>;
            label: string;
            patternId: CanonicalScenario['routes']['routes'][number]['patterns'][number]['patternId'];
            movementPlan: Readonly<{
              kind: 'vehicle-movement-plan-v1';
              edgeTravelTicks: readonly number[];
            }>;
          }>
        | Readonly<{
            kind: 'transport.vehicle.start';
            vehicleId: ReturnType<typeof parseVehicleId>;
          }>,
    ) => {
      const application = currentApplication;
      const session = application?.projection.getState().session;
      if (!application || session?.status !== 'ready') return;
      const sequence = ++vehicleCommandSequence;
      const id = `browser-vehicle-command-${sequence}`;
      try {
        await application.sendCommand({
          kind: 'foundation-command',
          gameId: session.gameId,
          timelineId: session.timelineId,
          commandId: parseCommandId(id),
          correlationId: parseCorrelationId(id),
          clientId: parseClientId('transport-browser'),
          sessionId: parseSessionId('transport-session'),
          command,
        });
      } catch {
        // The application projection already exposes the actionable failure.
      }
    };
    const composition = createFoundationSessionComposition({
      createStack() {
        const repository = createDexieTransportSaveRepository(
          'foundation-template',
        );
        const application = createTransportFoundationApplication({
          scenario: activeScenario,
          repository,
          createClient: () =>
            createWorkerTransportSimulationClient({
              workerFactory: createBrowserTransportWorker,
            }),
          scenarioResolver: {
            resolve(coordinate) {
              const resolve = scenarioResolver.current;
              return resolve
                ? resolve(coordinate)
                : Promise.reject(
                    new Error(
                      'The exact saved scenario package is unavailable.',
                    ),
                  );
            },
          },
        });
        currentApplication = application;
        const pacing = createFoundationPacingController({ application });
        return {
          application,
          pacing,
          driver: createDefaultBrowserPacingDriver(),
        };
      },
      confirm: (message) => window.confirm(message),
      timer: {
        setInterval: (callback, milliseconds) =>
          window.setInterval(callback, milliseconds),
        clearInterval: (id) => {
          if (typeof id === 'number') window.clearInterval(id);
        },
      },
      nowUtcMs: Date.now,
    });
    const remove = composition.projection.subscribe((next) => setState(next));
    setState(composition.projection.getState());
    setActions({
      mode: composition.setMode,
      bonus: composition.grantBonus,
      save: composition.saveManual,
      restore: composition.restoreManual,
      saveMode: composition.setSaveMode,
      close: composition.closeSession,
      start: composition.startNewSession,
      createVehicle: async () => {
        const pattern = activeScenario.routes.routes[0]?.patterns[0];
        if (!pattern) return;
        const edgeCount =
          pattern.stopNodeIds.length - 1 + (pattern.closesLoop ? 1 : 0);
        await sendVehicleCommand({
          kind: 'transport.vehicle.create',
          vehicleId: parseVehicleId('browser-demo-vehicle'),
          label: 'Demo vehicle',
          patternId: pattern.patternId,
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: Array.from({ length: edgeCount }, () => 3),
          },
        });
      },
      startVehicle: () =>
        sendVehicleCommand({
          kind: 'transport.vehicle.start',
          vehicleId: parseVehicleId('browser-demo-vehicle'),
        }),
    });
    void composition.startNewSession();
    return () => {
      remove();
      void composition.dispose();
    };
  }, [activeScenario]);

  const application = state?.application;
  const pacing = state?.pacing;
  const session = application?.session;
  const status =
    typeof Worker === 'undefined'
      ? 'unavailable in this environment'
      : (session?.status ?? 'starting');
  const ready = session?.status === 'ready' && state?.operation === 'idle';
  const selectedSaveAvailable =
    state?.saveMode === 'autosave'
      ? state.autosaveSaveAvailable
      : state?.manualSaveAvailable;
  const persistenceMessage =
    application?.persistence.status === 'failed'
      ? application.persistence.message
      : undefined;
  const fleet = (
    application as
      | (typeof application & { readonly fleet?: readonly VehicleState[] })
      | undefined
  )?.fleet;
  const firstVehicle = fleet?.[0];
  const representedScenario = application?.scenario
    ? scenarioCache.current.get(scenarioKey(application.scenario))
    : undefined;
  const action = (operation: (() => Promise<void>) | undefined) => () => {
    void operation?.();
  };

  return (
    <main>
      <section aria-labelledby="foundation-title">
        <p className="eyebrow">Project foundation</p>
        <h1 id="foundation-title">Torrevieja Tycoon</h1>
        <p>
          A strict workspace for a standalone simulation and its browser client.
        </p>
        <dl aria-label="Workspace package status">
          <div>
            <dt>Simulation</dt>
            <dd>{simulationFoundationLabel}</dd>
          </div>
          <div>
            <dt>Protocol contract</dt>
            <dd>version {protocolContractVersion}</dd>
          </div>
        </dl>
        {representedScenario && fleet ? (
          <VehicleMovementSvg scenario={representedScenario} fleet={fleet} />
        ) : null}
        <div aria-label="Authoritative transport Worker status">
          <p data-testid="worker-status">Worker status: {status}</p>
          <p data-testid="worker-tick">
            Worker tick:{' '}
            {application?.authoritative?.simulationTick ?? 'pending'}
          </p>
          <p data-testid="worker-timeline">
            Timeline:{' '}
            {session?.status === 'ready' ? session.timelineId : 'pending'}
          </p>
          <p data-testid="command-revision">
            Command revision:{' '}
            {application?.authoritative?.commandRevision ?? 'pending'}
          </p>
          <p data-testid="stream-offset">
            Stream offset:{' '}
            {application?.authoritative?.streamOffset ?? 'pending'}
          </p>
          <p data-testid="scenario-coordinate">
            Scenario coordinate:{' '}
            {application?.scenario
              ? `${application.scenario.scenarioSchemaVersion}:${application.scenario.scenarioId}@${application.scenario.scenarioVersion}#${application.scenario.contentHash}`
              : 'pending'}
          </p>
          <p data-testid="selected-scenario">
            Selected scenario:{' '}
            {selectedScenario?.manifest.scenarioId ?? 'pending'}
          </p>
          <p data-testid="active-scenario">
            Active authoritative scenario:{' '}
            {application?.scenario?.scenarioId ?? 'pending'}
          </p>
          <div aria-label="Vehicle diagnostics">
            <button disabled={!ready} onClick={action(actions?.createVehicle)}>
              Create demo vehicle
            </button>
            <button disabled={!ready} onClick={action(actions?.startVehicle)}>
              Start demo vehicle
            </button>
            <p data-testid="vehicle-count">
              Vehicle count: {fleet?.length ?? 0}
            </p>
            <p data-testid="vehicle-id">
              Vehicle: {firstVehicle?.vehicleId ?? 'none'}
            </p>
            <p data-testid="vehicle-pattern">
              Pattern: {firstVehicle?.patternId ?? 'none'}
            </p>
            <p data-testid="vehicle-movement">
              Movement: {firstVehicle?.movement.kind ?? 'none'}
            </p>
            <p data-testid="vehicle-location">
              Location:{' '}
              {firstVehicle?.movement.kind === 'running-on-edge'
                ? firstVehicle.movement.edgeId
                : (firstVehicle?.movement.stopNodeId ?? 'none')}
            </p>
            <p data-testid="vehicle-progress">
              Progress:{' '}
              {firstVehicle?.movement.kind === 'running-on-edge'
                ? `${firstVehicle.movement.progressTicks}/${firstVehicle.movement.travelTicks}`
                : 'not-on-edge'}
            </p>
          </div>
          <div aria-label="Foundation pacing controls">
            <button
              disabled={!ready}
              onClick={action(
                () => actions?.mode('paused') ?? Promise.resolve(),
              )}
            >
              Pause
            </button>
            <button
              disabled={!ready}
              onClick={action(
                () => actions?.mode('normal') ?? Promise.resolve(),
              )}
            >
              Normal 20×
            </button>
            <button
              disabled={!ready}
              onClick={action(() => actions?.mode('fast') ?? Promise.resolve())}
            >
              Fast 50×
            </button>
            <button
              disabled={!ready}
              onClick={action(
                () => actions?.mode('maximum') ?? Promise.resolve(),
              )}
            >
              Maximum 60×
            </button>
            <button disabled={!ready} onClick={action(actions?.bonus)}>
              Grant demo 2× bonus
            </button>
            <p data-testid="pacing-rate">
              Effective rate: {pacing?.effectiveRate ?? 0}×
            </p>
            <p data-testid="pacing-status">
              Pacing status: {pacing?.status ?? 'idle'}
              {pacing?.message ? `: ${pacing.message}` : ''}
            </p>
            <p data-testid="bonus-ticks">
              Bonus ticks remaining:{' '}
              {pacing?.remainingDoubleSpeedBonusTicks ?? 0}
            </p>
            <p data-testid="pacing-credit">
              Pacing credit: {pacing?.creditGameMicroseconds ?? 0}
            </p>
            <fieldset>
              <legend>Save mode</legend>
              <label>
                <input
                  type="radio"
                  name="save-mode"
                  checked={(state?.saveMode ?? 'manual') === 'manual'}
                  disabled={!actions || state?.operation !== 'idle'}
                  onChange={action(
                    () => actions?.saveMode('manual') ?? Promise.resolve(),
                  )}
                />
                Manual
              </label>
              <label>
                <input
                  type="radio"
                  name="save-mode"
                  checked={state?.saveMode === 'autosave'}
                  disabled={!actions || state?.operation !== 'idle'}
                  onChange={action(
                    () => actions?.saveMode('autosave') ?? Promise.resolve(),
                  )}
                />
                Autosave
              </label>
            </fieldset>
            <button disabled={!ready} onClick={action(actions?.save)}>
              {state?.saveMode === 'autosave'
                ? 'Save autosave now'
                : 'Save transport session'}
            </button>
            <button
              disabled={!ready || !selectedSaveAvailable}
              onClick={action(actions?.restore)}
            >
              {state?.saveMode === 'autosave'
                ? 'Restore autosave'
                : 'Restore manual save'}
            </button>
            <p data-testid="manual-save-availability">
              Manual save:{' '}
              {state?.manualSaveAvailable ? 'available' : 'not available'}
            </p>
            <p data-testid="autosave-availability">
              Autosave:{' '}
              {state?.autosaveSaveAvailable ? 'available' : 'not available'}
            </p>
            <p data-testid="save-count">
              Saved sessions: {application?.persistence.saves.length ?? 0}
            </p>
            <p data-testid="legacy-save-count">
              Legacy incompatible saves:{' '}
              {application?.persistence.saves.filter(
                (save) => save.compatibility === 'legacy-incompatible',
              ).length ?? 0}
            </p>
            <p data-testid="persistence-status">
              Persistence status: {application?.persistence.status ?? 'idle'}
              {persistenceMessage ? `: ${persistenceMessage}` : ''}
            </p>
            {state?.message ? (
              <p role="alert">Session action failed: {state.message}</p>
            ) : null}
          </div>
          {state?.canStartNewSession ? (
            <button
              type="button"
              onClick={action(async () => {
                if (
                  selectedScenario &&
                  activeScenario &&
                  !scenarioCoordinatesEqual(
                    createScenarioCoordinate(selectedScenario),
                    createScenarioCoordinate(activeScenario),
                  )
                ) {
                  setActiveScenario(selectedScenario);
                  return;
                }
                await actions?.start();
              })}
            >
              Start new transport session
            </button>
          ) : (
            <button
              type="button"
              disabled={!actions || state?.operation === 'closing'}
              onClick={action(actions?.close)}
            >
              Close transport Worker
            </button>
          )}
        </div>
      </section>
      <Suspense fallback={<p>Loading scenario catalogue…</p>}>
        <ScenarioPanel
          onResolverReady={handleResolverReady}
          onScenarioReady={handleScenarioReady}
        />
      </Suspense>
      <Suspense fallback={<p>Loading representation…</p>}>
        <FoundationScene />
      </Suspense>
    </main>
  );
}

const FoundationScene = lazy(() => import('./foundation-scene.js'));
const ScenarioPanel = lazy(() =>
  import('./scenarios/ScenarioPanel.js').then(({ ScenarioPanel }) => ({
    default: ScenarioPanel,
  })),
);
