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
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { createScenarioCoordinate } from '@torrevieja-tycoon/simulation';
import { useRef } from 'react';
import { createScenarioScopedSaveTarget } from './transport-simulation/scenario-save-target.js';

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

vi.mock('./scenarios/ScenarioPanel.js', () => ({
  ScenarioPanel: ({
    onScenarioReady,
    onResolverReady,
    onSelectionChange,
  }: {
    onScenarioReady(value: typeof scenario): void;
    onSelectionChange?(value: {
      requestedScenarioId?: string;
      status: 'idle' | 'loading' | 'ready' | 'failed';
      scenario?: typeof scenario;
      message?: string;
    }): void;
    onResolverReady?(
      resolve: (coordinate: { scenarioId: string }) => Promise<typeof scenario>,
    ): void;
  }) => {
    const emitted = useRef(false);
    if (!emitted.current) {
      emitted.current = true;
      queueMicrotask(() => {
        onResolverReady?.((coordinate) =>
          Promise.resolve(
            coordinate.scenarioId === alternateScenario.manifest.scenarioId
              ? alternateScenario
              : scenario,
          ),
        );
        onScenarioReady(scenario);
        onSelectionChange?.({
          requestedScenarioId: scenario.manifest.scenarioId,
          status: 'ready',
          scenario,
        });
      });
    }
    return (
      <div>
        Scenario fixture
        <button
          onClick={() => {
            onScenarioReady(alternateScenario);
            onSelectionChange?.({
              requestedScenarioId: alternateScenario.manifest.scenarioId,
              status: 'ready',
              scenario: alternateScenario as typeof scenario,
            });
          }}
        >
          Select scenario B
        </button>
        <button
          onClick={() => {
            onScenarioReady(scenario);
            onSelectionChange?.({
              requestedScenarioId: scenario.manifest.scenarioId,
              status: 'ready',
              scenario,
            });
          }}
        >
          Select scenario A
        </button>
        <button
          onClick={() =>
            onSelectionChange?.({
              requestedScenarioId: alternateScenario.manifest.scenarioId,
              status: 'loading',
            })
          }
        >
          Request scenario B
        </button>
        <button
          onClick={() =>
            onSelectionChange?.({
              requestedScenarioId: alternateScenario.manifest.scenarioId,
              status: 'failed',
              message: 'Scenario B failed',
            })
          }
        >
          Fail scenario B
        </button>
      </div>
    );
  },
}));

vi.mock('./transport-simulation/browser-transport-worker.js', async () => {
  const { startTransportWorkerRuntime } =
    await import('./transport-simulation/worker-transport-client.js');
  return {
    createBrowserTransportWorker: () => {
      const clientListeners = new Set<(event: { data: unknown }) => void>();
      const clientErrorListeners = new Set<
        (event: { data: unknown; error?: unknown }) => void
      >();
      const runtimeListeners = new Set<(event: { data: unknown }) => void>();
      const runtime = startTransportWorkerRuntime({
        postMessage: (message) =>
          queueMicrotask(() =>
            clientListeners.forEach((listener) =>
              listener({ data: structuredClone(message) }),
            ),
          ),
        addEventListener: (_type, listener) => runtimeListeners.add(listener),
        removeEventListener: (_type, listener) =>
          runtimeListeners.delete(listener),
      });
      return {
        postMessage: (message: unknown) =>
          queueMicrotask(() =>
            runtimeListeners.forEach((listener) =>
              listener({ data: structuredClone(message) }),
            ),
          ),
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('foundation screen', () => {
  it('identifies the app and starts the renderer boundary', async () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Torrevieja Tycoon' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('standalone simulation package'),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('r3f-canvas')).toBeInTheDocument();
  });

  it('reports Worker readiness, advancement, and cleanup', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create demo vehicle' }),
      ).toBeEnabled(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('worker-tick')).toHaveTextContent('0'),
    );
    expect(screen.getByTestId('scenario-coordinate')).toHaveTextContent(
      '1.0.0:torrevieja-mini-v1@1.0.0#',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Close transport Worker' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('closed'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Start new transport session' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    expect(screen.getByTestId('worker-timeline')).toHaveTextContent(
      'browser-foundation-timeline-2',
    );
  });

  it('does not replace ready authority when loader selection changes', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    const intervals = vi.spyOn(window, 'setInterval');
    const clears = vi.spyOn(window, 'clearInterval');
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    const timeline = screen.getByTestId('worker-timeline').textContent;
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      'torrevieja-mini-v1',
    );
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
    fireEvent.click(
      screen.getByRole('button', { name: 'Close transport Worker' }),
    );
    const start = await screen.findByRole('button', {
      name: 'Start new transport session',
    });
    fireEvent.click(start);
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'scenario-b',
      ),
    );
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeEnabled();
      expect(
        intervals.mock.calls.filter(
          ([, milliseconds]) => milliseconds === 30_000,
        ),
      ).toHaveLength(initialAutosaveSchedules + 1);
    });
    expect(clears).toHaveBeenCalled();
    expect(screen.getByTestId('worker-status')).toHaveTextContent('ready');
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      'scenario-b',
    );
  });

  it('never starts the previous ready package while a requested selection is pending or failed', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Close transport Worker' }),
    );
    const start = await screen.findByRole('button', {
      name: 'Start new transport session',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request scenario B' }));
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
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'scenario-b',
      ),
    );
  });

  it('exposes deterministic vehicle diagnostics from the authoritative Worker', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);
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
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() =>
      expect(screen.getByTestId('pacing-status')).toHaveTextContent('paused'),
    );
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

  it('constructs demo vehicle commands from restored disjoint authority, not selection or stack seed', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save transport session' }),
      ).toBeEnabled(),
    );

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
      screen.getByRole('button', { name: 'Close transport Worker' }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start new transport session',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'scenario-b',
      ),
    );
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
    const manualA = createScenarioScopedSaveTarget(
      'manual',
      createScenarioCoordinate(scenario),
    );
    const manualRow = document.querySelector(`[data-save-id="${manualA}"]`)!;
    fireEvent.click(within(manualRow as HTMLElement).getByRole('button'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'torrevieja-mini-v1',
      ),
    );
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
