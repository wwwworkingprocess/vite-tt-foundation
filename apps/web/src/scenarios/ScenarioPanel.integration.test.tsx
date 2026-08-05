import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScenarioPanel } from './ScenarioPanel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('presents an empty catalogue without requesting a default scenario', async () => {
  const fetchText = vi.fn(async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        schemaVersion: '1.0.0',
        catalogId: 'empty-scenario-catalogue',
        scenarios: [],
      }),
  }));
  vi.stubGlobal('fetch', fetchText);
  const ready = vi.fn();
  const selection = vi.fn();

  render(
    <ScenarioPanel onScenarioReady={ready} onSelectionChange={selection} />,
  );

  await waitFor(() =>
    expect(screen.getByTestId('scenario-status')).toHaveTextContent(
      'Scenario status: idle',
    ),
  );

  expect(fetchText).toHaveBeenCalledOnce();
  expect(fetchText).toHaveBeenCalledWith('/scenarios/catalog.json');
  const select = screen.getByRole('combobox', { name: 'Scenario' });
  expect(select).toBeEnabled();
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(
    screen.getByRole('option', { name: 'Select a scenario' }),
  ).toBeDisabled();
  expect(ready).not.toHaveBeenCalled();
  expect(selection).toHaveBeenLastCalledWith({
    requestedScenarioId: undefined,
    status: 'idle',
  });
});
