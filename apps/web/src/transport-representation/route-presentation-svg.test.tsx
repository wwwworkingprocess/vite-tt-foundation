import { fireEvent, render } from '@testing-library/react';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';

import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { expect, it, vi } from 'vitest';
import {
  parseVehicleId,
  type VehicleState,
} from '@torrevieja-tycoon/simulation';
import { VehicleMovementSvg } from './VehicleMovementSvg.js';
import { createTransportMapProjection } from '../representation/transport-map-projection.js';
import { parseRoutePresentation } from '../representation/route-presentation.js';
import { createRoutePresentationView } from '../representation/route-presentation-view.js';
import {
  selectRoute,
  selectVehicle,
  selectStop,
} from '../ui/game-selection.js';
import { RepresentationModeProvider } from '../representation/RepresentationModeContext.js';

const root = join(
  import.meta.dirname,
  '../../public/scenarios/torrevieja-v1/torrevieja-legacy-all-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
});
const asset = parseRoutePresentation(
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '../../public/route-presentation/torrevieja/torrevieja-route-presentation.v0.json',
      ),
      'utf8',
    ),
  ) as unknown,
  scenario,
);
const view = createRoutePresentationView(
  createTransportMapProjection(scenario),
  asset,
);
const fleet: VehicleState[] = [
  {
    vehicleId: parseVehicleId('enriched-svg-bus'),
    label: 'Bus',
    patternId: scenario.routes.routes[0]!.patterns[0]!.patternId,
    movementPlan: { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: [10] },
    movement: {
      kind: 'parked-at-stop',
      stopNodeId: scenario.routes.routes[0]!.patterns[0]!.stopNodeIds[0]!,
      nextEdgeSequence: 0,
    },
  },
];

it('renders source polylines and alpha, keeps route color when selected, and preserves semantic stop/vehicle selection', () => {
  const onSelectionChange = vi.fn();
  const props = {
    scenario,
    fleet,
    routePresentation: view,
    onSelectionChange,
    passengersVisible: false,
  };
  const rendered = render(<VehicleMovementSvg {...props} />);
  const routeId = scenario.routes.routes[0]!.routeId;
  let curve = rendered.container.querySelector(
    `[data-edge-id="${view.map.edges[0]!.edgeId}"]`,
  )!;
  expect(curve.tagName.toLowerCase()).toBe('polyline');
  expect(curve).toHaveAttribute('stroke', '#D32F2F');
  expect(curve.parentElement).toHaveAttribute('opacity', '0.8');
  expect(curve.getAttribute('points')!.split(' ')).toHaveLength(
    view.map.edges[0]!.points!.length,
  );
  rendered.rerender(
    <VehicleMovementSvg
      {...props}
      selection={selectRoute(routeId)}
      focusedRouteId={routeId}
    />,
  );
  curve = rendered.container.querySelector(
    `[data-edge-id="${view.map.edges[0]!.edgeId}"]`,
  )!;
  expect(curve.parentElement).toHaveAttribute('opacity', '1');
  expect(curve).toHaveAttribute('stroke', '#D32F2F');
  const stop = rendered.container.querySelector('[data-stop-place-id]')!;
  expect(Number(stop.getAttribute('stroke-width'))).toBeGreaterThan(
    Number(stop.getAttribute('r')),
  );
  fireEvent.click(stop);
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectStop(view.map.nodes[0]!.stopPlaceId!),
  );
  fireEvent.keyDown(rendered.getByTestId('vehicle-position'), { key: 'Enter' });
  expect(onSelectionChange).toHaveBeenLastCalledWith(
    selectVehicle(fleet[0]!.vehicleId),
  );
});

it('uses the same complete route geometry in the mini representation', () => {
  const rendered = render(
    <RepresentationModeProvider mode="mini">
      <VehicleMovementSvg
        scenario={scenario}
        fleet={fleet}
        routePresentation={view}
        selection={selectRoute(scenario.routes.routes[0]!.routeId)}
      />
    </RepresentationModeProvider>,
  );
  expect(rendered.container.querySelectorAll('polyline')).toHaveLength(244);
});
