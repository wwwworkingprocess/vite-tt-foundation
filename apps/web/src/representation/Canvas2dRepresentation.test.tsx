import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as profiler from '../performance/representation-profiler.js';
import { Canvas2dRepresentation } from './Canvas2dRepresentation.js';
import { RepresentationModeProvider } from './RepresentationModeContext.js';

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
};
let resize: ResizeObserverCallback;
const disconnect = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnect();
      }
    },
  );
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 2,
  });
});
afterEach(() => {
  profiler.configureRepresentationProfiling(false);
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('owns strict-mode resize, cadence, DPR backing store, profiling, and cleanup', () => {
  profiler.configureRepresentationProfiling(true);
  const record = vi.spyOn(profiler, 'recordRepresentationProfile');
  const { unmount } = render(
    <StrictMode>
      <RepresentationModeProvider mode="mini">
        <Canvas2dRepresentation />
      </RepresentationModeProvider>
    </StrictMode>,
  );
  const canvas = screen.getByRole('img', {
    name: 'Canvas 2D foundation representation',
  });
  expect(canvas).not.toHaveAttribute('tabindex');
  resize(
    [{ contentRect: { width: 100, height: 50 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(200);
  expect(canvas).toHaveAttribute('width', '200');
  expect(canvas).toHaveAttribute('height', '100');
  expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 3,
  });
  vi.advanceTimersByTime(200);
  expect(canvas).toHaveAttribute('width', '300');
  expect(record).toHaveBeenCalledWith(
    'canvas2d.frame',
    expect.objectContaining({ devicePixelRatio: 3 }),
  );
  const draws = context.fillRect.mock.calls.length;
  unmount();
  vi.advanceTimersByTime(1_000);
  expect(context.fillRect).toHaveBeenCalledTimes(draws);
  expect(disconnect).toHaveBeenCalled();
});

it('handles unavailable drawing state, invalid DPR, and mode changes deterministically', () => {
  const { rerender } = render(
    <RepresentationModeProvider mode="mini">
      <Canvas2dRepresentation />
    </RepresentationModeProvider>,
  );
  resize([], {} as ResizeObserver);
  vi.advanceTimersByTime(200);
  resize(
    [{ contentRect: { width: 0, height: 20 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(200);
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
  resize(
    [{ contentRect: { width: 20, height: 0 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(200);
  vi.advanceTimersByTime(200);
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 0,
  });
  resize(
    [{ contentRect: { width: 20, height: 20 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(200);
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: Number.NaN,
  });
  resize(
    [{ contentRect: { width: 20, height: 20 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  rerender(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation />
    </RepresentationModeProvider>,
  );
  vi.advanceTimersByTime(17);
  expect(context.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
});
