import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ScenarioLoaderState } from './scenario-loader.js';

afterEach(cleanup);

const fake = vi.hoisted(() => ({
  state: {
    status: 'ready' as const,
    selectedScenarioId: 'torrevieja-v1',
    title: 'Torrevieja',
    settlementCount: 1,
    routeCount: 1,
    catalog: {
      scenarios: [{ scenarioId: 'torrevieja-v1', title: 'Torrevieja' }],
    },
    graph: { summary: { nodes: 231, routes: 1, patterns: 2, edges: 6 } },
    scenario: { manifest: { scenarioId: 'torrevieja-v1' } },
  },
  loadCatalog: vi.fn(async () => undefined),
  loadScenario: vi.fn(async () => undefined),
  resolveScenario: vi.fn(async () => fake.state.scenario),
  listeners: new Set<(state: ScenarioLoaderState) => void>(),
}));

vi.mock('./scenario-loader.js', () => ({
  browserSha256: vi.fn(),
  createScenarioLoader: () => ({
    projection: {
      getState: () => fake.state,
      subscribe: (listener: (state: ScenarioLoaderState) => void) => {
        fake.listeners.add(listener);
        listener(fake.state as unknown as ScenarioLoaderState);
        return () => fake.listeners.delete(listener);
      },
    },
    loadCatalog: fake.loadCatalog,
    loadScenario: fake.loadScenario,
    resolveScenario: fake.resolveScenario,
  }),
}));

import { ScenarioPanel } from './ScenarioPanel.js';

it('presents the scenario and supplies it to the single session composition', async () => {
  const ready = vi.fn();
  const resolver = vi.fn();
  const selection = vi.fn();
  render(
    <ScenarioPanel
      onScenarioReady={ready}
      onResolverReady={resolver}
      onSelectionChange={selection}
    />,
  );
  expect(await screen.findByText('231')).toBeInTheDocument();
  expect(screen.getByText('Directed edges').nextSibling).toHaveTextContent('6');
  expect(ready).toHaveBeenCalledWith(fake.state.scenario);
  expect(resolver).toHaveBeenCalledWith(fake.resolveScenario);
  expect(selection).toHaveBeenCalledWith(
    expect.objectContaining({
      requestedScenarioId: 'torrevieja-v1',
      status: 'ready',
      scenario: fake.state.scenario,
    }),
  );
  fireEvent.change(screen.getByLabelText('Scenario'), {
    target: { value: 'torrevieja-v1' },
  });
  expect(fake.loadScenario).toHaveBeenCalledWith('torrevieja-v1');
  expect(
    screen.queryByRole('button', { name: 'Start selected scenario' }),
  ).not.toBeInTheDocument();
});

it('allows catalogue presentation without composition callbacks', async () => {
  render(<ScenarioPanel />);
  expect(
    await screen.findByRole('heading', { name: 'Transport scenario' }),
  ).toBeInTheDocument();
});

it('reports requested loading and failure states and offers retry', async () => {
  const selection = vi.fn();
  render(<ScenarioPanel onSelectionChange={selection} />);
  const loading = {
    status: 'loading-scenario' as const,
    catalog: fake.state.catalog,
    selectedScenarioId: 'scenario-b',
  };
  for (const listener of fake.listeners)
    listener(loading as unknown as ScenarioLoaderState);
  await waitFor(() =>
    expect(selection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestedScenarioId: 'scenario-b',
        status: 'loading',
      }),
    ),
  );

  const failed = {
    status: 'failed' as const,
    catalog: fake.state.catalog,
    selectedScenarioId: 'scenario-b',
    message: 'load failed',
  };
  for (const listener of fake.listeners)
    listener(failed as unknown as ScenarioLoaderState);
  const retry = await screen.findByRole('button', {
    name: 'Retry selected scenario',
  });
  fireEvent.click(retry);
  expect(fake.loadScenario).toHaveBeenLastCalledWith('scenario-b');
});
