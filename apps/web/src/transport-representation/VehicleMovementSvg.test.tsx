import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
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
