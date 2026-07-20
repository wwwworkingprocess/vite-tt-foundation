import 'fake-indexeddb/auto';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { useRef } from 'react';

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
  }: {
    onScenarioReady(value: typeof scenario): void;
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
      });
    }
    return (
      <div>
        Scenario fixture
        <button onClick={() => onScenarioReady(alternateScenario)}>
          Select scenario B
        </button>
        <button onClick={() => onScenarioReady(scenario)}>
          Select scenario A
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
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    const timeline = screen.getByTestId('worker-timeline').textContent;
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      'torrevieja-mini-v1',
    );
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
    expect(screen.getByTestId('worker-status')).toHaveTextContent('ready');
    expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
      'data-scenario-id',
      'scenario-b',
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
    expect(screen.getByTestId('vehicle-id')).toHaveTextContent(
      'browser-demo-vehicle',
    );
    expect(screen.getByTestId('vehicle-movement')).toHaveTextContent(
      'parked-at-stop',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start demo vehicle' }));
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
    const position = screen.getByTestId('vehicle-position');
    expect(position).toHaveAttribute('data-vehicle-id', 'browser-demo-vehicle');
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
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Autosave' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Autosave' })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save autosave now' }));
    await waitFor(() =>
      expect(screen.getByTestId('autosave-availability')).toHaveTextContent(
        'available',
      ),
    );

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Manual' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Manual' })).toBeChecked(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Restore manual save' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Restore manual save' }),
    );
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'torrevieja-mini-v1',
      ),
    );
    expect(screen.getByTestId('selected-scenario')).toHaveTextContent(
      'scenario-b',
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
    fireEvent.click(screen.getByRole('button', { name: 'Restore autosave' }));
    await waitFor(() =>
      expect(screen.getByTestId('active-scenario')).toHaveTextContent(
        'scenario-b',
      ),
    );
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
      expect(screen.getByTestId('vehicle-pattern')).toHaveTextContent(
        'scenario-b-pattern',
      ),
    );
    expect(screen.getByTestId('vehicle-pattern')).not.toHaveTextContent(
      'legacy-A2-torrevieja-la-mata',
    );
  });
});
