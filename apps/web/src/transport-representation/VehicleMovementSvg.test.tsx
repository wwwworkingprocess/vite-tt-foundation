import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationState,
  parseTickAdvancement,
  parseVehicleId,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { VehicleMovementSvg } from './VehicleMovementSvg.js';

afterEach(cleanup);
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

it('renders authoritative stop, edge, and changing vehicle projections accessibly', () => {
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
  const after = screen.getByTestId('vehicle-position');
  expect(`${after.getAttribute('cx')}:${after.getAttribute('cy')}`).not.toBe(
    initial,
  );
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
