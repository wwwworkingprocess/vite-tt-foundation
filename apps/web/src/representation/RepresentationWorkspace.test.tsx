import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { RepresentationWorkspace } from './RepresentationWorkspace.js';
import { RepresentationViewActions } from './RepresentationViewActions.js';
import { supportsRepresentationView } from './representation-view-capabilities.js';

afterEach(cleanup);

const expectWorkspacePairsSupported = () => {
  for (const testId of ['primary-visualization', 'secondary-minimap']) {
    const slot = screen.getByTestId(testId);
    expect(
      supportsRepresentationView(
        slot.getAttribute('data-family') ?? '',
        slot.getAttribute('data-view') ?? '',
      ),
    ).toBe(true);
  }
  const workspace = screen.getByTestId('visualization-workspace');
  expect(
    supportsRepresentationView(
      workspace.getAttribute('data-inactive-family') ?? '',
      workspace.getAttribute('data-inactive-view') ?? '',
    ),
  ).toBe(true);
};

function ControlledWorkspace() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open StopPlace details
      </button>
      <RepresentationWorkspace
        domTwoDimensional={<button type="button">SVG StopPlace</button>}
        canvasTwoDimensional={<div>Canvas scene</div>}
        threeDimensional={<div>3D scene</div>}
        modal={
          open
            ? {
                title: 'Hotel Fontana',
                content: <p>Topology</p>,
                onClose: () => setOpen(false),
              }
            : undefined
        }
      />
    </>
  );
}

it('keeps modal and mini-swap transient modes mutually exclusive', () => {
  render(<ControlledWorkspace />);
  const open = screen.getByRole('button', { name: 'Open StopPlace details' });
  const mini = screen.getByRole('button', {
    name: 'Select mini representation for swap',
  });
  fireEvent.click(mini);
  expect(
    screen.getByRole('button', { name: 'Swap visualizations' }),
  ).toBeInTheDocument();
  fireEvent.click(open);
  expect(
    screen.getByRole('dialog', { name: 'Hotel Fontana' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Swap visualizations' }),
  ).toBeNull();
  fireEvent.click(mini);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Swap visualizations' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Swap visualizations' }));
  expect(screen.getByTestId('primary-visualization')).toHaveAttribute(
    'data-family',
    'd3d',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('mounts exactly two families and replaces only the mini with the inactive family', () => {
  render(<ControlledWorkspace />);
  expect(screen.getByTestId('primary-visualization')).toHaveAttribute(
    'data-family',
    'dom2d',
  );
  expect(screen.getByTestId('secondary-minimap')).toHaveAttribute(
    'data-family',
    'd3d',
  );
  expect(screen.getByTestId('primary-visualization')).toHaveAttribute(
    'data-view',
    'map',
  );
  expect(screen.getByTestId('secondary-minimap')).toHaveAttribute(
    'data-view',
    'main',
  );
  expect(screen.getByTestId('visualization-workspace')).toHaveAttribute(
    'data-inactive-view',
    'map',
  );
  expect(screen.queryByText('Canvas scene')).toBeNull();
  expectWorkspacePairsSupported();
  fireEvent.click(
    screen.getByRole('button', { name: 'Select mini representation for swap' }),
  );
  const miniSelector = screen.getByRole('button', {
    name: 'Select mini representation for swap',
  });
  const swap = screen.getByRole('button', { name: 'Swap visualizations' });
  const useCanvas = screen.getByRole('button', {
    name: 'Use Canvas 2D in mini',
  });
  const actions = swap.parentElement;
  expect(actions).toHaveClass('mini-representation-actions');
  expect(actions).toContainElement(useCanvas);
  expect(actions?.parentElement).toHaveClass('mini-representation-boundary');
  miniSelector.focus();
  swap.focus();
  expect(useCanvas).toBeInTheDocument();
  useCanvas.focus();
  expect(swap).toBeInTheDocument();
  fireEvent.click(useCanvas);
  expect(screen.getByTestId('primary-visualization')).toHaveAttribute(
    'data-family',
    'dom2d',
  );
  expect(screen.getByTestId('secondary-minimap')).toHaveAttribute(
    'data-family',
    'canvas2d',
  );
  expect(screen.getByTestId('secondary-minimap')).toHaveAttribute(
    'data-view',
    'map',
  );
  expect(screen.getByText('Canvas scene')).toBeInTheDocument();
  expect(screen.queryByText('3D scene')).toBeNull();
  expectWorkspacePairsSupported();
  expect(
    screen.queryByRole('button', { name: 'Swap visualizations' }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Select mini representation for swap' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Swap visualizations' }));
  expect(screen.getByTestId('primary-visualization')).toHaveAttribute(
    'data-family',
    'canvas2d',
  );
  expect(screen.getByTestId('primary-visualization')).toHaveAttribute(
    'data-view',
    'map',
  );
  expect(screen.getByTestId('secondary-minimap')).toHaveAttribute(
    'data-family',
    'dom2d',
  );
  expect(screen.getByTestId('visualization-workspace')).toHaveAttribute(
    'data-inactive-family',
    'd3d',
  );
  expect(screen.getByTestId('visualization-workspace')).toHaveAttribute(
    'data-inactive-view',
    'main',
  );
  expectWorkspacePairsSupported();
  fireEvent.click(
    screen.getByRole('button', { name: 'Select mini representation for swap' }),
  );
  expect(
    screen.getByRole('button', { name: 'Use 3D in mini' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use 3D in mini' }));
  expect(screen.getByTestId('secondary-minimap')).toHaveAttribute(
    'data-view',
    'main',
  );
  expectWorkspacePairsSupported();
  fireEvent.click(
    screen.getByRole('button', { name: 'Select mini representation for swap' }),
  );
  expect(
    screen.getByRole('button', { name: 'Use DOM 2D in mini' }),
  ).toBeInTheDocument();
});

it('keeps the mini boundary armed when mini activation closes an open modal', () => {
  render(<ControlledWorkspace />);
  const open = screen.getByRole('button', { name: 'Open StopPlace details' });
  open.focus();
  fireEvent.click(open);
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  const mini = screen.getByRole('button', {
    name: 'Select mini representation for swap',
  });
  mini.focus();
  expect(mini).toHaveFocus();
  fireEvent.click(mini);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mini).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Swap visualizations' }));
  expect(screen.getByTestId('primary-visualization')).toHaveAttribute(
    'data-family',
    'd3d',
  );
  expect(
    screen.queryByRole('button', { name: 'Swap visualizations' }),
  ).toBeNull();
});

it('closes the scoped modal with Escape and restores initiating focus', () => {
  render(<ControlledWorkspace />);
  const open = screen.getByRole('button', { name: 'Open StopPlace details' });
  open.focus();
  fireEvent.click(open);
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(open).toHaveFocus();
});

it.each(['Close', 'backdrop'] as const)(
  'restores initiating focus after an ordinary %s close',
  (closeMethod) => {
    render(<ControlledWorkspace />);
    const open = screen.getByRole('button', { name: 'Open StopPlace details' });
    open.focus();
    fireEvent.click(open);
    if (closeMethod === 'Close')
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    else
      fireEvent.mouseDown(screen.getByTestId('representation-modal-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(open).toHaveFocus();
  },
);

it('cancels an armed swap when focus genuinely leaves the mini boundary', () => {
  render(<ControlledWorkspace />);
  const mini = screen.getByRole('button', {
    name: 'Select mini representation for swap',
  });
  mini.focus();
  fireEvent.click(mini);
  expect(
    screen.getByRole('button', { name: 'Swap visualizations' }),
  ).toBeInTheDocument();
  const outside = screen.getByRole('button', {
    name: 'Open StopPlace details',
  });
  fireEvent.blur(mini, { relatedTarget: outside });
  outside.focus();
  expect(
    screen.queryByRole('button', { name: 'Swap visualizations' }),
  ).toBeNull();
});

it('opens safely when the initiating representation focus is not HTML', () => {
  render(<ControlledWorkspace />);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('tabindex', '0');
  document.body.append(svg);
  svg.focus();
  expect(document.activeElement).toBe(svg);
  fireEvent.click(
    screen.getByRole('button', { name: 'Open StopPlace details' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows DOM2D view actions only while primary and preserves their external state', () => {
  function ActionWorkspace() {
    const [visible, setVisible] = useState(true);
    return (
      <RepresentationWorkspace
        domTwoDimensional={
          <RepresentationViewActions>
            <button type="button" onClick={() => setVisible(!visible)}>
              {visible ? 'Hide layer' : 'Show layer'}
            </button>
          </RepresentationViewActions>
        }
        canvasTwoDimensional={<div>Canvas scene</div>}
        threeDimensional={<div>3D scene</div>}
      />
    );
  }
  render(<ActionWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Hide layer' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Select mini representation for swap' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Swap visualizations' }));
  expect(screen.queryByRole('button', { name: 'Show layer' })).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Select mini representation for swap' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Swap visualizations' }));
  expect(screen.getByRole('button', { name: 'Show layer' })).toBeVisible();
});
