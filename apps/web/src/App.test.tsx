import 'fake-indexeddb/auto';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDirectedScenarioGraph,
  parseScenarioPackage,
} from '@torrevieja-tycoon/transport-domain';
import { createScenarioCoordinate } from '@torrevieja-tycoon/simulation';
import { createScenarioScopedSaveTarget } from './transport-simulation/scenario-save-target.js';
import type { TransportSaveSummary } from './transport-simulation/transport-save-record.js';
import { createDexieTransportSaveRepository } from './transport-simulation/transport-save-repository.js';

const fleetTuples = () =>
  [...document.querySelectorAll('[data-testid^="vehicle-row-"]')].map(
    (row) => ({
      vehicleId: row.getAttribute('data-vehicle-id'),
      patternId: row.getAttribute('data-pattern-id'),
      plan: row.getAttribute('data-plan-travel-ticks'),
      movementKind: row.getAttribute('data-movement-kind'),
      stopId: row.getAttribute('data-stop-id'),
      edgeId: row.getAttribute('data-edge-id'),
      edgeSequence: row.getAttribute('data-edge-sequence'),
      progress: row.getAttribute('data-progress-numerator'),
      travel: row.getAttribute('data-progress-denominator'),
    }),
  );

const fixture = join(
  import.meta.dirname,
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
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});
const legacyFixture = join(
  import.meta.dirname,
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-legacy-abc-v1',
);
const legacyJson = (name: string) =>
  JSON.parse(readFileSync(join(legacyFixture, name), 'utf8')) as unknown;
const legacyScenario = parseScenarioPackage({
  manifest: legacyJson('scenario.json'),
  settlements: legacyJson('settlements.json'),
  stops: legacyJson('stops.json'),
  routes: legacyJson('routes.json'),
  presentation: legacyJson('presentation.json'),
  provenance: legacyJson('provenance.json'),
});
const alternate = (name: string) =>
  JSON.parse(
    JSON.stringify(json(name)).replaceAll('torrevieja-mini-v1', 'scenario-b'),
  ) as Record<string, unknown>;
const alternateManifest = alternate('scenario.json');
alternateManifest.contentHash = 'b'.repeat(64);
const alternateRoutes = alternate('routes.json') as {
  routes: Array<{
    routeId: string;
    patterns: Array<{
      patternId: string;
      closesLoop: boolean;
      stopNodeIds: string[];
    }>;
  }>;
};
const alternatePattern = alternateRoutes.routes[0]!.patterns[0]!;
alternateRoutes.routes[0]!.routeId = 'scenario-b-route';
alternateRoutes.routes[0]!.patterns = [
  {
    ...alternatePattern,
    patternId: 'scenario-b-pattern',
    closesLoop: false,
    stopNodeIds: alternatePattern.stopNodeIds.slice(0, 3),
  },
];
const alternateScenario = parseScenarioPackage({
  manifest: alternateManifest,
  settlements: alternate('settlements.json'),
  stops: alternate('stops.json'),
  routes: alternateRoutes,
  presentation: alternate('presentation.json'),
  provenance: alternate('provenance.json'),
});

vi.mock('./project-defaults.js', () => ({
  defaultScenarioId: 'torrevieja-mini-v1',
}));

let populationFailureMessages: string[] = [];
let demandPlanFailureMessages: string[] = [];
let deferredPopulation:
  | {
      scenarioId: string;
      skipMatchingCalls: number;
      release?: () => void;
    }
  | undefined;
vi.mock('./population/population-field-loader.js', () => ({
  createPopulationFieldLoader: () => ({
    resolveScenarioPopulation: async (populationScenario: typeof scenario) => {
      const failure = populationFailureMessages.shift();
      if (failure) throw new Error(failure);
      const population = {
        grid: { resolutionDegrees: 0.001 },
        crop: { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 },
        canonicalCells: [
          {
            cellId: `population-${populationScenario.manifest.scenarioId}`,
            row: 0,
            column: 0,
            center: populationScenario.stops.stopNodes[0]!.position,
            populationWeight: 1,
          },
        ],
        totalPopulationWeight: 1,
        nonzeroCellCount: 1,
        gridSha256: 'a'.repeat(64),
        cropSha256: 'b'.repeat(64),
        demandModelContentHash: 'c'.repeat(64),
        operationalCropPolicy: { maxAccessDistanceCells: 5 },
      };
      if (
        deferredPopulation?.scenarioId ===
        populationScenario.manifest.scenarioId
      ) {
        if (deferredPopulation.skipMatchingCalls > 0)
          deferredPopulation.skipMatchingCalls -= 1;
        else
          await new Promise<void>((resolve) => {
            deferredPopulation!.release = resolve;
          });
      }
      return population;
    },
  }),
}));
vi.mock('./population/population-demand-plan.js', () => ({
  createProductionPassengerDemandPlan: () => {
    const failure = demandPlanFailureMessages.shift();
    if (failure) throw new Error(failure);
    return undefined;
  },
}));

let deferCityNameResolution = false;
let releaseCityNameResolution: (() => void) | undefined;
let failNextWorkerStart = false;
let failNextCatalogLoad = false;
let discoveredSave: TransportSaveSummary | undefined;
let holdNextWorkerStart = false;
let releaseHeldWorkerStart: (() => void) | undefined;
type SaveDiscoveryResult = Readonly<{
  resumableSave?: TransportSaveSummary;
  unavailableSaveMessage?: string;
}>;
let queuedSaveDiscoveries: Array<Promise<SaveDiscoveryResult>> = [];

vi.mock('./ui/open-screen-model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ui/open-screen-model.js')>()),
  discoverBrowserSave: async () =>
    queuedSaveDiscoveries.shift() ??
    (discoveredSave ? { resumableSave: discoveredSave } : {}),
}));

vi.mock('./scenarios/ScenarioPanel.js', () => ({
  toScenarioSelectionState: (state: {
    status: string;
    selectedScenarioId?: string;
    scenario?: typeof scenario;
    message?: string;
  }) => ({
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
  }),
  ScenarioPanel: ({
    onScenarioChange,
    disabled,
  }: {
    onScenarioChange(value: string): void;
    disabled?: boolean;
  }) => {
    return (
      <div>
        Scenario fixture
        <button
          disabled={disabled}
          onClick={() =>
            onScenarioChange(alternateScenario.manifest.scenarioId)
          }
        >
          Select scenario B
        </button>
        <button
          disabled={disabled}
          onClick={() => onScenarioChange(scenario.manifest.scenarioId)}
        >
          Select scenario A
        </button>
        <button
          disabled={disabled}
          onClick={() => onScenarioChange(legacyScenario.manifest.scenarioId)}
        >
          Select legacy routes
        </button>
        <button
          disabled={disabled}
          onClick={() => onScenarioChange('request-b')}
        >
          Request scenario B
        </button>
        <button disabled={disabled} onClick={() => onScenarioChange('fail-b')}>
          Fail scenario B
        </button>
      </div>
    );
  },
}));

vi.mock('./scenarios/scenario-loader.js', () => ({
  browserSha256: vi.fn(),
  createScenarioLoader: () => {
    let state: Record<string, unknown> = { status: 'idle' };
    const listeners = new Set<(value: never) => void>();
    const publish = (next: Record<string, unknown>) => {
      state = next;
      listeners.forEach((listener) => listener(next as never));
    };
    const catalog = {
      scenarios: [scenario, alternateScenario, legacyScenario].map((item) => ({
        scenarioId: item.manifest.scenarioId,
        scenarioVersion: item.manifest.scenarioVersion,
        contentHash: item.manifest.contentHash,
        title: item.manifest.title,
        primarySettlementId: item.settlements.settlements[0]!.settlementId,
      })),
    };
    const find = (id: string) =>
      id === alternateScenario.manifest.scenarioId
        ? alternateScenario
        : id === legacyScenario.manifest.scenarioId
          ? legacyScenario
          : scenario;
    return {
      projection: {
        getState: () => state,
        subscribe: (listener: (value: never) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      loadCatalog: async () => {
        if (failNextCatalogLoad) {
          failNextCatalogLoad = false;
          publish({ status: 'failed', message: 'catalogue failed' });
          return;
        }
        publish({ status: 'idle', catalog });
      },
      loadScenario: async (id: string) => {
        if (id === 'request-b')
          return publish({
            status: 'loading-scenario',
            catalog,
            selectedScenarioId: alternateScenario.manifest.scenarioId,
          });
        if (id === 'fail-b')
          return publish({
            status: 'failed',
            catalog,
            selectedScenarioId: alternateScenario.manifest.scenarioId,
            message: 'Scenario B failed',
          });
        const selected = find(id);
        publish({
          status: 'ready',
          catalog,
          selectedScenarioId: selected.manifest.scenarioId,
          scenario: selected,
        });
      },
      resolveScenario: async (coordinate: { scenarioId: string }) =>
        find(coordinate.scenarioId),
      adoptResolvedScenario: (selected: typeof scenario) =>
        publish({
          status: 'ready',
          catalog,
          selectedScenarioId: selected.manifest.scenarioId,
          scenario: selected,
        }),
      resolveCatalogScenario: async (id: string) => {
        if (deferCityNameResolution)
          await new Promise<void>((resolve) => {
            releaseCityNameResolution = resolve;
          });
        return find(id);
      },
    };
  },
}));

vi.mock('./transport-simulation/browser-transport-worker.js', async () => {
  const { startTransportWorkerRuntime } =
    await import('./transport-simulation/worker-transport-client.js');
  const { createDirectTransportSimulationClient } =
    await import('./transport-simulation/transport-client.js');
  return {
    createBrowserTransportWorker: () => {
      if (failNextWorkerStart) {
        failNextWorkerStart = false;
        const errorListeners = new Set<
          (event: { data: unknown; error?: unknown }) => void
        >();
        return {
          postMessage: () =>
            queueMicrotask(() =>
              errorListeners.forEach((listener) =>
                listener({
                  data: undefined,
                  error: new Error('startup failed'),
                }),
              ),
            ),
          addEventListener: (
            type: string,
            listener: (event: { data: unknown; error?: unknown }) => void,
          ) => {
            if (type !== 'message') errorListeners.add(listener);
          },
          removeEventListener: (
            _type: string,
            listener: (event: { data: unknown; error?: unknown }) => void,
          ) => errorListeners.delete(listener),
          terminate: vi.fn(),
        };
      }
      const clientListeners = new Set<(event: { data: unknown }) => void>();
      const clientErrorListeners = new Set<
        (event: { data: unknown; error?: unknown }) => void
      >();
      const runtimeListeners = new Set<(event: { data: unknown }) => void>();
      const runtime = startTransportWorkerRuntime(
        {
          postMessage: (message) =>
            queueMicrotask(() =>
              clientListeners.forEach((listener) =>
                listener({ data: structuredClone(message) }),
              ),
            ),
          addEventListener: (_type, listener) => runtimeListeners.add(listener),
          removeEventListener: (_type, listener) =>
            runtimeListeners.delete(listener),
        },
        createDirectTransportSimulationClient,
      );
      return {
        postMessage: (message: unknown) => {
          const deliver = () =>
            queueMicrotask(() =>
              runtimeListeners.forEach((listener) =>
                listener({ data: structuredClone(message) }),
              ),
            );
          if (holdNextWorkerStart) {
            holdNextWorkerStart = false;
            releaseHeldWorkerStart = deliver;
          } else deliver();
        },
        addEventListener: (
          type: 'message' | 'error' | 'messageerror',
          listener: (event: { data: unknown; error?: unknown }) => void,
        ) => {
          if (type === 'message') clientListeners.add(listener);
          else clientErrorListeners.add(listener);
        },
        removeEventListener: (
          type: 'message' | 'error' | 'messageerror',
          listener: (event: { data: unknown; error?: unknown }) => void,
        ) => {
          if (type === 'message') clientListeners.delete(listener);
          else clientErrorListeners.delete(listener);
        },
        terminate: () => void runtime.close(),
      };
    },
  };
});

import { App } from './App.js';

const renderAppWithControls = async () => {
  render(<App />);
  const start = await screen.findByRole('button', { name: 'Start new game' });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  await screen.findByTestId('game-shell');
  fireEvent.click(screen.getByTestId('scenario-menu-trigger'));
  fireEvent.click(screen.getByRole('button', { name: 'Simulation controls' }));
  await pauseSimulation();
};

const openDialog = (name: 'Simulation controls' | 'Load') => {
  const dialog = screen.queryByRole('dialog');
  if (dialog) {
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: /^Close (Project information|Simulation controls|Saved sessions)$/,
      }),
    );
  }
  fireEvent.click(screen.getByRole('button', { name }));
};

const openSimulationControls = () => openDialog('Simulation controls');
const openSessionControls = () => openDialog('Load');
const pauseSimulation = async () => {
  await waitFor(() =>
    expect(screen.getByTestId('pacing-status')).toHaveTextContent(
      /running|paused/,
    ),
  );
  if (screen.getByTestId('pacing-status').textContent?.includes('running'))
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: 'Simulation controls' }),
      ).getByRole('button', { name: 'Pause' }),
    );
  await waitFor(() =>
    expect(screen.getByTestId('pacing-status')).toHaveTextContent('paused'),
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  deferCityNameResolution = false;
  releaseCityNameResolution = undefined;
  failNextWorkerStart = false;
  failNextCatalogLoad = false;
  discoveredSave = undefined;
  holdNextWorkerStart = false;
  releaseHeldWorkerStart = undefined;
  queuedSaveDiscoveries = [];
  populationFailureMessages = [];
  demandPlanFailureMessages = [];
  deferredPopulation = undefined;
});

describe('foundation screen', () => {
  it('opens before creating authority and starts the renderer boundary after choosing a game', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Torrevieja Tycoon' }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('open-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('r3f-canvas')).toBeNull();
    const start = await screen.findByRole('button', { name: 'Start new game' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByTestId('game-shell');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Project info' }));
    expect(
      await screen.findByText('standalone simulation package', undefined, {
        timeout: 5_000,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('r3f-canvas')).toBeInTheDocument();
  }, 15_000);

  it('opens renderer-independent StopPlace details and keeps selection after close', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select legacy routes' }),
    );
    const start = await screen.findByRole('button', { name: 'Start new game' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByTestId('game-shell');
    const stop = (
      await screen.findAllByRole('button', {
        name: /^Select stop /,
      })
    )[0]!;
    fireEvent.click(stop);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Serving routes');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('stop-inspector')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }),
    );
    fireEvent.click(stop);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  }, 15_000);

  it('preserves explicit non-default intent while city presentation metadata resolves late', async () => {
    deferCityNameResolution = true;
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select scenario B' }),
    );
    const start = screen.getByRole('button', { name: 'Start new game' });
    await waitFor(() => expect(start).toBeEnabled());
    releaseCityNameResolution?.();
    deferCityNameResolution = false;
    fireEvent.click(start);
    await screen.findByTestId('game-shell');
    expect(await screen.findByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      alternateScenario.manifest.scenarioId,
    );
    fireEvent.click(screen.getByTestId('scenario-menu-trigger'));
    expect(screen.getByTestId('scenario-menu-trigger')).toHaveTextContent(
      alternateScenario.manifest.title,
    );
  });

  it('freezes scenario intent while a new-game launch is creating authority', async () => {
    holdNextWorkerStart = true;
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    const selectB = await screen.findByRole('button', {
      name: 'Select scenario B',
    });
    fireEvent.click(selectB);
    const start = screen.getByRole('button', { name: 'Start new game' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(
      await screen.findByText('Creating authoritative game...'),
    ).toBeInTheDocument();
    expect(selectB).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Select scenario A' }),
    ).toBeDisabled();
    await waitFor(() => expect(releaseHeldWorkerStart).toBeTypeOf('function'));
    releaseHeldWorkerStart?.();
    expect(await screen.findByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      alternateScenario.manifest.scenarioId,
    );
  });

  it('adopts an exact non-default saved scenario as durable browser intent', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select scenario B' }),
    );
    const start = screen.getByRole('button', { name: 'Start new game' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByTestId('game-shell');
    await waitFor(() =>
      expect(screen.getByTestId('scenario-menu-trigger')).toHaveTextContent(
        alternateScenario.manifest.title,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Save completed\./);
    const repository = createDexieTransportSaveRepository(
      'foundation-template',
    );
    const records = await repository.list();
    discoveredSave = records
      .flatMap((record) =>
        record.classification === 'current' ? [record.summary] : [],
      )
      .find(
        (summary) =>
          summary.scenarioId === alternateScenario.manifest.scenarioId,
      );
    await repository.close();
    expect(discoveredSave).toBeDefined();
    cleanup();

    render(<App />);
    populationFailureMessages = ['restore population unavailable'];
    demandPlanFailureMessages = ['restore plan invalid'];
    const continueButton = await screen.findByRole('button', {
      name: 'Continue saved game',
    });
    fireEvent.click(continueButton);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'restore population unavailable',
    );
    expect(screen.queryByTestId('game-shell')).toBeNull();
    fireEvent.click(continueButton);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'restore plan invalid',
    );
    expect(screen.queryByTestId('game-shell')).toBeNull();
    holdNextWorkerStart = true;
    fireEvent.click(continueButton);
    expect(
      await screen.findByText('Restoring authoritative game...'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Select scenario A' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Select scenario B' }),
    ).toBeDisabled();
    await waitFor(() => expect(releaseHeldWorkerStart).toBeTypeOf('function'));
    releaseHeldWorkerStart?.();
    await screen.findByTestId('game-shell');
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      alternateScenario.manifest.scenarioId,
    );
    expect(screen.getByTestId('scenario-menu-trigger')).toHaveTextContent(
      alternateScenario.manifest.title,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide passengers' }));
    expect(
      await screen.findByRole('button', { name: 'Show passengers' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(await screen.findByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      alternateScenario.manifest.scenarioId,
    );
    expect(screen.getByTestId('scenario-menu-trigger')).toHaveTextContent(
      alternateScenario.manifest.title,
    );
    await screen.findByRole('button', { name: 'Hide passengers' });
    const cleanupRepository = createDexieTransportSaveRepository(
      'foundation-template',
    );
    await cleanupRepository.delete(discoveredSave!.saveId);
    await cleanupRepository.close();
  });

  it('retries the same exact scenario after an initial Worker startup failure', async () => {
    failNextWorkerStart = true;
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    const start = await screen.findByRole('button', { name: 'Start new game' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'startup failed',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(await screen.findByTestId('game-shell')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('recovers and retries new-game population and plan preparation failures', async () => {
    populationFailureMessages = ['population unavailable'];
    demandPlanFailureMessages = ['plan invalid'];
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    const start = await screen.findByRole('button', { name: 'Start new game' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'population unavailable',
    );
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent('plan invalid');
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(await screen.findByTestId('game-shell')).toBeInTheDocument();
  });

  it('retries catalogue bootstrap without reloading the browser', async () => {
    failNextCatalogLoad = true;
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scenario catalogue could not be loaded',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    const start = await screen.findByRole('button', { name: 'Start new game' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByTestId('game-shell')).toBeInTheDocument();
  });

  it('ignores stale save discovery from an earlier catalogue attempt', async () => {
    let resolveStaleDiscovery!: (value: SaveDiscoveryResult) => void;
    const staleDiscovery = new Promise<SaveDiscoveryResult>((resolve) => {
      resolveStaleDiscovery = resolve;
    });
    queuedSaveDiscoveries = [
      staleDiscovery,
      Promise.resolve({ unavailableSaveMessage: 'Current discovery.' }),
    ];
    failNextCatalogLoad = true;
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scenario catalogue could not be loaded',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('Current discovery.')).toBeInTheDocument();
    resolveStaleDiscovery({ unavailableSaveMessage: 'Stale discovery.' });
    await waitFor(() =>
      expect(screen.queryByText('Stale discovery.')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Current discovery.')).toBeInTheDocument();
  });

  it('reports Worker readiness, advancement, and cleanup', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    await renderAppWithControls();

    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      ).toBeEnabled(),
    );
    openSimulationControls();
    expect(
      Number(screen.getByTestId('worker-tick').textContent?.match(/\d+/)?.[0]),
    ).toBeGreaterThanOrEqual(0);
    expect(screen.getByTestId('scenario-coordinate')).toHaveTextContent(
      '1.0.0:torrevieja-mini-v1@1.0.0#',
    );
    openSessionControls();
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Close transport Worker' },
        { timeout: 5_000 },
      ),
    );
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('closed'),
    );
    openSessionControls();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start new transport session',
      }),
    );
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    expect(screen.getByTestId('worker-timeline')).toHaveTextContent(
      'browser-foundation-timeline-2',
    );
  }, 15_000);

  it('does not replace ready authority when loader selection changes', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    const intervals = vi.spyOn(window, 'setInterval');
    const clears = vi.spyOn(window, 'clearInterval');
    await renderAppWithControls();
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    const timeline = screen.getByTestId('worker-timeline').textContent;
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      'torrevieja-mini-v1',
    );
    openSessionControls();
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Autosave' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeChecked(),
    );
    const initialAutosaveSchedules = intervals.mock.calls.filter(
      ([, milliseconds]) => milliseconds === 30_000,
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Select scenario B' }));
    openSimulationControls();
    expect(screen.getByTestId('selected-scenario')).toHaveTextContent(
      'scenario-b',
    );
    expect(screen.getByTestId('active-scenario')).toHaveTextContent(
      'torrevieja-mini-v1',
    );
    expect(screen.getByTestId('worker-status')).toHaveTextContent('ready');
    expect(screen.getByTestId('worker-timeline').textContent).toBe(timeline);
    expect(screen.getByTestId('scenario-coordinate')).toHaveTextContent(
      'torrevieja-mini-v1',
    );
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      'torrevieja-mini-v1',
    );
    openSessionControls();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close transport Worker' }),
    );
    const start = await screen.findByRole('button', {
      name: 'Start new transport session',
    });
    fireEvent.click(start);
    await screen.findByTestId('game-shell');
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'scenario-b',
      ),
    );
    openSessionControls();
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeEnabled();
      expect(
        intervals.mock.calls.filter(
          ([, milliseconds]) => milliseconds === 30_000,
        ),
      ).toHaveLength(initialAutosaveSchedules + 1);
    });
    openSimulationControls();
    expect(clears).toHaveBeenCalled();
    expect(await screen.findByTestId('worker-status')).toHaveTextContent(
      'ready',
    );
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      'scenario-b',
    );
  }, 15_000);

  it('never starts the previous ready package while a requested selection is pending or failed', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    await renderAppWithControls();
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    openSessionControls();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close transport Worker' }),
    );
    const start = await screen.findByRole('button', {
      name: 'Start new transport session',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request scenario B' }));
    openSimulationControls();
    expect(screen.getByTestId('requested-scenario')).toHaveTextContent(
      'scenario-b (loading)',
    );
    expect(start).toBeDisabled();
    expect(screen.getByTestId('active-scenario')).not.toHaveTextContent(
      'scenario-b',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fail scenario B' }));
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select scenario B' }));
    await waitFor(() =>
      expect(screen.getByTestId('requested-scenario')).toHaveTextContent(
        'scenario-b (ready)',
      ),
    );
    openSessionControls();
    const readyStart = await screen.findByRole('button', {
      name: 'Start new transport session',
    });
    await waitFor(() => expect(readyStart).toBeEnabled());
    fireEvent.click(readyStart);
    await screen.findByTestId('game-shell');
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'scenario-b',
      ),
    );
  }, 15_000);

  it('exposes deterministic vehicle diagnostics from the authoritative Worker', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    await renderAppWithControls();
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create demo vehicle' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-count')).toHaveTextContent('1'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create demo vehicle' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-count')).toHaveTextContent('2'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create demo vehicle' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-count')).toHaveTextContent('3'),
    );
    for (const id of [
      'browser-demo-vehicle-001',
      'browser-demo-vehicle-002',
      'browser-demo-vehicle-003',
    ])
      expect(screen.getByTestId(`vehicle-row-${id}`)).toHaveAttribute(
        'data-vehicle-id',
        id,
      );
    expect(screen.getByTestId('vehicle-id')).toHaveTextContent(
      'browser-demo-vehicle-001',
    );
    expect(screen.getByTestId('vehicle-movement')).toHaveTextContent(
      'parked-at-stop',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Start browser-demo-vehicle-001' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-movement')).toHaveTextContent(
        'running-at-stop',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Normal 20/ }));
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-movement')).toHaveTextContent(
        /running-on-edge|running-at-stop|completed-at-stop/,
      ),
    );
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: 'Simulation controls' }),
      ).getByRole('button', { name: 'Pause' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('pacing-status')).toHaveTextContent('paused'),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    const position = screen
      .getAllByTestId('vehicle-position')
      .find(
        (element) =>
          element.getAttribute('data-vehicle-id') ===
          'browser-demo-vehicle-001',
      )!;
    expect(position).toHaveAttribute(
      'data-vehicle-id',
      'browser-demo-vehicle-001',
    );
    fireEvent.click(position);
    const vehicleDialog = await screen.findByRole('dialog', {
      name: 'Vehicle browser-demo-vehicle-001',
    });
    expect(
      await within(vehicleDialog).findByTestId('vehicle-modal-details'),
    ).toHaveTextContent('Vehicle overview');
    fireEvent.click(
      within(vehicleDialog).getByRole('button', { name: 'Close' }),
    );
    expect(screen.getByTestId('vehicle-inspector')).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', {
        name: 'Vehicle browser-demo-vehicle-001',
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    const reopenedVehicleDialog = await screen.findByRole('dialog', {
      name: 'Vehicle browser-demo-vehicle-001',
    });
    expect(reopenedVehicleDialog).toBeInTheDocument();
    fireEvent.click(
      within(reopenedVehicleDialog).getByRole('button', { name: 'Close' }),
    );
    const pausedPosition = [
      position.getAttribute('data-movement-kind'),
      position.getAttribute('data-edge-id'),
      position.getAttribute('data-progress-numerator'),
      position.getAttribute('data-progress-denominator'),
      position.getAttribute('cx'),
      position.getAttribute('cy'),
    ];
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect([
      position.getAttribute('data-movement-kind'),
      position.getAttribute('data-edge-id'),
      position.getAttribute('data-progress-numerator'),
      position.getAttribute('data-progress-denominator'),
      position.getAttribute('cx'),
      position.getAttribute('cy'),
    ]).toEqual(pausedPosition);
    fireEvent.click(screen.getByRole('button', { name: /Normal 20/ }));
    await waitFor(() =>
      expect([
        position.getAttribute('data-movement-kind'),
        position.getAttribute('data-edge-id'),
        position.getAttribute('data-progress-numerator'),
        position.getAttribute('data-progress-denominator'),
        position.getAttribute('cx'),
        position.getAttribute('cy'),
      ]).not.toEqual(pausedPosition),
    );
  });

  it('lists canonical legacy routes and creates a vehicle on the chosen RouteId', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    await renderAppWithControls();
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Select legacy routes' }),
    );
    expect(screen.getByTestId('active-scenario')).not.toHaveTextContent(
      'torrevieja-legacy-abc-v1',
    );
    openSessionControls();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close transport Worker' }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start new transport session',
      }),
    );
    await screen.findByTestId('game-shell');
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'torrevieja-legacy-abc-v1',
      ),
    );
    await pauseSimulation();
    expect(
      within(screen.getByTestId('route-list')).getByText(
        'A — Torrevieja - La Mata',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('route-list')).getByText(
        'B — Torrevieja - Torretas - San Luis',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('route-list')).getByText(
        'C — Torrevieja - Lomas',
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vehicle route'), {
      target: { value: 'legacy-B' },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create demo vehicle' }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('vehicle-row-browser-demo-vehicle-001'),
      ).toHaveAttribute('data-route-id', 'legacy-B'),
    );
  }, 15_000);

  it('keeps selection non-destructive and replaces every authority-bound surface together', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    await renderAppWithControls();
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    const initialGraph = buildDirectedScenarioGraph(scenario);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create demo vehicle' }),
    );
    await screen.findByTestId('vehicle-row-browser-demo-vehicle-001');

    fireEvent.click(
      screen.getByRole('button', { name: 'Select legacy routes' }),
    );
    expect(screen.getByText(/will become active/)).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      scenario.manifest.scenarioId,
    );
    expect(screen.getByTestId('route-list')).not.toHaveTextContent(
      'legacy-A-torrevieja-la-mata',
    );
    expect(
      screen.getByTestId('vehicle-row-browser-demo-vehicle-001'),
    ).toBeInTheDocument();

    openSessionControls();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close transport Worker' }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start new transport session',
      }),
    );
    await screen.findByTestId('game-shell');
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        legacyScenario.manifest.scenarioId,
      ),
    );
    const legacyGraph = buildDirectedScenarioGraph(legacyScenario);
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-content-hash',
      legacyScenario.manifest.contentHash,
    );
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-node-count',
      String(legacyGraph.nodes.length),
    );
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-directed-edge-count',
      String(legacyGraph.edges.length),
    );
    expect(
      screen.queryByTestId('vehicle-row-browser-demo-vehicle-001'),
    ).toBeNull();
    expect(screen.getByTestId('route-list')).toHaveAttribute(
      'data-authoritative-scenario-id',
      legacyScenario.manifest.scenarioId,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select scenario A' }));
    expect(screen.getByTestId('route-list')).toHaveAttribute(
      'data-authoritative-scenario-id',
      legacyScenario.manifest.scenarioId,
    );
    openSessionControls();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close transport Worker' }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start new transport session',
      }),
    );
    await screen.findByTestId('game-shell');
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
        'data-scenario-id',
        scenario.manifest.scenarioId,
      ),
    );
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-node-count',
      String(initialGraph.nodes.length),
    );
    expect(
      screen
        .getByTestId('route-list')
        .querySelector('[data-route-id="legacy-A"]'),
    ).toBeNull();
  }, 20_000);

  it('constructs demo vehicle commands from restored disjoint authority, not selection or stack seed', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    await renderAppWithControls();
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    openSessionControls();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save transport session' }),
      ).toBeEnabled(),
    );
    openSimulationControls();

    for (const count of [1, 2, 3]) {
      fireEvent.click(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      );
      await waitFor(() =>
        expect(screen.getByTestId('vehicle-count')).toHaveTextContent(
          String(count),
        ),
      );
    }
    fireEvent.click(
      screen.getByRole('button', { name: 'Start browser-demo-vehicle-001' }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('vehicle-row-browser-demo-vehicle-001'),
      ).toHaveAttribute('data-movement-kind', 'running-at-stop'),
    );
    const fleetA = fleetTuples();

    openSessionControls();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save transport session' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('manual-save-availability')).toHaveTextContent(
        'available',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select scenario B' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close transport Worker' }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start new transport session',
      }),
    );
    await screen.findByTestId('game-shell');
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'scenario-b',
      ),
    );
    await pauseSimulation();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      ).toBeEnabled(),
    );
    for (const count of [1, 2]) {
      fireEvent.click(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      );
      await waitFor(() =>
        expect(screen.getByTestId('vehicle-count')).toHaveTextContent(
          String(count),
        ),
      );
    }
    fireEvent.click(
      screen.getByRole('button', { name: 'Start browser-demo-vehicle-001' }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('vehicle-row-browser-demo-vehicle-001'),
      ).toHaveAttribute('data-movement-kind', 'running-at-stop'),
    );
    const fleetB = fleetTuples();
    openSessionControls();
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Autosave' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save autosave now' }));
    await waitFor(() =>
      expect(screen.getByTestId('autosave-availability')).toHaveTextContent(
        /^Autosave: available$/,
      ),
    );
    expect(
      screen.getByTestId('save-library').querySelectorAll('[data-save-id]'),
    ).toHaveLength(2);
    expect(screen.getByTestId('save-library')).toHaveTextContent(
      'torrevieja-mini-v1',
    );
    expect(screen.getByTestId('save-library')).toHaveTextContent('scenario-b');

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Manual' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Manual' })).toBeChecked(),
    );
    expect(
      document.querySelector(
        `[data-authoritative-scenario-id="${alternateScenario.manifest.scenarioId}"]`,
      ),
    ).toBeInTheDocument();
    const actionBars = document.querySelectorAll(
      '.representation-view-actions',
    );
    expect(actionBars).toHaveLength(1);
    expect(
      within(actionBars[0] as HTMLElement).getByRole('button', {
        name: 'Hide population',
      }),
    ).toBeVisible();
    expect(
      within(actionBars[0] as HTMLElement).getByRole('button', {
        name: 'Hide passengers',
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hide population' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide passengers' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select mini representation for swap',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Swap visualizations' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Show population' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Show passengers' }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select mini representation for swap',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Swap visualizations' }),
    );
    expect(
      screen.getByRole('button', { name: 'Show population' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Show passengers' }),
    ).toBeVisible();
    deferredPopulation = {
      scenarioId: scenario.manifest.scenarioId,
      skipMatchingCalls: 0,
    };
    const manualA = createScenarioScopedSaveTarget(
      'manual',
      createScenarioCoordinate(scenario),
    );
    const manualRow = document.querySelector(`[data-save-id="${manualA}"]`)!;
    fireEvent.click(within(manualRow as HTMLElement).getByRole('button'));
    openSimulationControls();
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'torrevieja-mini-v1',
      ),
    );
    expect(screen.queryByTestId('population-band')).toBeNull();
    await waitFor(() =>
      expect(deferredPopulation?.release).toBeTypeOf('function'),
    );
    deferredPopulation?.release?.();
    await screen.findByRole('button', {
      name: 'Hide population',
    });
    expect(
      screen.getByRole('button', { name: 'Hide passengers' }),
    ).toBeVisible();
    expect(screen.getByTestId('population-band')).toBeInTheDocument();
    expect(
      document.querySelector(
        `[data-authoritative-scenario-id="${scenario.manifest.scenarioId}"]`,
      ),
    ).toBeInTheDocument();
    expect(
      document.querySelector(
        `[data-authoritative-scenario-id="${alternateScenario.manifest.scenarioId}"]`,
      ),
    ).toBeNull();
    expect(screen.getByTestId('selected-scenario')).toHaveTextContent(
      'scenario-b',
    );
    expect(screen.getByTestId('vehicle-count')).toHaveTextContent('3');
    expect(fleetTuples()).toEqual(fleetA);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create demo vehicle' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-count')).toHaveTextContent('4'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-pattern')).toHaveTextContent(
        'legacy-A2-torrevieja-la-mata',
      ),
    );
    expect(screen.getByTestId('vehicle-pattern')).not.toHaveTextContent(
      'scenario-b-pattern',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select scenario A' }));
    expect(screen.getByTestId('selected-scenario')).toHaveTextContent(
      'torrevieja-mini-v1',
    );
    openSessionControls();
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Autosave' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeChecked(),
    );
    const autosaveB = createScenarioScopedSaveTarget(
      'autosave',
      createScenarioCoordinate(alternateScenario),
    );
    const autosaveRow = document.querySelector(
      `[data-save-id="${autosaveB}"]`,
    )!;
    fireEvent.click(within(autosaveRow as HTMLElement).getByRole('button'));
    openSimulationControls();
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'scenario-b',
      ),
    );
    expect(screen.getByTestId('vehicle-count')).toHaveTextContent('2');
    expect(fleetTuples()).toEqual(fleetB);
    expect(screen.getByTestId('selected-scenario')).toHaveTextContent(
      'torrevieja-mini-v1',
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create demo vehicle' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-count')).toHaveTextContent('3'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vehicle-pattern')).toHaveTextContent(
        'scenario-b-pattern',
      ),
    );
    expect(screen.getByTestId('vehicle-pattern')).not.toHaveTextContent(
      'legacy-A2-torrevieja-la-mata',
    );
  }, 15_000);
});
