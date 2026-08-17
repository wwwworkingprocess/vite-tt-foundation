import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationState,
  parseTickAdvancement,
  parseVehicleId,
  type PassengerDemandProjection,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { VehicleMovementSvg } from './VehicleMovementSvg.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const root = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
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
const selectionRoot = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-legacy-abc-v1',
);
const selectionJson = (name: string) =>
  JSON.parse(readFileSync(join(selectionRoot, name), 'utf8')) as unknown;
const selectionScenario = parseScenarioPackage({
  manifest: selectionJson('scenario.json'),
  settlements: selectionJson('settlements.json'),
  stops: selectionJson('stops.json'),
  routes: selectionJson('routes.json'),
  presentation: selectionJson('presentation.json'),
  provenance: selectionJson('provenance.json'),
});

it('renders authoritative stop, edge, and changing vehicle projections accessibly', async () => {
  const pattern = scenario.routes.routes[0]!.patterns[0]!;
  let state = createTransportSimulationState(scenario, 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: parseVehicleId('svg-vehicle'),
    label: 'SVG vehicle',
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: Array.from({ length: 4 }, () => 10),
    },
  });
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: parseVehicleId('svg-vehicle'),
  });
  const view = render(
    <VehicleMovementSvg scenario={scenario} fleet={state.fleet} />,
  );
  const before = screen.getByTestId('vehicle-position');
  const initial = `${before.getAttribute('cx')}:${before.getAttribute('cy')}`;
  state = advanceTransportTicks(state, parseTickAdvancement(5));
  view.rerender(<VehicleMovementSvg scenario={scenario} fleet={state.fleet} />);
  await vi.waitFor(() => {
    const current = screen.getByTestId('vehicle-position');
    expect(
      `${current.getAttribute('cx')}:${current.getAttribute('cy')}`,
    ).not.toBe(initial);
  });
  const after = screen.getByTestId('vehicle-position');
  expect(after).toHaveAttribute('data-movement-kind', 'running-on-edge');
  expect(after).toHaveAttribute('data-progress-numerator', '5');
  expect(screen.getByTestId('vehicle-movement-svg')).toHaveAccessibleName(
    'Authoritative vehicle movement',
  );
  expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
    'role',
    'group',
  );
  expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
    'data-scenario-id',
    scenario.manifest.scenarioId,
  );
  expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
    'data-content-hash',
    scenario.manifest.contentHash,
  );
  expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
    'data-node-count',
    String(scenario.stops.stopNodes.length),
  );
  expect(screen.getByTestId('vehicle-movement-svg')).toHaveAttribute(
    'data-directed-edge-count',
    String(state.graph.summary.edges),
  );
});

it('publishes live fleet and passenger authority after StrictMode effect replay', () => {
  vi.useFakeTimers();
  const initial = createTransportSimulationState(selectionScenario, 0);
  const pattern = selectionScenario.routes.routes[0]!.patterns[0]!;
  const active = applyTransportVehicleCommand(initial, {
    kind: 'transport.vehicle.create',
    vehicleId: parseVehicleId('strict-svg-bus'),
    label: 'Strict SVG bus',
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: Array.from(
        { length: pattern.stopNodeIds.length - 1 },
        () => 10,
      ),
    },
  });
  const place = selectionScenario.stops.stopNodes.find(
    ({ stopPlaceId }) => stopPlaceId !== null,
  )!.stopPlaceId!;
  const demand = {
    status: 'active',
    waitingCohorts: [{ originStopPlaceId: place, count: 9 }],
  } as unknown as PassengerDemandProjection;
  const view = render(
    <StrictMode>
      <VehicleMovementSvg scenario={selectionScenario} fleet={initial.fleet} />
    </StrictMode>,
  );
  expect(screen.queryByTestId('vehicle-position')).toBeNull();
  expect(screen.queryByTestId('stop-waiting-passenger-count')).toBeNull();
  expect(screen.getAllByTestId('edge-direction').length).toBeGreaterThan(0);

  view.rerender(
    <StrictMode>
      <VehicleMovementSvg
        scenario={selectionScenario}
        fleet={active.fleet}
        passengerDemand={demand}
        vehiclePassengerLoads={[
          {
            vehicleId: parseVehicleId('strict-svg-bus'),
            passengerCapacity: 80,
            onboardPassengerCount: 4,
            remainingPassengerCapacity: 76,
            currentAlightedPassengerCount: 0,
            currentBoardedPassengerCount: 0,
          },
        ]}
      />
    </StrictMode>,
  );
  act(() => vi.advanceTimersByTime(1000 / 60));

  expect(screen.getByTestId('vehicle-position')).toHaveAttribute(
    'data-vehicle-id',
    'strict-svg-bus',
  );
  expect(screen.getByTestId('stop-waiting-passenger-count')).toHaveAttribute(
    'data-waiting-passenger-count',
    '9',
  );
  expect(screen.getByTestId('vehicle-onboard-passenger-count')).toHaveAttribute(
    'data-onboard-passenger-count',
    '4',
  );
  expect(screen.getAllByTestId('edge-direction').length).toBeGreaterThan(0);
});

it('renders arrowheads to show edge orientation', () => {
  render(<VehicleMovementSvg scenario={scenario} fleet={[]} />);
  const svg = screen.getByTestId('vehicle-movement-svg');

  const renderedEdges = [
    ...svg.querySelectorAll<SVGLineElement>('line[data-edge-id]'),
  ];
  const renderedArrows = [
    ...svg.querySelectorAll<SVGPolygonElement>(
      'polygon[data-testid="edge-direction"]',
    ),
  ];

  expect(renderedArrows).toHaveLength(renderedEdges.length);

  const firstEdge = renderedEdges[0]!;
  const firstArrow = renderedArrows[0]!;

  expect(firstArrow).toHaveAttribute(
    'data-direction-edge-id',
    firstEdge.getAttribute('data-edge-id'),
  );

  const points = firstArrow
    .getAttribute('points')!
    .split(' ')
    .map((point) => point.split(',').map(Number));

  const [tip, left, right] = points as [
    [number, number],
    [number, number],
    [number, number],
  ];

  const baseX = (left[0] + right[0]) / 2;
  const baseY = (left[1] + right[1]) / 2;

  const edgeDx =
    Number(firstEdge.getAttribute('x2')) - Number(firstEdge.getAttribute('x1'));
  const edgeDy =
    Number(firstEdge.getAttribute('y2')) - Number(firstEdge.getAttribute('y1'));

  const arrowDx = tip[0] - baseX;
  const arrowDy = tip[1] - baseY;

  // Positive dot product proves that the triangle points from x1/y1 to x2/y2.
  expect(arrowDx * edgeDx + arrowDy * edgeDy).toBeGreaterThan(0);

  // The arrow is centred halfway between the two canonical stops.
  expect((tip[0] + baseX) / 2).toBeCloseTo(
    (Number(firstEdge.getAttribute('x1')) +
      Number(firstEdge.getAttribute('x2'))) /
      2,
  );
  expect((tip[1] + baseY) / 2).toBeCloseTo(
    (Number(firstEdge.getAttribute('y1')) +
      Number(firstEdge.getAttribute('y2'))) /
      2,
  );
});

it('omits direction arrows for collocated canonical stops', () => {
  const stops = structuredClone(json('stops.json')) as {
    stopNodes: Array<{
      position: { latitude: number; longitude: number };
    }>;
  };
  const firstPosition = stops.stopNodes[0]!.position;
  for (const stop of stops.stopNodes) {
    stop.position = { ...firstPosition };
  }
  const collocatedScenario = parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops,
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });

  render(<VehicleMovementSvg scenario={collocatedScenario} fleet={[]} />);
  const svg = screen.getByTestId('vehicle-movement-svg');
  const renderedEdges = [
    ...svg.querySelectorAll<SVGLineElement>('line[data-edge-id]'),
  ];

  expect(renderedEdges.length).toBeGreaterThan(0);
  for (const edge of renderedEdges) {
    expect(edge.getAttribute('x1')).toBe(edge.getAttribute('x2'));
    expect(edge.getAttribute('y1')).toBe(edge.getAttribute('y2'));
    expect(
      edge.parentElement?.querySelector('[data-testid="edge-direction"]'),
    ).toBeNull();
  }
  expect(screen.queryByTestId('edge-direction')).not.toBeInTheDocument();
});

it('adapts pointer and keyboard input into renderer-independent selections', () => {
  const onSelectionChange = vi.fn();
  const state = createTransportSimulationState(selectionScenario, 0);
  const view = render(
    <VehicleMovementSvg
      scenario={selectionScenario}
      fleet={state.fleet}
      onSelectionChange={onSelectionChange}
    />,
  );
  const edge = view.container.querySelector<SVGLineElement>('[data-edge-id]')!;
  const stop = view.container.querySelector<SVGCircleElement>(
    '[data-stop-place-id]',
  )!;
  fireEvent.click(edge);
  fireEvent.keyDown(edge, { key: 'Enter' });
  fireEvent.keyDown(edge, { key: ' ' });
  fireEvent.keyDown(edge, { key: 'Escape' });
  fireEvent.click(stop);
  fireEvent.keyDown(stop, { key: 'Enter' });
  expect(
    onSelectionChange.mock.calls.map(([selection]) => selection.kind),
  ).toEqual(['route', 'route', 'route', 'stop', 'stop']);

  const pattern = selectionScenario.routes.routes[0]!.patterns[0]!;
  const withVehicle = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: parseVehicleId('selectable-vehicle'),
    label: 'Selectable vehicle',
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: Array.from(
        { length: pattern.stopNodeIds.length - 1 },
        () => 10,
      ),
    },
  });
  view.rerender(
    <VehicleMovementSvg
      scenario={selectionScenario}
      fleet={withVehicle.fleet}
      selection={{
        kind: 'route',
        routeId: selectionScenario.routes.routes[0]!.routeId,
      }}
      onSelectionChange={onSelectionChange}
    />,
  );
  expect(edge).toHaveAttribute('data-selected', 'true');
  view.rerender(
    <VehicleMovementSvg
      scenario={selectionScenario}
      fleet={withVehicle.fleet}
      selection={{ kind: 'stop', stopPlaceId: stopPlaceId(stop) as never }}
      onSelectionChange={onSelectionChange}
    />,
  );
  expect(
    view.container.querySelector(`[data-stop-place-id="${stopPlaceId(stop)}"]`),
  ).toHaveAttribute('data-selected', 'true');
  const vehicle = screen.getByTestId('vehicle-position');
  fireEvent.click(vehicle);
  fireEvent.keyDown(vehicle, { key: 'Enter' });
  fireEvent.keyDown(vehicle, { key: ' ' });
  fireEvent.keyDown(vehicle, { key: 'Escape' });
  expect(onSelectionChange).toHaveBeenLastCalledWith({
    kind: 'vehicle',
    vehicleId: 'selectable-vehicle',
  });
  view.rerender(
    <VehicleMovementSvg
      scenario={selectionScenario}
      fleet={withVehicle.fleet}
      selection={{
        kind: 'vehicle',
        vehicleId: parseVehicleId('selectable-vehicle'),
      }}
    />,
  );
  expect(screen.getByTestId('vehicle-position')).toHaveAttribute(
    'data-selected',
    'true',
  );
  fireEvent.click(screen.getByTestId('vehicle-position'));
  fireEvent.keyDown(screen.getByTestId('vehicle-position'), { key: 'Enter' });
});

const stopPlaceId = (element: Element) =>
  element.getAttribute('data-stop-place-id')!;

it('renders bounded physical-stop and vehicle passenger diagnostics with tick pulses', () => {
  vi.useFakeTimers();
  const normalRepresentationFrameMs = 1000 / 60;
  const pattern = selectionScenario.routes.routes[0]!.patterns[0]!;
  let state = createTransportSimulationState(selectionScenario, 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: parseVehicleId('passenger-bus'),
    label: 'Passenger bus',
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: Array.from(
        { length: pattern.stopNodeIds.length - 1 },
        () => 10,
      ),
    },
  });
  const place = selectionScenario.stops.stopNodes.find(
    ({ stopPlaceId }) => stopPlaceId !== null,
  )!.stopPlaceId!;
  const demand = {
    status: 'active',
    waitingCohorts: [
      { originStopPlaceId: place, destinationStopPlaceId: place, count: 2 },
      { originStopPlaceId: place, destinationStopPlaceId: place, count: 3 },
    ],
  } as unknown as PassengerDemandProjection;
  const view = render(
    <VehicleMovementSvg
      scenario={selectionScenario}
      fleet={state.fleet}
      passengerDemand={demand}
      vehiclePassengerLoads={[
        {
          vehicleId: parseVehicleId('passenger-bus'),
          passengerCapacity: 80,
          onboardPassengerCount: 14,
          remainingPassengerCapacity: 66,
          currentAlightedPassengerCount: 0,
          currentBoardedPassengerCount: 0,
        },
      ]}
      passengerOriginStopArrivalEvents={[
        { tick: 10 as never, stopPlaceId: place, arrivedPassengerCount: 5 },
      ]}
      simulationTick={10}
      showPassengerArrivalPulse
    />,
  );
  expect(screen.getByRole('button', { name: 'Hide passengers' })).toBeVisible();
  expect(screen.getByTestId('stop-waiting-passenger-count')).toHaveTextContent(
    '5',
  );
  expect(screen.getAllByTestId('stop-waiting-passenger-count')).toHaveLength(1);
  expect(
    screen
      .getAllByTestId('passenger-stop-status')
      .filter((element) => element.getAttribute('data-stop-place-id') === place)
      .every(
        (element) =>
          element.getAttribute('fill') === 'black' &&
          element.getAttribute('data-has-waiting-passengers') === 'true',
      ),
  ).toBe(true);
  expect(
    screen.getByTestId('vehicle-onboard-passenger-count'),
  ).toHaveTextContent('14');
  const vehicleMarker = screen.getByTestId('vehicle-position');
  const onboardCount = screen.getByTestId('vehicle-onboard-passenger-count');
  expect(vehicleMarker).toHaveAttribute('fill', '#2c7fb8');
  expect(onboardCount).toHaveAttribute('x', vehicleMarker.getAttribute('cx'));
  expect(onboardCount).toHaveAttribute('y', vehicleMarker.getAttribute('cy'));
  expect(onboardCount).toHaveAttribute('text-anchor', 'middle');
  expect(onboardCount).toHaveAttribute('pointer-events', 'none');
  expect(screen.getByTestId('passenger-arrival-pulse')).toBeVisible();
  view.rerender(
    <VehicleMovementSvg
      scenario={selectionScenario}
      fleet={state.fleet}
      passengerDemand={demand}
      vehiclePassengerLoads={[]}
      passengerOriginStopArrivalEvents={[
        { tick: 9 as never, stopPlaceId: place, arrivedPassengerCount: 1 },
      ]}
      simulationTick={11}
      showPassengerArrivalPulse
    />,
  );
  act(() => vi.advanceTimersByTime(normalRepresentationFrameMs));
  expect(screen.getByTestId('passenger-arrival-pulse')).toHaveAttribute(
    'data-last-arrival-tick',
    '10',
  );
  view.rerender(
    <VehicleMovementSvg
      scenario={selectionScenario}
      fleet={state.fleet}
      passengerDemand={demand}
      vehiclePassengerLoads={[]}
      passengerOriginStopArrivalEvents={[
        { tick: 12 as never, stopPlaceId: place, arrivedPassengerCount: 1 },
      ]}
      simulationTick={12}
      showPassengerArrivalPulse
    />,
  );
  act(() => vi.advanceTimersByTime(normalRepresentationFrameMs));
  expect(screen.getByTestId('passenger-arrival-pulse')).toHaveAttribute(
    'data-last-arrival-tick',
    '12',
  );
  view.rerender(
    <VehicleMovementSvg
      scenario={selectionScenario}
      fleet={state.fleet}
      passengerDemand={demand}
      vehiclePassengerLoads={[]}
      passengerOriginStopArrivalEvents={[
        { tick: 12 as never, stopPlaceId: place, arrivedPassengerCount: 1 },
      ]}
      simulationTick={17}
      showPassengerArrivalPulse
    />,
  );
  act(() => vi.advanceTimersByTime(normalRepresentationFrameMs));
  expect(screen.queryByTestId('passenger-arrival-pulse')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hide passengers' }));
  expect(screen.queryByTestId('stop-waiting-passenger-count')).toBeNull();
  expect(screen.queryByTestId('vehicle-onboard-passenger-count')).toBeNull();
  expect(screen.getByRole('button', { name: 'Show passengers' })).toBeVisible();
  view.unmount();
  expect(() =>
    render(
      <VehicleMovementSvg
        scenario={selectionScenario}
        fleet={[]}
        passengerDemand={
          {
            status: 'active',
            waitingCohorts: [
              { originStopPlaceId: place, count: Number.MAX_SAFE_INTEGER },
              { originStopPlaceId: place, count: 1 },
            ],
          } as unknown as PassengerDemandProjection
        }
      />,
    ),
  ).toThrow(/safe range/i);
}, 15_000);

it('keeps arrival pulse authority dormant by default and renders it when enabled', () => {
  const place = selectionScenario.stops.stopNodes.find(
    ({ stopPlaceId }) => stopPlaceId !== null,
  )!.stopPlaceId!;
  const props = {
    scenario: selectionScenario,
    fleet: [],
    passengerOriginStopArrivalEvents: [
      { tick: 4 as never, stopPlaceId: place, arrivedPassengerCount: 2 },
    ],
    simulationTick: 4,
  };
  const view = render(<VehicleMovementSvg {...props} />);
  expect(screen.queryByTestId('passenger-arrival-pulse')).toBeNull();
  view.rerender(<VehicleMovementSvg {...props} showPassengerArrivalPulse />);
  return vi.waitFor(() =>
    expect(screen.getByTestId('passenger-arrival-pulse')).toHaveAttribute(
      'data-last-arrival-tick',
      '4',
    ),
  );
});
