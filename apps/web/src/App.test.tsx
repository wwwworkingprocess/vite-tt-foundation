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

vi.mock('./scenarios/ScenarioPanel.js', () => ({
  ScenarioPanel: ({
    onScenarioReady,
  }: {
    onScenarioReady(value: typeof scenario): void;
  }) => {
    queueMicrotask(() => onScenarioReady(scenario));
    return <div>Scenario fixture</div>;
  },
}));

vi.mock('./transport-simulation/browser-transport-worker.js', async () => {
  const { startTransportWorkerRuntime } =
    await import('./transport-simulation/worker-transport-client.js');
  return {
    createBrowserTransportWorker: () => {
      const clientListeners = new Set<(event: { data: unknown }) => void>();
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
          _type: 'message',
          listener: (event: { data: unknown }) => void,
        ) => clientListeners.add(listener),
        removeEventListener: (
          _type: 'message',
          listener: (event: { data: unknown }) => void,
        ) => clientListeners.delete(listener),
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
});
