import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  RepresentationModeProvider,
  useLatestRepresentationValue,
  useRepresentationMode,
} from './RepresentationModeContext.js';

function Probe({ value }: Readonly<{ value: string }>) {
  const mode = useRepresentationMode();
  const latest = useLatestRepresentationValue(value);
  return <p>{`${mode}:${latest}`}</p>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('publishes the latest React representation value at the selected cadence', () => {
  vi.useFakeTimers();
  const view = render(
    <RepresentationModeProvider mode="mini">
      <Probe value="A" />
    </RepresentationModeProvider>,
  );
  expect(screen.getByText('mini:A')).toBeInTheDocument();
  view.rerender(
    <RepresentationModeProvider mode="mini">
      <Probe value="B" />
    </RepresentationModeProvider>,
  );
  expect(screen.getByText('mini:A')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByText('mini:B')).toBeInTheDocument();
  view.rerender(<Probe value="C" />);
  expect(screen.getByText('normal:C')).toBeInTheDocument();
  view.rerender(<Probe value="D" />);
  expect(screen.getByText('normal:C')).toBeInTheDocument();
  view.unmount();
  act(() => vi.runOnlyPendingTimers());
});

it('recreates its effect-owned throttle after StrictMode replay and cancels real unmount work', () => {
  vi.useFakeTimers();
  const view = render(
    <StrictMode>
      <RepresentationModeProvider mode="mini">
        <Probe value="A" />
      </RepresentationModeProvider>
    </StrictMode>,
  );
  expect(screen.getByText('mini:A')).toBeInTheDocument();

  view.rerender(
    <StrictMode>
      <RepresentationModeProvider mode="mini">
        <Probe value="B" />
      </RepresentationModeProvider>
    </StrictMode>,
  );
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByText('mini:B')).toBeInTheDocument();

  view.rerender(
    <StrictMode>
      <RepresentationModeProvider mode="mini">
        <Probe value="C" />
      </RepresentationModeProvider>
    </StrictMode>,
  );
  view.rerender(
    <StrictMode>
      <RepresentationModeProvider mode="mini">
        <Probe value="D" />
      </RepresentationModeProvider>
    </StrictMode>,
  );
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByText('mini:D')).toBeInTheDocument();

  view.rerender(
    <StrictMode>
      <RepresentationModeProvider mode="mini">
        <Probe value="E" />
      </RepresentationModeProvider>
    </StrictMode>,
  );
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
