import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RepresentationModeProvider } from './RepresentationModeContext.js';
import { RepresentationViewActions } from './RepresentationViewActions.js';
import { TransportMapViewActions } from './TransportMapViewActions.js';

afterEach(cleanup);

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

it('composes both shared Map actions under the primary-only boundary', () => {
  const population = vi.fn();
  const passengers = vi.fn();
  const rendered = render(
    <RepresentationModeProvider mode="normal">
      <TransportMapViewActions
        populationVisible
        passengersVisible={false}
        onPopulationVisibleChange={population}
        onPassengersVisibleChange={passengers}
      />
    </RepresentationModeProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Hide population' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show passengers' }));
  expect(population).toHaveBeenCalledWith(false);
  expect(passengers).toHaveBeenCalledWith(true);
  rendered.rerender(
    <RepresentationModeProvider mode="mini">
      <TransportMapViewActions
        populationVisible
        passengersVisible={false}
        onPopulationVisibleChange={population}
        onPassengersVisibleChange={passengers}
      />
    </RepresentationModeProvider>,
  );
  expect(screen.queryByRole('button')).toBeNull();
});
