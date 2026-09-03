import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  parseVehicleId,
  type VehicleState,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import * as profiler from '../performance/representation-profiler.js';
import { selectStop, selectVehicle } from '../ui/game-selection.js';
import { Canvas2dRepresentation } from './Canvas2dRepresentation.js';
import { RepresentationModeProvider } from './RepresentationModeContext.js';
import {
  createCanvas2dSelectionIndex,
  createCanvas2dSelectionSnapshot,
} from './canvas2d-selection-model.js';

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
};
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-legacy-abc-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});
const pattern = scenario.routes.routes[0]!.patterns[0]!;
const vehicleAt = (stopNodeId: string): VehicleState => ({
  vehicleId: parseVehicleId('canvas-vehicle'),
  label: 'Canvas vehicle',
  patternId: pattern.patternId,
  movementPlan: { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: [10] },
  movement: {
    kind: 'parked-at-stop',
    stopNodeId: stopNodeId as never,
    nextEdgeSequence: 0,
  },
});
const props = {
  scenario,
  fleet: [] as readonly VehicleState[],
  selection: null,
  onSelectionChange: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
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
        <Canvas2dRepresentation {...props} />
      </RepresentationModeProvider>
    </StrictMode>,
  );
  const canvas = screen.getByRole('img', {
    name: 'Canvas 2D directed route network with StopPlace and Vehicle selection',
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
      <Canvas2dRepresentation {...props} />
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
      <Canvas2dRepresentation {...props} />
    </RepresentationModeProvider>,
  );
  vi.advanceTimersByTime(17);
  expect(context.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
});

it('selects drawn StopPlaces and Vehicles in CSS coordinates while empty clicks do nothing', () => {
  const onSelectionChange = vi.fn();
  const firstNode = pattern.stopNodeIds[0]!;
  const fleet = [vehicleAt(firstNode)];
  render(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        fleet={fleet}
        onSelectionChange={onSelectionChange}
      />
    </RepresentationModeProvider>,
  );
  const canvas = screen.getByRole('group', {
    name: 'Canvas 2D directed route network with StopPlace and Vehicle selection',
  });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 200,
    height: 100,
  } as DOMRect);
  resize(
    [{ contentRect: { width: 200, height: 100 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(17);
  const snapshot = createCanvas2dSelectionSnapshot(
    createCanvas2dSelectionIndex(scenario),
    fleet,
    200,
    100,
  );
  const vehicle = snapshot.vehiclePoints[0]!;
  fireEvent.click(canvas, { clientX: vehicle.x + 10, clientY: vehicle.y + 20 });
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectVehicle(parseVehicleId('canvas-vehicle')),
  );
  const stop = snapshot.stopPoints.find(
    (point) => Math.hypot(point.x - vehicle.x, point.y - vehicle.y) > 12,
  )!;
  fireEvent.click(canvas, { clientX: stop.x + 10, clientY: stop.y + 20 });
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectStop(stop.stopPlaceId),
  );
  const calls = onSelectionChange.mock.calls.length;
  const edge = snapshot.routeEdges.find(({ from, to }) => {
    const x = (from.x + to.x) / 2;
    const y = (from.y + to.y) / 2;
    return [...snapshot.stopPoints, ...snapshot.vehiclePoints].every(
      (point) => Math.hypot(point.x - x, point.y - y) > 12,
    );
  })!;
  fireEvent.click(canvas, {
    clientX: (edge.from.x + edge.to.x) / 2 + 10,
    clientY: (edge.from.y + edge.to.y) / 2 + 20,
  });
  expect(onSelectionChange).toHaveBeenCalledTimes(calls);
  fireEvent.click(canvas, { clientX: 9, clientY: 19 });
  expect(onSelectionChange).toHaveBeenCalledTimes(calls);
});

it('draws canonical directed edges and arrowheads before selectable entities', () => {
  profiler.configureRepresentationProfiling(true);
  const record = vi.spyOn(profiler, 'recordRepresentationProfile');
  render(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        fleet={[vehicleAt(pattern.stopNodeIds[0]!)]}
      />
    </RepresentationModeProvider>,
  );
  resize(
    [{ contentRect: { width: 200, height: 100 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(17);
  expect(context.moveTo).toHaveBeenCalled();
  expect(context.lineTo).toHaveBeenCalled();
  expect(context.closePath).toHaveBeenCalled();
  expect(context.lineTo.mock.invocationCallOrder[0]).toBeLessThan(
    context.arc.mock.invocationCallOrder[0]!,
  );
  expect(record).toHaveBeenCalledWith(
    'canvas2d.frame',
    expect.objectContaining({
      directedRouteEdges: expect.any(Number),
      routeArrowheads: expect.any(Number),
    }),
  );
});

it('keeps collocated directed edges as presentation geometry without arrowheads', () => {
  const stops = structuredClone(json('stops.json')) as {
    stopNodes: Array<{ position: { latitude: number; longitude: number } }>;
  };
  const position = stops.stopNodes[0]!.position;
  for (const node of stops.stopNodes) node.position = position;
  const collocated = parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops,
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
  render(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation {...props} scenario={collocated} />
    </RepresentationModeProvider>,
  );
  resize(
    [{ contentRect: { width: 200, height: 100 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(17);
  expect(context.moveTo).toHaveBeenCalled();
  expect(context.closePath).not.toHaveBeenCalled();
});

it('maps a resized CSS box back into the last-drawn snapshot until the next frame', () => {
  const onSelectionChange = vi.fn();
  render(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        onSelectionChange={onSelectionChange}
      />
    </RepresentationModeProvider>,
  );
  const canvas = screen.getByTestId('canvas2d-representation');
  const bounds = vi.spyOn(canvas, 'getBoundingClientRect');
  bounds.mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
  } as DOMRect);
  resize(
    [{ contentRect: { width: 200, height: 100 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(17);
  const stop = createCanvas2dSelectionSnapshot(
    createCanvas2dSelectionIndex(scenario),
    [],
    200,
    100,
  ).stopPoints[0]!;
  bounds.mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 200,
  } as DOMRect);
  fireEvent.click(canvas, { clientX: stop.x * 2, clientY: stop.y * 2 });
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectStop(stop.stopPlaceId),
  );

  resize(
    [{ contentRect: { width: 400, height: 200 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(17);
  const redrawn = createCanvas2dSelectionSnapshot(
    createCanvas2dSelectionIndex(scenario),
    [],
    400,
    200,
  ).stopPoints[0]!;
  fireEvent.click(canvas, { clientX: redrawn.x, clientY: redrawn.y });
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectStop(redrawn.stopPlaceId),
  );
});

it('uses the last drawn Vehicle position until the next accepted frame', () => {
  const onSelectionChange = vi.fn();
  const index = createCanvas2dSelectionIndex(scenario);
  const first = vehicleAt(pattern.stopNodeIds[0]!);
  const second = vehicleAt(pattern.stopNodeIds.at(-1)!);
  const view = render(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        fleet={[first]}
        onSelectionChange={onSelectionChange}
      />
    </RepresentationModeProvider>,
  );
  const canvas = screen.getByTestId('canvas2d-representation');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
  } as DOMRect);
  resize(
    [{ contentRect: { width: 200, height: 100 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(17);
  const oldPoint = createCanvas2dSelectionSnapshot(index, [first], 200, 100)
    .vehiclePoints[0]!;
  const newPoint = createCanvas2dSelectionSnapshot(index, [second], 200, 100)
    .vehiclePoints[0]!;
  view.rerender(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        fleet={[second]}
        onSelectionChange={onSelectionChange}
      />
    </RepresentationModeProvider>,
  );
  fireEvent.click(canvas, { clientX: oldPoint.x, clientY: oldPoint.y });
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectVehicle(first.vehicleId),
  );
  vi.advanceTimersByTime(17);
  onSelectionChange.mockClear();
  fireEvent.click(canvas, { clientX: oldPoint.x, clientY: oldPoint.y });
  expect(onSelectionChange).not.toHaveBeenCalledWith(
    selectVehicle(first.vehicleId),
  );
  fireEvent.click(canvas, { clientX: newPoint.x, clientY: newPoint.y });
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectVehicle(second.vehicleId),
  );
});

it('provides primary-only keyboard candidate navigation and canonical activation', () => {
  const onSelectionChange = vi.fn();
  const fleet = [vehicleAt(pattern.stopNodeIds[0]!)];
  const view = render(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        fleet={fleet}
        onSelectionChange={onSelectionChange}
      />
    </RepresentationModeProvider>,
  );
  const canvas = screen.getByTestId('canvas2d-representation');
  fireEvent.click(canvas, { clientX: 1, clientY: 1 });
  fireEvent.keyDown(canvas, { key: 'Enter' });
  expect(onSelectionChange).not.toHaveBeenCalled();
  resize(
    [{ contentRect: { width: 200, height: 100 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(17);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  });
  fireEvent.click(canvas, { clientX: 1, clientY: 1 });
  fireEvent.focus(canvas);
  expect(canvas).toHaveAttribute('tabindex', '0');
  expect(screen.getByText(/^StopPlace:/)).toBeInTheDocument();
  fireEvent.keyDown(canvas, { key: 'ArrowRight' });
  fireEvent.keyDown(canvas, { key: 'ArrowDown' });
  fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
  fireEvent.keyDown(canvas, { key: 'ArrowUp' });
  fireEvent.keyDown(canvas, { key: 'Unrelated' });
  expect(onSelectionChange).not.toHaveBeenCalled();
  fireEvent.keyDown(canvas, { key: 'Home' });
  fireEvent.keyDown(canvas, { key: 'Enter' });
  expect(onSelectionChange.mock.calls[0]?.[0]).toMatchObject({ kind: 'stop' });
  fireEvent.keyDown(canvas, { key: 'End' });
  expect(screen.getByText('Vehicle: Canvas vehicle')).toBeInTheDocument();
  fireEvent.keyDown(canvas, { key: ' ' });
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectVehicle(parseVehicleId('canvas-vehicle')),
  );
  view.rerender(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        fleet={fleet}
        selection={selectVehicle(parseVehicleId('canvas-vehicle'))}
        onSelectionChange={onSelectionChange}
      />
    </RepresentationModeProvider>,
  );
  fireEvent.focus(canvas);
  expect(screen.getByText('Vehicle: Canvas vehicle')).toBeInTheDocument();
  view.rerender(
    <RepresentationModeProvider mode="mini">
      <Canvas2dRepresentation
        {...props}
        fleet={fleet}
        onSelectionChange={onSelectionChange}
      />
    </RepresentationModeProvider>,
  );
  expect(canvas).not.toHaveAttribute('tabindex');
  expect(canvas).toHaveAttribute('role', 'img');
});

it('draws Canvas-native selected StopPlace and Vehicle feedback', () => {
  const index = createCanvas2dSelectionIndex(scenario);
  const stop = index.keyboardStops[0]!;
  const fleet = [vehicleAt(pattern.stopNodeIds[0]!)];
  const view = render(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        fleet={fleet}
        selection={selectStop(stop.stopPlaceId)}
      />
    </RepresentationModeProvider>,
  );
  resize(
    [{ contentRect: { width: 200, height: 100 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  vi.advanceTimersByTime(17);
  expect(context.stroke).toHaveBeenCalled();
  view.rerender(
    <RepresentationModeProvider mode="normal">
      <Canvas2dRepresentation
        {...props}
        fleet={fleet}
        selection={selectVehicle(fleet[0]!.vehicleId)}
      />
    </RepresentationModeProvider>,
  );
  vi.advanceTimersByTime(17);
  expect(context.strokeRect).toHaveBeenCalled();
});
