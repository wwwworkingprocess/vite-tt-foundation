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
});
