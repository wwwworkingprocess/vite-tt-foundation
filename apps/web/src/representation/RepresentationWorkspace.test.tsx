import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { RepresentationWorkspace } from './RepresentationWorkspace.js';

afterEach(cleanup);

function ControlledWorkspace() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open StopPlace details
      </button>
      <RepresentationWorkspace
        twoDimensional={<button type="button">SVG StopPlace</button>}
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
    '3d',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
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
    '3d',
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
