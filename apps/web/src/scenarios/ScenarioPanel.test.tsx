import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

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
}));

vi.mock('./scenario-loader.js', () => ({
  browserSha256: vi.fn(),
  createScenarioLoader: () => ({
    projection: {
      getState: () => fake.state,
      subscribe: (listener: (state: typeof fake.state) => void) => {
        listener(fake.state);
        return () => undefined;
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
  render(<ScenarioPanel onScenarioReady={ready} onResolverReady={resolver} />);
  expect(await screen.findByText('231')).toBeInTheDocument();
  expect(screen.getByText('Directed edges').nextSibling).toHaveTextContent('6');
  expect(ready).toHaveBeenCalledWith(fake.state.scenario);
  expect(resolver).toHaveBeenCalledWith(fake.resolveScenario);
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
