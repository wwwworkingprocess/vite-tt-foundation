import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GameShell } from './GameShell.js';

afterEach(cleanup);

const renderShell = (save = vi.fn(async () => {})) => {
  const restart = vi.fn();
  render(
    <GameShell
      status="ready"
      pacingStatus="paused"
      persistenceStatus="idle"
      projectInfo={<p>Project metadata</p>}
      simulationControls={
        <>
          <label>
            Route choice
            <input />
          </label>
        </>
      }
      sessionControls={
        <>
          <p>Save mode</p>
          <p>Save library</p>
        </>
      }
      scenarioControl={
        <label>
          Scenario
          <select>
            <option>Legacy</option>
          </select>
        </label>
      }
      primaryVisualization={<div data-testid="svg-identity">SVG</div>}
      secondaryVisualization={<div data-testid="r3f-identity">R3F</div>}
      onPauseResume={vi.fn()}
      onSave={save}
      onRestart={restart}
    />,
  );
  return { save, restart };
};

it('renders a viewport shell with compact navigation and paired stable views', () => {
  renderShell();
  expect(screen.getByTestId('game-shell')).toBeInTheDocument();
  expect(screen.getByTestId('top-navigation')).toBeInTheDocument();
  expect(screen.getByTestId('visualization-workspace')).toBeInTheDocument();
  expect(screen.getByTestId('primary-visualization')).toContainElement(
    screen.getByTestId('svg-identity'),
  );
  expect(screen.getByTestId('secondary-minimap')).toContainElement(
    screen.getByTestId('r3f-identity'),
  );

  fireEvent.click(screen.getByRole('button', { name: 'Swap visualizations' }));
  expect(screen.getByTestId('primary-visualization')).toHaveAttribute(
    'data-view',
    'three',
  );
  expect(screen.getByTestId('secondary-minimap')).toHaveAttribute(
    'data-view',
    'transport',
  );
  expect(screen.getByTestId('svg-identity')).toBeInTheDocument();
  expect(screen.getByTestId('r3f-identity')).toBeInTheDocument();
});

it.each([
  ['Project info', 'Project information', 'Project metadata'],
  ['Simulation controls', 'Simulation controls', 'Route choice'],
  ['Load', 'Saved sessions', 'Save library'],
] as const)(
  'opens %s accessibly, closes with Escape, and returns focus',
  async (triggerName, dialogName, content) => {
    renderShell();
    const trigger = screen.getByRole('button', { name: triggerName });
    trigger.focus();
    fireEvent.click(trigger);
    expect(
      await screen.findByRole('dialog', { name: dialogName }),
    ).toHaveTextContent(content);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: dialogName })).toBeNull();
    expect(trigger).toHaveFocus();
  },
);

it('keeps simulation and saved-session content separate', async () => {
  renderShell();
  fireEvent.click(screen.getByRole('button', { name: 'Simulation controls' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Route choice');
  expect(screen.getByRole('dialog')).not.toHaveTextContent('Save library');
  fireEvent.click(
    screen.getByRole('button', { name: 'Close Simulation controls' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Save library');
  expect(screen.getByRole('dialog')).not.toHaveTextContent('Route choice');
});

it('closes dialogs from the backdrop and keeps direct session actions accessible', async () => {
  const { save, restart } = renderShell();
  fireEvent.click(screen.getByRole('button', { name: 'Project info' }));
  await screen.findByRole('dialog');
  fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'));
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
  expect(save).toHaveBeenCalledOnce();
  expect(restart).toHaveBeenCalledOnce();
});

it('announces successful and failed navigation saves', async () => {
  const success = vi.fn(async () => {});
  renderShell(success);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/Save completed\./)).toBeInTheDocument();
  cleanup();

  const failure = vi.fn(async () => {
    throw new Error('Repository unavailable.');
  });
  renderShell(failure);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(
    await screen.findByText(/Repository unavailable\./),
  ).toBeInTheDocument();
});
