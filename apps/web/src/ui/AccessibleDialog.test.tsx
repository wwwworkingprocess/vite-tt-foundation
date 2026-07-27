import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AccessibleDialog from './AccessibleDialog.js';

afterEach(cleanup);

it('focuses the close action and cycles focus forward and backward', () => {
  render(
    <AccessibleDialog title="Focus test" onClose={vi.fn()}>
      <button type="button">First body action</button>
      <button type="button">Last body action</button>
    </AccessibleDialog>,
  );
  const close = screen.getByRole('button', { name: 'Close Focus test' });
  const last = screen.getByRole('button', { name: 'Last body action' });
  expect(close).toHaveFocus();

  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(close).toHaveFocus();

  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
});

it('keeps reverse focus inside a dialog with only fallback panel focus', () => {
  render(
    <AccessibleDialog title="Fallback test" onClose={vi.fn()}>
      <p>No enabled body controls</p>
    </AccessibleDialog>,
  );
  const dialog = screen.getByRole('dialog');
  const close = screen.getByRole('button', { name: 'Close Fallback test' });
  close.setAttribute('disabled', '');
  dialog.focus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(dialog).toHaveFocus();
});
