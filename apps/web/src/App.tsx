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
  type FoundationSaveMode,
  type FoundationSessionCompositionState,
} from './foundation-session-composition.js';
import { createDefaultBrowserPacingDriver } from './pacing/browser-pacing-driver.js';
import { createFoundationPacingController } from './pacing/foundation-pacing-controller.js';
import { VehicleMovementSvg } from './transport-representation/VehicleMovementSvg.js';
import { createDemoVehicleCommandForAuthority } from './transport-representation/demo-vehicle-command.js';
import { createBrowserTransportWorker } from './transport-simulation/browser-transport-worker.js';
import { createTransportFoundationApplication } from './transport-simulation/transport-foundation-application.js';
import { createDexieTransportSaveRepository } from './transport-simulation/transport-save-repository.js';
import { createWorkerTransportSimulationClient } from './transport-simulation/worker-transport-client.js';
import type { ScenarioSelectionState } from './scenarios/ScenarioPanel.js';

type Actions = Readonly<{
  mode: (mode: 'paused' | 'normal' | 'fast' | 'maximum') => Promise<void>;
  bonus: () => Promise<void>;
  save: () => Promise<void>;
  restore: () => Promise<void>;
  restoreSave: (saveId: string) => Promise<void>;
  saveMode: (mode: 'manual' | 'autosave') => Promise<void>;
  close: () => Promise<void>;
  start: () => Promise<void>;
  createVehicle: () => Promise<void>;
  startVehicle: (vehicleId: string) => Promise<void>;
}>;

const scenarioKey = (coordinate: ScenarioCoordinate) =>
  `${coordinate.scenarioSchemaVersion}:${coordinate.scenarioId}@${coordinate.scenarioVersion}#${coordinate.contentHash}`;

export function App() {
  const [state, setState] = useState<FoundationSessionCompositionState>();
  const [actions, setActions] = useState<Actions>();
  const [selectedScenario, setSelectedScenario] = useState<CanonicalScenario>();
  const [scenarioSelection, setScenarioSelection] =
    useState<ScenarioSelectionState>({ status: 'idle' });
  const [stackSeedScenario, setStackSeedScenario] =
    useState<CanonicalScenario>();
  const [browserActionMessage, setBrowserActionMessage] = useState<string>();
  const [, setScenarioCacheRevision] = useState(0);
  const scenarioCache = useRef(new Map<string, CanonicalScenario>());
  const scenarioResolver = useRef<
    ((coordinate: ScenarioCoordinate) => Promise<CanonicalScenario>) | undefined
  >(undefined);
  const saveMode = useRef<FoundationSaveMode>('manual');
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
    },
    [cacheScenario],
  );
  const handleSelectionChange = useCallback(
    (next: ScenarioSelectionState) => {
      setScenarioSelection(next);
      if (next.status === 'ready' && next.scenario) {
        cacheScenario(next.scenario);
        setSelectedScenario(next.scenario);
        setStackSeedScenario((current) => current ?? next.scenario);
      }
    },
    [cacheScenario],
  );
  useEffect(() => {
    if (typeof Worker === 'undefined' || !stackSeedScenario) return;
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
          scenario: stackSeedScenario,
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
      initialSaveMode: saveMode.current,
      timer: {
        setInterval: (callback, milliseconds) =>
          window.setInterval(callback, milliseconds),
        clearInterval: (id) => {
          if (typeof id === 'number') window.clearInterval(id);
        },
      },
      nowUtcMs: Date.now,
      scenarioTitle: (scenarioId) =>
        [...scenarioCache.current.values()].find(
          (scenario) => scenario.manifest.scenarioId === scenarioId,
        )?.manifest.title,
    });
    const remove = composition.projection.subscribe((next) => {
      saveMode.current = next.saveMode;
      setState(next);
    });
    setState(composition.projection.getState());
    setActions({
      mode: composition.setMode,
      bonus: composition.grantBonus,
      save: composition.saveManual,
      restore: composition.restoreManual,
      restoreSave: composition.restoreSave,
      saveMode: composition.setSaveMode,
      close: composition.closeSession,
      start: composition.startNewSession,
      createVehicle: async () => {
        const coordinate = currentApplication?.projection.getState().scenario;
        if (!coordinate) return;
        try {
          const command = createDemoVehicleCommandForAuthority(
            coordinate,
            (current) => scenarioCache.current.get(scenarioKey(current)),
            currentApplication?.projection.getState().fleet ?? [],
          );
          setBrowserActionMessage(undefined);
          await sendVehicleCommand(command);
        } catch (error) {
          setBrowserActionMessage(
            error instanceof Error
              ? error.message
              : 'The demo vehicle could not be created.',
          );
        }
      },
      startVehicle: (vehicleId) =>
        sendVehicleCommand({
          kind: 'transport.vehicle.start',
          vehicleId: parseVehicleId(vehicleId),
        }),
    });
    void composition.startNewSession();
    return () => {
      remove();
      void composition.dispose();
    };
  }, [stackSeedScenario]);

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
          <p data-testid="requested-scenario">
            Requested scenario:{' '}
            {scenarioSelection.requestedScenarioId ?? 'pending'} (
            {scenarioSelection.status})
          </p>
          <p data-testid="active-scenario">
            Active authoritative scenario:{' '}
            {application?.scenario?.scenarioId ?? 'pending'}
          </p>
          <div aria-label="Vehicle diagnostics">
            <button disabled={!ready} onClick={action(actions?.createVehicle)}>
              Create demo vehicle
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
            <div data-testid="vehicle-list" aria-label="Authoritative fleet">
              {fleet?.map((vehicle) => {
                const movement = vehicle.movement;
                const onEdge = movement.kind === 'running-on-edge';
                return (
                  <div
                    key={vehicle.vehicleId}
                    data-testid={`vehicle-row-${vehicle.vehicleId}`}
                    data-vehicle-id={vehicle.vehicleId}
                    data-pattern-id={vehicle.patternId}
                    data-plan-travel-ticks={vehicle.movementPlan.edgeTravelTicks.join(
                      ',',
                    )}
                    data-movement-kind={movement.kind}
                    data-stop-id={onEdge ? undefined : movement.stopNodeId}
                    data-edge-id={onEdge ? movement.edgeId : undefined}
                    data-edge-sequence={
                      onEdge ? movement.edgeSequence : undefined
                    }
                    data-progress-numerator={
                      onEdge ? movement.progressTicks : undefined
                    }
                    data-progress-denominator={
                      onEdge ? movement.travelTicks : undefined
                    }
                  >
                    <span>{vehicle.vehicleId}</span>{' '}
                    <span>{vehicle.patternId}</span>{' '}
                    <span>{movement.kind}</span>{' '}
                    <span>
                      {onEdge
                        ? `${movement.edgeId} ${movement.progressTicks}/${movement.travelTicks}`
                        : movement.stopNodeId}
                    </span>{' '}
                    {movement.kind === 'parked-at-stop' ? (
                      <button
                        disabled={!ready}
                        onClick={action(
                          () =>
                            actions?.startVehicle(vehicle.vehicleId) ??
                            Promise.resolve(),
                        )}
                      >
                        Start {vehicle.vehicleId}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
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
            <div data-testid="save-library" aria-label="Save library">
              {application?.persistence.saves.map((save) => {
                const title = save.scenarioId
                  ? ([...scenarioCache.current.values()].find(
                      (scenario) =>
                        scenario.manifest.scenarioId === save.scenarioId,
                    )?.manifest.title ?? save.scenarioId)
                  : 'Legacy Foundation save';
                const restorable =
                  save.compatibility === 'current' ||
                  save.compatibility === 'migratable';
                return (
                  <div key={save.saveId} data-save-id={save.saveId}>
                    <span>{title}</span>{' '}
                    <span>{save.scenarioId ?? 'foundation'}</span>{' '}
                    <span>{save.scenarioSchemaVersion ?? 'legacy'}</span>{' '}
                    <span>{save.scenarioVersion ?? 'legacy'}</span>{' '}
                    <span>{save.contentHash?.slice(0, 8) ?? 'no-hash'}</span>{' '}
                    <span>{save.label ?? 'Saved session'}</span>{' '}
                    <span>tick {save.sourceSimulationTick}</span>{' '}
                    <span>vehicles {save.authoritativeEntityCount ?? 0}</span>{' '}
                    <span>snapshot {save.snapshotVersion ?? 'legacy'}</span>{' '}
                    <span>{save.compatibility ?? 'legacy-incompatible'}</span>{' '}
                    {restorable ? (
                      <button
                        disabled={!ready}
                        onClick={action(
                          () =>
                            actions?.restoreSave(save.saveId) ??
                            Promise.resolve(),
                        )}
                      >
                        Restore {title} at tick {save.sourceSimulationTick}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p data-testid="persistence-status">
              Persistence status: {application?.persistence.status ?? 'idle'}
              {persistenceMessage ? `: ${persistenceMessage}` : ''}
            </p>
            {state?.message ? (
              <p role="alert">Session action failed: {state.message}</p>
            ) : null}
            {browserActionMessage ? (
              <p role="alert" data-testid="browser-action-message">
                {browserActionMessage}
              </p>
            ) : null}
          </div>
          {state?.canStartNewSession ? (
            <button
              type="button"
              disabled={
                !actions ||
                scenarioSelection.status !== 'ready' ||
                !selectedScenario ||
                selectedScenario.manifest.scenarioId !==
                  scenarioSelection.requestedScenarioId
              }
              onClick={action(async () => {
                if (
                  selectedScenario &&
                  stackSeedScenario &&
                  !scenarioCoordinatesEqual(
                    createScenarioCoordinate(selectedScenario),
                    createScenarioCoordinate(stackSeedScenario),
                  )
                ) {
                  setStackSeedScenario(selectedScenario);
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
          onSelectionChange={handleSelectionChange}
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
