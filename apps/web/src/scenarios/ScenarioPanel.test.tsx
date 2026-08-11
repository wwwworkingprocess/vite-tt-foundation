import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScenarioPanel } from './ScenarioPanel.js';
import type { ScenarioLoaderState } from './scenario-loader.js';

afterEach(cleanup);

const state = {
  status: 'ready',
  selectedScenarioId: 'torrevieja-v1',
  title: 'Torrevieja',
  settlementCount: 1,
  routeCount: 1,
  catalog: {
    scenarios: [
      {
        scenarioId: 'torrevieja-v1',
        title: 'Torrevieja',
        primarySettlementId: 'es-torrevieja',
      },
      {
        scenarioId: 'torrevieja-legacy-abc-v1',
        title: 'Legacy',
        primarySettlementId: 'es-torrevieja',
      },
      {
        scenarioId: 'elche-urban-abc-v1',
        title: 'Elche Urban',
        primarySettlementId: 'es-elche',
      },
    ],
  },
  graph: { summary: { nodes: 231, routes: 1, patterns: 2, edges: 6 } },
  scenario: { manifest: { scenarioId: 'torrevieja-v1' } },
} as unknown as ScenarioLoaderState;

it('renders controlled canonical city groups and scenario intent', () => {
  const onScenarioChange = vi.fn();
  render(
    <ScenarioPanel
      state={state}
      cityNames={{ 'es-torrevieja': 'Torrevieja', 'es-elche': 'Elche' }}
      onScenarioChange={onScenarioChange}
    />,
  );
  expect(screen.getByText('231')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('City'), {
    target: { value: 'es-elche' },
  });
  expect(onScenarioChange).toHaveBeenCalledWith('elche-urban-abc-v1');
  fireEvent.change(screen.getByLabelText('Scenario'), {
    target: { value: 'torrevieja-legacy-abc-v1' },
  });
  expect(onScenarioChange).toHaveBeenCalledWith('torrevieja-legacy-abc-v1');
  fireEvent.change(screen.getByLabelText('City'), {
    target: { value: 'missing-city' },
  });
});

it('uses stable settlement IDs and disables unresolved catalogues', () => {
  const view = render(
    <ScenarioPanel state={state} cityNames={{}} onScenarioChange={vi.fn()} />,
  );
  expect(screen.getByRole('option', { name: 'es-elche' })).toBeInTheDocument();
  view.rerender(
    <ScenarioPanel
      state={{ status: 'idle' }}
      cityNames={{}}
      onScenarioChange={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('City')).toBeDisabled();
});

it('exposes retry for the controlled failed selection', () => {
  const onScenarioChange = vi.fn();
  render(
    <ScenarioPanel
      state={{ ...state, status: 'failed', message: 'failed' }}
      cityNames={{}}
      onScenarioChange={onScenarioChange}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry selected scenario' }),
  );
  expect(onScenarioChange).toHaveBeenCalledWith('torrevieja-v1');
});

it('disables every scenario intent control while its owner is busy', () => {
  render(
    <ScenarioPanel
      state={{ ...state, status: 'failed', message: 'failed' }}
      cityNames={{}}
      disabled
      onScenarioChange={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('City')).toBeDisabled();
  expect(screen.getByLabelText('Scenario')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Retry selected scenario' }),
  ).toBeDisabled();
});
