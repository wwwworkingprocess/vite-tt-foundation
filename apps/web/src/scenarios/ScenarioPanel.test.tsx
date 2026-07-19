import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const state = {
    status: 'ready' as const,
    selectedScenarioId: 'torrevieja-v1',
    title: 'Torrevieja',
    settlementCount: 1,
    routeCount: 1,
    catalog: {
      scenarios: [{ scenarioId: 'torrevieja-v1', title: 'Torrevieja' }],
    },
    graph: { summary: { nodes: 231, routes: 1, patterns: 2, edges: 6 } },
  };
  return {
    state,
    loadCatalog: vi.fn(async () => undefined),
    loadScenario: vi.fn(async () => undefined),
  };
});
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
  }),
}));

import { ScenarioPanel } from './ScenarioPanel.js';

it('presents the selected scenario summary and selection action', async () => {
  render(<ScenarioPanel />);
  expect(await screen.findByText('231')).toBeInTheDocument();
  expect(screen.getByText('Directed edges').nextSibling).toHaveTextContent('6');
  fireEvent.change(screen.getByLabelText('Scenario'), {
    target: { value: 'torrevieja-v1' },
  });
  expect(fake.loadScenario).toHaveBeenCalledWith('torrevieja-v1');
});
