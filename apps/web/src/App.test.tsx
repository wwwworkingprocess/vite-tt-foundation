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
const alternateScenario = parseScenarioPackage({
  manifest: alternateManifest,
  settlements: alternate('settlements.json'),
  stops: alternate('stops.json'),
  routes: alternate('routes.json'),
  presentation: alternate('presentation.json'),
  provenance: alternate('provenance.json'),
});

vi.mock('./scenarios/ScenarioPanel.js', () => ({
  ScenarioPanel: ({
    onScenarioReady,
  }: {
    onScenarioReady(value: typeof scenario): void;
  }) => {
    const emitted = useRef(false);
    if (!emitted.current) {
      emitted.current = true;
      queueMicrotask(() => onScenarioReady(scenario));
    }
    return (
      <div>
        Scenario fixture
        <button onClick={() => onScenarioReady(alternateScenario)}>
          Select scenario B
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
  });
});
