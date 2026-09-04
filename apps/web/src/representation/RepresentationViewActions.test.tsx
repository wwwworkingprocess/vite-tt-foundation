import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RepresentationModeProvider } from './RepresentationModeContext.js';
import { RepresentationViewActions } from './RepresentationViewActions.js';

it('exposes view actions only in the primary normal representation slot', () => {
  const view = (mode: 'normal' | 'mini') => (
    <RepresentationModeProvider mode={mode}>
      <RepresentationViewActions>
        <button type="button">View action</button>
      </RepresentationViewActions>
    </RepresentationModeProvider>
  );
  const rendered = render(view('normal'));
  expect(screen.getByRole('button', { name: 'View action' })).toBeVisible();
  rendered.rerender(view('mini'));
  expect(screen.queryByRole('button', { name: 'View action' })).toBeNull();
  rendered.rerender(view('normal'));
  expect(screen.getByRole('button', { name: 'View action' })).toBeVisible();
});
