import {
  parseClientId,
  parseCommandId,
  parseCorrelationId,
  parseSessionId,
} from '@torrevieja-tycoon/protocol';
import {
  createScenarioCoordinate,
  parseVehicleId,
  scenarioCoordinatesEqual,
  type ScenarioCoordinate,
  type TransportVehicleCommand,
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
  type FoundationSaveOutcome,
  type FoundationSessionCompositionState,
} from './foundation-session-composition.js';
import { createDefaultBrowserPacingDriver } from './pacing/browser-pacing-driver.js';
import { createFoundationPacingController } from './pacing/foundation-pacing-controller.js';
import { createDemoVehicleCommandForAuthority } from './transport-representation/demo-vehicle-command.js';
import { createBrowserTransportWorker } from './transport-simulation/browser-transport-worker.js';
import { createTransportFoundationApplication } from './transport-simulation/transport-foundation-application.js';
import { createDexieTransportSaveRepository } from './transport-simulation/transport-save-repository.js';
import { createWorkerTransportSimulationClient } from './transport-simulation/worker-transport-client.js';
import type { ScenarioSelectionState } from './scenarios/ScenarioPanel.js';
import { GameShell } from './ui/GameShell.js';

const SimulationControls = lazy(() => import('./ui/SimulationControls.js'));
const SessionControls = lazy(() => import('./ui/SessionControls.js'));
const VehicleMovementSvg = lazy(() =>
  import('./transport-representation/VehicleMovementSvg.js').then((module) => ({
    default: module.VehicleMovementSvg,
  })),
);

type Actions = Readonly<{
  mode: (mode: 'paused' | 'normal' | 'fast' | 'maximum') => Promise<void>;
  bonus: () => Promise<void>;
  save: () => Promise<FoundationSaveOutcome>;
  restore: () => Promise<void>;
  restoreSave: (saveId: string) => Promise<void>;
  saveMode: (mode: 'manual' | 'autosave') => Promise<void>;
  close: () => Promise<void>;
  start: () => Promise<void>;
  createVehicle: () => Promise<void>;
  startVehicle: (vehicleId: string) => Promise<void>;
}>;

type AuthoritativeScenarioPackageState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'failed';
  coordinateKey?: string;
  scenario?: CanonicalScenario;
  message?: string;
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
  const [selectedRouteId, setSelectedRouteId] = useState<string>();
  const [authoritativePackageState, setAuthoritativePackageState] =
    useState<AuthoritativeScenarioPackageState>({ status: 'idle' });
  const selectedRouteIdRef = useRef<string | undefined>(undefined);
  const authoritativePackageGeneration = useRef(0);
  const authoritativeScenarioPackageRef = useRef<CanonicalScenario | undefined>(
    undefined,
  );
  const [scenarioCacheRevision, setScenarioCacheRevision] = useState(0);
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
    const sendVehicleCommand = async (command: TransportVehicleCommand) => {
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
          const authoritativePackage = authoritativeScenarioPackageRef.current;
          const command = createDemoVehicleCommandForAuthority(
            coordinate,
            (current) =>
              authoritativePackage &&
              scenarioCoordinatesEqual(
                current,
                createScenarioCoordinate(authoritativePackage),
              )
                ? authoritativePackage
                : undefined,
            currentApplication?.projection.getState().fleet ?? [],
            selectedRouteIdRef.current,
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
  const authoritativeCoordinate = application?.scenario;
  const authoritativeCoordinateKey = authoritativeCoordinate
    ? scenarioKey(authoritativeCoordinate)
    : undefined;
  const cachedAuthoritativeScenario = authoritativeCoordinateKey
    ? scenarioCache.current.get(authoritativeCoordinateKey)
    : undefined;
  const authoritativeScenarioPackage =
    cachedAuthoritativeScenario ??
    (authoritativePackageState.status === 'ready' &&
    authoritativePackageState.coordinateKey === authoritativeCoordinateKey
      ? authoritativePackageState.scenario
      : undefined);
  const currentAuthoritativePackageState =
    authoritativePackageState.coordinateKey === authoritativeCoordinateKey
      ? authoritativePackageState
      : undefined;
  authoritativeScenarioPackageRef.current = authoritativeScenarioPackage;
  useEffect(() => {
    const generation = ++authoritativePackageGeneration.current;
    if (!authoritativeCoordinate || !authoritativeCoordinateKey) {
      setAuthoritativePackageState({ status: 'idle' });
      return;
    }
    const cached = scenarioCache.current.get(authoritativeCoordinateKey);
    if (cached) {
      setAuthoritativePackageState({
        status: 'ready',
        coordinateKey: authoritativeCoordinateKey,
        scenario: cached,
      });
      return;
    }
    setAuthoritativePackageState({
      status: 'loading',
      coordinateKey: authoritativeCoordinateKey,
    });
    const resolve = scenarioResolver.current;
    if (!resolve) {
      setAuthoritativePackageState({
        status: 'failed',
        coordinateKey: authoritativeCoordinateKey,
        message: 'The authoritative scenario package is unavailable.',
      });
      return;
    }
    void resolve(authoritativeCoordinate).then(
      (resolved) => {
        if (generation !== authoritativePackageGeneration.current) return;
        if (
          !scenarioCoordinatesEqual(
            authoritativeCoordinate,
            createScenarioCoordinate(resolved),
          )
        ) {
          setAuthoritativePackageState({
            status: 'failed',
            coordinateKey: authoritativeCoordinateKey,
            message:
              'The resolved authoritative scenario package does not match the active session.',
          });
          return;
        }
        setAuthoritativePackageState({
          status: 'ready',
          coordinateKey: authoritativeCoordinateKey,
          scenario: resolved,
        });
      },
      (error: unknown) => {
        if (generation !== authoritativePackageGeneration.current) return;
        setAuthoritativePackageState({
          status: 'failed',
          coordinateKey: authoritativeCoordinateKey,
          message:
            error instanceof Error
              ? error.message
              : 'The authoritative scenario package could not be loaded.',
        });
      },
    );
  }, [authoritativeCoordinateKey, scenarioCacheRevision]);
  useEffect(() => {
    if (!authoritativeScenarioPackage) {
      selectedRouteIdRef.current = undefined;
      setSelectedRouteId(undefined);
      return;
    }
    const available = authoritativeScenarioPackage.routes.routes.some(
      (route) => route.routeId === selectedRouteIdRef.current,
    );
    if (!available) {
      const first = authoritativeScenarioPackage.routes.routes[0]?.routeId;
      selectedRouteIdRef.current = first;
      setSelectedRouteId(first);
    }
  }, [authoritativeScenarioPackage]);
  const action = (operation: (() => Promise<void>) | undefined) => () => {
    void operation?.();
  };

  const simulationControls = (
    <Suspense fallback={<p>Loading simulation controls…</p>}>
      <SimulationControls
        status={status}
        state={state}
        selectedScenario={selectedScenario}
        scenarioSelection={scenarioSelection}
        selectedRouteId={selectedRouteId}
        authoritativeScenarioPackage={authoritativeScenarioPackage}
        authoritativePackageStatus={currentAuthoritativePackageState?.status}
        authoritativePackageMessage={currentAuthoritativePackageState?.message}
        fleet={fleet}
        ready={ready}
        onRouteChange={(routeId) => {
          selectedRouteIdRef.current = routeId;
          setSelectedRouteId(routeId);
        }}
        onCreateVehicle={actions?.createVehicle}
        onStartVehicle={actions?.startVehicle}
        onMode={actions?.mode}
        onBonus={actions?.bonus}
      />
    </Suspense>
  );
  const startNewSession = async () => {
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
  };
  const sessionControls = (
    <Suspense fallback={<p>Loading saved sessions…</p>}>
      <SessionControls
        state={state}
        ready={ready}
        selectedSaveAvailable={Boolean(selectedSaveAvailable)}
        persistenceMessage={persistenceMessage}
        browserActionMessage={browserActionMessage}
        scenarioTitle={(scenarioId) =>
          [...scenarioCache.current.values()].find(
            (scenario) => scenario.manifest.scenarioId === scenarioId,
          )?.manifest.title
        }
        onSave={actions?.save}
        onRestore={actions?.restore}
        onRestoreSave={actions?.restoreSave}
        onSaveMode={actions?.saveMode}
        onStart={startNewSession}
        onClose={actions?.close}
        startDisabled={
          !actions ||
          scenarioSelection.status !== 'ready' ||
          !selectedScenario ||
          selectedScenario.manifest.scenarioId !==
            scenarioSelection.requestedScenarioId
        }
      />
    </Suspense>
  );
  const scenarioControl = (
    <details className="scenario-menu">
      <summary data-testid="scenario-menu-trigger">
        Scenario: {selectedScenario?.manifest.title ?? 'Loading'}
      </summary>
      <div className="scenario-menu-panel">
        <Suspense fallback={<p>Loading scenario catalogue…</p>}>
          <ScenarioPanel
            onResolverReady={handleResolverReady}
            onScenarioReady={handleScenarioReady}
            onSelectionChange={handleSelectionChange}
          />
        </Suspense>
      </div>
    </details>
  );
  const restart = async () => {
    if (
      !window.confirm(
        'Restarting will replace your current gameplay. Continue?',
      )
    ) {
      setBrowserActionMessage('Restart cancelled.');
      return;
    }
    setBrowserActionMessage(undefined);
    await actions?.close();
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
  };
  return (
    <GameShell
      status={
        browserActionMessage ?? state?.message ?? persistenceMessage ?? status
      }
      pacingStatus={pacing?.status ?? 'idle'}
      persistenceStatus={application?.persistence.status ?? 'idle'}
      saveDisabled={!ready}
      restartDisabled={
        !actions ||
        scenarioSelection.status !== 'ready' ||
        !selectedScenario ||
        state?.operation !== 'idle'
      }
      onSave={() =>
        actions?.save() ??
        Promise.resolve(Object.freeze({ status: 'ignored' as const }))
      }
      onRestart={action(restart)}
      onPauseResume={action(
        () =>
          actions?.mode(pacing?.mode === 'paused' ? 'normal' : 'paused') ??
          Promise.resolve(),
      )}
      scenarioControl={scenarioControl}
      projectInfo={
        <Suspense fallback={<p>Loading project information…</p>}>
          <ProjectInfo />
        </Suspense>
      }
      simulationControls={simulationControls}
      sessionControls={sessionControls}
      primaryVisualization={
        <Suspense fallback={<p>Loading transport representation…</p>}>
          {authoritativeScenarioPackage && fleet ? (
            <VehicleMovementSvg
              scenario={authoritativeScenarioPackage}
              fleet={fleet}
            />
          ) : (
            <p>Authoritative scenario representation loading.</p>
          )}
        </Suspense>
      }
      secondaryVisualization={
        <Suspense fallback={<p>Loading representation…</p>}>
          <FoundationScene />
        </Suspense>
      }
    />
  );
}

const FoundationScene = lazy(() => import('./foundation-scene.js'));
const ProjectInfo = lazy(() => import('./ui/ProjectInfo.js'));
const ScenarioPanel = lazy(() =>
  import('./scenarios/ScenarioPanel.js').then(({ ScenarioPanel }) => ({
    default: ScenarioPanel,
  })),
);
