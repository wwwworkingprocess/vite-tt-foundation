import {
  parseClientId,
  parseCommandId,
  parseCorrelationId,
  parseSessionId,
} from '@torrevieja-tycoon/protocol';
import {
  createScenarioCoordinate,
  scenarioCoordinatesEqual,
  type ScenarioCoordinate,
  type TransportVehicleCommand,
  type CurrentAlightingEvent,
  type CurrentBoardingEvent,
  type PassengerDemandProjection,
  type PassengerDemandPlanV1,
  type PassengerJourneyCompletionEvent,
  type VehiclePassengerLoadProjection,
  type VehiclePatternRunState,
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
import { createBrowserTransportWorker } from './transport-simulation/browser-transport-worker.js';
import { createTransportFoundationApplication } from './transport-simulation/transport-foundation-application.js';
import { createDexieTransportSaveRepository } from './transport-simulation/transport-save-repository.js';
import type { TransportSaveSummary } from './transport-simulation/transport-save-record.js';
import { createWorkerTransportSimulationClient } from './transport-simulation/worker-transport-client.js';
import type { ScenarioSelectionState } from './scenarios/ScenarioPanel.js';
import {
  browserSha256,
  createScenarioLoader,
  type ScenarioLoaderState,
} from './scenarios/scenario-loader.js';
import { defaultScenarioId } from './project-defaults.js';
import { createProductionPassengerDemandPlan } from './population/population-demand-plan.js';
import {
  createPopulationFieldLoader,
  type ScenarioPopulationView,
} from './population/population-field-loader.js';
import { GameShell } from './ui/GameShell.js';
import { selectionExists, type GameSelection } from './ui/game-selection.js';
import {
  discoverBrowserSave,
  type CityNameLookup,
  type SaveDiscovery,
} from './ui/open-screen-model.js';

const SimulationControls = lazy(() => import('./ui/SimulationControls.js'));
const SessionControls = lazy(() => import('./ui/SessionControls.js'));
const VehicleMovementSvg = lazy(() =>
  import('./transport-representation/VehicleMovementSvg.js').then((module) => ({
    default: module.VehicleMovementSvg,
  })),
);
const PopulationGridOverlay = lazy(
  () => import('./transport-representation/PopulationGridOverlay.js'),
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
  restoreInitial: (saveId: string) => Promise<void>;
  sendVehicleCommand: (command: TransportVehicleCommand) => Promise<void>;
}>;

type BrowserLifecycle = Readonly<{
  status:
    | 'booting'
    | 'open'
    | 'creating'
    | 'restoring'
    | 'playing'
    | 'recoverable-failure';
  message?: string;
}>;

type AuthoritativeScenarioPackageState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'failed';
  coordinateKey?: string;
  scenario?: CanonicalScenario;
  message?: string;
}>;

type AuthoritativePopulationState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'failed';
  coordinateKey?: string;
  population?: ScenarioPopulationView;
  message?: string;
}>;

type SessionLaunchRequest = Readonly<{
  sequence: number;
  scenario: CanonicalScenario;
  passengerDemandPlan: PassengerDemandPlanV1;
  action:
    | { readonly kind: 'new' }
    | { readonly kind: 'restore'; readonly saveId: string };
}>;

const scenarioKey = (coordinate: ScenarioCoordinate) =>
  `${coordinate.scenarioSchemaVersion}:${coordinate.scenarioId}@${coordinate.scenarioVersion}#${coordinate.contentHash}`;

const toScenarioSelectionState = (
  state: ScenarioLoaderState,
): ScenarioSelectionState =>
  Object.freeze({
    requestedScenarioId: state.selectedScenarioId,
    status:
      state.status === 'loading-scenario'
        ? 'loading'
        : state.status === 'ready'
          ? 'ready'
          : state.status === 'failed'
            ? 'failed'
            : 'idle',
    ...(state.scenario ? { scenario: state.scenario } : {}),
    ...(state.message ? { message: state.message } : {}),
  });

export function App() {
  const [state, setState] = useState<FoundationSessionCompositionState>();
  const [lifecycle, setLifecycle] = useState<BrowserLifecycle>({
    status: 'booting',
  });
  const [actions, setActions] = useState<Actions>();
  const [selectedScenario, setSelectedScenario] = useState<CanonicalScenario>();
  const [scenarioSelection, setScenarioSelection] =
    useState<ScenarioSelectionState>({ status: 'idle' });
  const [scenarioLoaderState, setScenarioLoaderState] =
    useState<ScenarioLoaderState>({ status: 'idle' });
  const [cityNames, setCityNames] = useState<CityNameLookup>({});
  const [saveDiscovery, setSaveDiscovery] = useState<SaveDiscovery>({});
  const [resolverReady, setResolverReady] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [bootstrapRetryAvailable, setBootstrapRetryAvailable] = useState(false);
  const [stackSeedScenario, setStackSeedScenario] =
    useState<CanonicalScenario>();
  const [sessionLaunch, setSessionLaunch] = useState<SessionLaunchRequest>();
  const [browserActionMessage, setBrowserActionMessage] = useState<string>();
  const [selectedRouteId, setSelectedRouteId] = useState<string>();
  const [gameSelection, setGameSelection] = useState<GameSelection>(null);
  const [authoritativePackageState, setAuthoritativePackageState] =
    useState<AuthoritativeScenarioPackageState>({ status: 'idle' });
  const selectedRouteIdRef = useRef<string | undefined>(undefined);
  const authoritativePackageGeneration = useRef(0);
  const [scenarioCacheRevision, setScenarioCacheRevision] = useState(0);
  const scenarioCache = useRef(new Map<string, CanonicalScenario>());
  const scenarioResolver = useRef<
    ((coordinate: ScenarioCoordinate) => Promise<CanonicalScenario>) | undefined
  >(undefined);
  const explicitScenarioSelection = useRef(false);
  const defaultScenarioInitialized = useRef(false);
  const [scenarioLoader] = useState(() =>
    createScenarioLoader({
      baseUrl: import.meta.env.BASE_URL,
      fetchText: async (url) => {
        const response = await fetch(url);
        return { ok: response.ok, text: () => response.text() };
      },
      digestSha256: browserSha256,
    }),
  );
  const [populationFieldLoader] = useState(() =>
    createPopulationFieldLoader({
      baseUrl: import.meta.env.BASE_URL,
      fetchText: async (url) => {
        const response = await fetch(url);
        return { ok: response.ok, text: () => response.text() };
      },
      digestSha256: browserSha256,
    }),
  );
  const [authoritativePopulationState, setAuthoritativePopulationState] =
    useState<AuthoritativePopulationState>({ status: 'idle' });
  const authoritativePopulationGeneration = useRef(0);
  const saveMode = useRef<FoundationSaveMode>('manual');
  const sessionLaunchSequence = useRef(0);
  const cacheScenario = useCallback((next: CanonicalScenario) => {
    scenarioCache.current.set(
      scenarioKey(createScenarioCoordinate(next)),
      next,
    );
    setScenarioCacheRevision((revision) => revision + 1);
  }, []);
  useEffect(() => {
    let live = true;
    setBootstrapRetryAvailable(false);
    setResolverReady(false);
    const remove = scenarioLoader.projection.subscribe((next) => {
      if (!live) return;
      setScenarioLoaderState(next);
      const selection = toScenarioSelectionState(next);
      setScenarioSelection(selection);
      if (selection.status === 'ready' && selection.scenario) {
        cacheScenario(selection.scenario);
        setSelectedScenario(selection.scenario);
      }
    });
    scenarioResolver.current = async (coordinate) => {
      const resolved = await scenarioLoader.resolveScenario(coordinate);
      cacheScenario(resolved);
      return resolved;
    };
    void (async () => {
      const discovery = discoverBrowserSave().then(
        (result) => result,
        (error: unknown) =>
          Object.freeze({
            unavailableSaveMessage:
              error instanceof Error
                ? error.message
                : 'Saved sessions could not be inspected.',
          }),
      );
      await scenarioLoader.loadCatalog();
      if (!live) return;
      const catalog = scenarioLoader.projection.getState().catalog;
      if (!catalog) {
        setBootstrapRetryAvailable(true);
        setLifecycle({
          status: 'recoverable-failure',
          message: 'Scenario catalogue could not be loaded.',
        });
        const discovered = await discovery;
        if (!live) return;
        setSaveDiscovery(discovered);
        return;
      }
      setResolverReady(true);
      if (
        !defaultScenarioInitialized.current &&
        !explicitScenarioSelection.current
      ) {
        defaultScenarioInitialized.current = true;
        await scenarioLoader.loadScenario(defaultScenarioId);
      }
      if (!live) return;
      const discovered = await discovery;
      if (!live) return;
      setSaveDiscovery(discovered);
      setLifecycle({ status: 'open' });
      const representatives = [
        ...new Map(
          catalog.scenarios.map((descriptor) => [
            descriptor.primarySettlementId,
            descriptor,
          ]),
        ).values(),
      ];
      void Promise.all(
        representatives.map(async (descriptor) => ({
          cityId: descriptor.primarySettlementId,
          scenario: await scenarioLoader.resolveCatalogScenario(
            descriptor.scenarioId,
          ),
        })),
      ).then(
        (resolved) => {
          if (!live) return;
          setCityNames(
            Object.freeze(
              Object.fromEntries(
                resolved.map(({ cityId, scenario }) => [
                  cityId,
                  scenario.settlements.settlements.find(
                    ({ settlementId }) => settlementId === cityId,
                  )?.name ?? cityId,
                ]),
              ),
            ),
          );
        },
        () => undefined,
      );
    })();
    return () => {
      live = false;
      remove();
      scenarioResolver.current = undefined;
    };
  }, [bootstrapAttempt, cacheScenario, scenarioLoader]);
  const selectScenario = useCallback(
    (scenarioId: string) => {
      explicitScenarioSelection.current = true;
      void scenarioLoader.loadScenario(scenarioId);
    },
    [scenarioLoader],
  );
  useEffect(() => {
    if (typeof Worker === 'undefined' || !sessionLaunch) return;
    let live = true;
    const launchScenario = sessionLaunch.scenario;
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
          scenario: launchScenario,
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
          passengerDemandPlanResolver: {
            async resolve(coordinate) {
              const resolve = scenarioResolver.current;
              if (!resolve)
                throw new Error(
                  'The exact passenger-demand scenario is unavailable.',
                );
              const scenario = await resolve(coordinate.scenario);
              const population =
                await populationFieldLoader.resolveScenarioPopulation(scenario);
              return createProductionPassengerDemandPlan({
                scenario,
                population,
              });
            },
          },
        });
        currentApplication = application;
        const pacing = createFoundationPacingController({ application });
        return {
          application: {
            ...application,
            startNew: (request) =>
              application.startNew({
                ...request,
                passengerDemandPlan: sessionLaunch.passengerDemandPlan,
              }),
          },
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
      restoreInitial: composition.restoreInitialSession,
      sendVehicleCommand,
    });
    void (async () => {
      if (sessionLaunch.action.kind === 'new')
        await composition.startNewSession();
      else await composition.restoreInitialSession(sessionLaunch.action.saveId);
      if (!live) return;
      const next = composition.projection.getState();
      if (next.application.session.status === 'ready') {
        await composition.setMode('normal');
        if (!live) return;
        setLifecycle({ status: 'playing' });
      } else {
        setLifecycle({
          status: 'recoverable-failure',
          message: next.message ?? 'The game could not be started.',
        });
      }
    })();
    return () => {
      live = false;
      remove();
      void composition.dispose();
    };
  }, [populationFieldLoader, sessionLaunch]);

  const application = state?.application;
  const pacing = state?.pacing;
  const session = application?.session;
  const status =
    typeof Worker === 'undefined'
      ? 'unavailable in this environment'
      : (session?.status ?? 'starting');
  const ready = session?.status === 'ready' && state?.operation === 'idle';
  const persistenceMessage =
    application?.persistence.status === 'failed'
      ? application.persistence.message
      : undefined;
  const transportApplication = application as
    | (typeof application & {
        readonly fleet?: readonly VehicleState[];
        readonly passengerDemand?: PassengerDemandProjection;
        readonly vehicleOperations?: readonly VehiclePatternRunState[];
        readonly vehiclePassengerLoads?: readonly VehiclePassengerLoadProjection[];
        readonly currentBoardingEvents?: readonly CurrentBoardingEvent[];
        readonly currentAlightingEvents?: readonly CurrentAlightingEvent[];
        readonly currentJourneyCompletionEvents?: readonly PassengerJourneyCompletionEvent[];
      })
    | undefined;
  const fleet = transportApplication?.fleet;
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
    const generation = ++authoritativePopulationGeneration.current;
    if (!authoritativeCoordinateKey) {
      setAuthoritativePopulationState({ status: 'idle' });
      return;
    }
    if (!authoritativeScenarioPackage) {
      setAuthoritativePopulationState({
        status: 'loading',
        coordinateKey: authoritativeCoordinateKey,
      });
      return;
    }
    setAuthoritativePopulationState({
      status: 'loading',
      coordinateKey: authoritativeCoordinateKey,
    });
    void populationFieldLoader
      .resolveScenarioPopulation(authoritativeScenarioPackage)
      .then(
        (population) => {
          if (generation !== authoritativePopulationGeneration.current) return;
          setAuthoritativePopulationState({
            status: 'ready',
            coordinateKey: authoritativeCoordinateKey,
            population,
          });
        },
        (error: unknown) => {
          if (generation !== authoritativePopulationGeneration.current) return;
          setAuthoritativePopulationState({
            status: 'failed',
            coordinateKey: authoritativeCoordinateKey,
            message:
              error instanceof Error
                ? error.message
                : 'The authoritative population field could not be loaded.',
          });
        },
      );
  }, [
    authoritativeCoordinateKey,
    authoritativeScenarioPackage,
    populationFieldLoader,
  ]);
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
  useEffect(() => {
    if (!authoritativeScenarioPackage || !fleet) {
      setGameSelection(null);
      return;
    }
    if (
      !selectionExists(gameSelection, {
        routeIds: new Set(
          authoritativeScenarioPackage.routes.routes.map(({ routeId }) =>
            String(routeId),
          ),
        ),
        stopPlaceIds: new Set(
          authoritativeScenarioPackage.stops.stopPlaces.map(({ stopPlaceId }) =>
            String(stopPlaceId),
          ),
        ),
        vehicleIds: new Set(fleet.map(({ vehicleId }) => String(vehicleId))),
      })
    )
      setGameSelection(null);
  }, [
    authoritativeCoordinateKey,
    authoritativeScenarioPackage,
    fleet,
    gameSelection,
  ]);
  const action = (operation: (() => Promise<void>) | undefined) => () => {
    void operation?.();
  };

  const scenarioChooser = (
    <Suspense fallback={<p>Loading scenario catalogue…</p>}>
      <ScenarioPanel
        state={scenarioLoaderState}
        cityNames={cityNames}
        disabled={
          lifecycle.status === 'booting' ||
          lifecycle.status === 'creating' ||
          lifecycle.status === 'restoring'
        }
        onScenarioChange={selectScenario}
      />
    </Suspense>
  );
  const requestSessionLaunch = (
    scenario: CanonicalScenario,
    launchAction: SessionLaunchRequest['action'],
    passengerDemandPlan: PassengerDemandPlanV1,
  ) => {
    setStackSeedScenario(scenario);
    setSessionLaunch({
      sequence: ++sessionLaunchSequence.current,
      scenario,
      passengerDemandPlan,
      action: launchAction,
    });
  };
  const preparationFailure = (error: unknown, fallback: string) =>
    setLifecycle({
      status: 'recoverable-failure',
      message: error instanceof Error ? error.message : fallback,
    });
  const createGame = async () => {
    if (scenarioSelection.status !== 'ready' || !selectedScenario) return;
    setLifecycle({ status: 'creating' });
    const scenario = selectedScenario;
    try {
      const population =
        await populationFieldLoader.resolveScenarioPopulation(scenario);
      const passengerDemandPlan = createProductionPassengerDemandPlan({
        scenario,
        population,
      });
      requestSessionLaunch(scenario, { kind: 'new' }, passengerDemandPlan);
    } catch (error) {
      preparationFailure(error, 'Population authority could not be prepared.');
    }
  };
  const continueGame = async (save: TransportSaveSummary) => {
    const resolve = scenarioResolver.current;
    if (!resolve) return;
    setLifecycle({ status: 'restoring' });
    try {
      const scenario = await resolve({
        scenarioSchemaVersion: save.scenarioSchemaVersion as '1.0.0',
        scenarioId: save.scenarioId as ScenarioCoordinate['scenarioId'],
        scenarioVersion: save.scenarioVersion,
        contentHash: save.contentHash,
      });
      const population =
        await populationFieldLoader.resolveScenarioPopulation(scenario);
      const passengerDemandPlan = createProductionPassengerDemandPlan({
        scenario,
        population,
      });
      explicitScenarioSelection.current = true;
      scenarioLoader.adoptResolvedScenario(scenario);
      requestSessionLaunch(
        scenario,
        { kind: 'restore', saveId: save.saveId },
        passengerDemandPlan,
      );
    } catch (error) {
      preparationFailure(error, 'The saved scenario could not be prepared.');
    }
  };
  const retryBootstrap = () => {
    if (!bootstrapRetryAvailable) return;
    setLifecycle({ status: 'booting' });
    setBootstrapAttempt((attempt) => attempt + 1);
  };

  if (lifecycle.status !== 'playing')
    return (
      <Suspense fallback={<p>Loading Open Screen…</p>}>
        <OpenScreen
          state={lifecycle.status}
          scenarioChooser={scenarioChooser}
          selectedScenarioReady={
            scenarioSelection.status === 'ready' && !!selectedScenario
          }
          resolverReady={resolverReady}
          resumableSave={saveDiscovery.resumableSave}
          unavailableSaveMessage={saveDiscovery.unavailableSaveMessage}
          message={lifecycle.message}
          onRetryBootstrap={
            bootstrapRetryAvailable ? retryBootstrap : undefined
          }
          onCreate={() => void createGame()}
          onContinue={(save) => void continueGame(save)}
        />
      </Suspense>
    );

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
        onSendVehicleCommand={actions?.sendVehicleCommand}
        onVehicleActionMessage={setBrowserActionMessage}
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
      setLifecycle({ status: 'creating' });
      void createGame();
      return;
    }
    await actions?.start();
  };
  const sessionControls = (
    <Suspense fallback={<p>Loading saved sessions…</p>}>
      <SessionControls
        state={state}
        ready={ready}
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
          {scenarioChooser}
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
      setLifecycle({ status: 'creating' });
      void createGame();
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
            <div className="vehicle-movement-representation">
              {authoritativePopulationState.status === 'ready' &&
              authoritativePopulationState.coordinateKey ===
                authoritativeCoordinateKey &&
              authoritativePopulationState.population ? (
                <Suspense fallback={<p>Loading population field...</p>}>
                  <PopulationGridOverlay
                    key={authoritativeCoordinateKey}
                    scenario={authoritativeScenarioPackage}
                    cells={
                      authoritativePopulationState.population.canonicalCells
                    }
                    resolutionDegrees={
                      authoritativePopulationState.population.grid
                        .resolutionDegrees
                    }
                    demandModelContentHash={
                      authoritativePopulationState.population
                        .demandModelContentHash
                    }
                  />
                </Suspense>
              ) : null}
              <VehicleMovementSvg
                scenario={authoritativeScenarioPackage}
                fleet={fleet}
                selection={gameSelection}
                onSelectionChange={setGameSelection}
              />
            </div>
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
      inspector={
        authoritativeScenarioPackage && fleet ? (
          <Suspense fallback={<p>Loading inspector…</p>}>
            <GameInspector
              selection={gameSelection}
              scenario={authoritativeScenarioPackage}
              fleet={fleet}
              passengerDemand={transportApplication?.passengerDemand}
              vehicleOperations={transportApplication?.vehicleOperations}
              vehiclePassengerLoads={
                transportApplication?.vehiclePassengerLoads
              }
              currentBoardingEvents={
                transportApplication?.currentBoardingEvents
              }
              currentAlightingEvents={
                transportApplication?.currentAlightingEvents
              }
              currentJourneyCompletionEvents={
                transportApplication?.currentJourneyCompletionEvents
              }
              onClear={() => setGameSelection(null)}
            />
          </Suspense>
        ) : null
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
const OpenScreen = lazy(() => import('./ui/OpenScreen.js'));
const GameInspector = lazy(() => import('./ui/GameInspector.js'));
