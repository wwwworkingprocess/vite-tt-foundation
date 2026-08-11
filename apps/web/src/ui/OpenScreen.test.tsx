import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TransportSaveSummary } from '../transport-simulation/transport-save-record.js';
import OpenScreen from './OpenScreen.js';

afterEach(cleanup);
const save = Object.freeze({
  saveId: 'save',
  label: 'Elche save',
  scenarioSchemaVersion: '1.0.0',
  scenarioId: 'elche',
  scenarioVersion: '1.0.0',
  contentHash: 'a'.repeat(64),
  sourceTimelineId: 'timeline',
  sourceSimulationTick: 42,
  createdAtUtcMs: 0,
  updatedAtUtcMs: 3_600_000,
  snapshotVersion: 9,
  vehicleCount: 2,
  compatibility: 'current',
}) as TransportSaveSummary;
const renderOpen = (
  overrides: Partial<Parameters<typeof OpenScreen>[0]> = {},
) => {
  const onCreate = vi.fn();
  const onContinue = vi.fn();
  render(
    <OpenScreen
      state="open"
      scenarioChooser={<div>City chooser</div>}
      selectedScenarioReady
      resolverReady
      nowUtcMs={7_200_000}
      onCreate={onCreate}
      onContinue={onContinue}
      {...overrides}
    />,
  );
  return { onCreate, onContinue };
};

it('presents first-time creation and exact returning metadata', () => {
  const { onCreate } = renderOpen();
  fireEvent.click(screen.getByRole('button', { name: 'Start new game' }));
  expect(onCreate).toHaveBeenCalledOnce();
  cleanup();
  const { onContinue } = renderOpen({
    resumableSave: { ...save, label: undefined },
  });
  expect(screen.getByText('Saved at simulation tick 42')).toBeInTheDocument();
  expect(screen.getByText('Last played 1 hour ago')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue saved game' }));
  expect(onContinue).toHaveBeenCalledWith(
    expect.objectContaining({ saveId: save.saveId }),
  );
});

it('keeps Continue disabled until the exact resolver is ready', () => {
  const view = render(
    <OpenScreen
      state="open"
      scenarioChooser={null}
      selectedScenarioReady
      resolverReady={false}
      resumableSave={save}
      onCreate={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Continue saved game' }),
  ).toBeDisabled();
  view.rerender(
    <OpenScreen
      state="open"
      scenarioChooser={null}
      selectedScenarioReady
      resolverReady
      resumableSave={save}
      onCreate={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Continue saved game' }),
  ).toBeEnabled();
});

it.each([
  ['booting', 'Loading saved sessions and scenarios...'],
  ['creating', 'Creating authoritative game...'],
  ['restoring', 'Restoring authoritative game...'],
] as const)('owns and exposes the %s shell state', (state, message) => {
  renderOpen({ state, resumableSave: save });
  expect(screen.getByTestId('open-screen')).toHaveAttribute(
    'data-state',
    state,
  );
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Continue saved game' }),
  ).toBeDisabled();
});

it('shows recoverable bootstrap messages without inventing authority', () => {
  const onRetryBootstrap = vi.fn();
  renderOpen({
    state: 'recoverable-failure',
    selectedScenarioReady: false,
    unavailableSaveMessage: 'Save unavailable.',
    message: 'Bootstrap failed.',
    onRetryBootstrap,
  });
  expect(screen.getByRole('status')).toHaveTextContent('Save unavailable.');
  expect(screen.getByRole('alert')).toHaveTextContent('Bootstrap failed.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  expect(onRetryBootstrap).toHaveBeenCalledOnce();
});
