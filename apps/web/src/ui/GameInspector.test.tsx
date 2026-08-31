import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  applyTransportVehicleCommand,
  advanceTransportTicks,
  createTransportSimulationState,
  parseTickAdvancement,
  parseVehicleId,
  type CurrentAlightingEvent,
  type CurrentBoardingEvent,
  type PassengerDemandProjection,
  type PassengerJourneyCompletionEvent,
  type VehiclePassengerLoadProjection,
  type VehiclePatternRunState,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import GameInspector from './GameInspector.js';

afterEach(cleanup);
const fixtureRoot = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-legacy-abc-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});
const route = scenario.routes.routes[0]!;
const pattern = route.patterns[0]!;
let state = createTransportSimulationState(scenario, 0);
state = applyTransportVehicleCommand(state, {
  kind: 'transport.vehicle.create',
  vehicleId: parseVehicleId('inspected-vehicle'),
  label: 'Inspected vehicle',
  patternId: pattern.patternId,
  movementPlan: {
    kind: 'vehicle-movement-plan-v1',
    edgeTravelTicks: Array.from(
      { length: pattern.stopNodeIds.length - 1 },
      () => 10,
    ),
  },
});
const vehicle = state.fleet[0]!;
const stopNode = scenario.stops.stopNodes.find(
  ({ stopNodeId }) => stopNodeId === pattern.stopNodeIds[0],
)!;
const stopPlace = scenario.stops.stopPlaces.find(
  ({ stopPlaceId }) => stopPlaceId === stopNode.stopPlaceId,
)!;
const otherVehicleId = parseVehicleId('other-vehicle');
const otherStopNodeId = scenario.stops.stopNodes.find(
  ({ stopNodeId }) => stopNodeId !== stopNode.stopNodeId,
)!.stopNodeId;
const waiting = {
  passengerWaitingCohortId: 'passenger-waiting-cohort-1',
  originStopPlaceId: stopPlace.stopPlaceId,
  originStopNodeId: stopNode.stopNodeId,
  routeId: route.routeId,
  patternId: pattern.patternId,
  originOccurrenceIndex: 0,
  destinationCellId: 'r0c0',
  destinationStopPlaceId: stopPlace.stopPlaceId,
  destinationStopNodeId: stopNode.stopNodeId,
  destinationOccurrenceIndex: 1,
  wrapsPatternEnd: false,
  edgeCount: 1,
  count: 3,
  firstAssignedTick: 1,
  lastAssignedTick: 1,
};
const onboard = {
  ...waiting,
  passengerOnboardGroupId: 'passenger-onboard-group-1',
  sourceWaitingCohortId: waiting.passengerWaitingCohortId,
  vehicleId: vehicle.vehicleId,
  boardedAtTick: 2,
  boardedAtPatternRunSequence: 1,
  alightAtPatternRunSequence: 1,
  boardedAtStopCallSequence: 1,
  count: 2,
};
const access = {
  ...onboard,
  passengerDestinationAccessGroupId: 'passenger-destination-access-group-1',
  sourceOnboardGroupId: onboard.passengerOnboardGroupId,
  alightedAtTick: 3,
  alightedAtPatternRunSequence: 1,
  alightedAtStopCallSequence: 2,
  destinationAccessTicks: 1,
  completionTick: 4,
  count: 4,
};
const demand = {
  status: 'active',
  totalWaitingForVehiclePassengerCount: 3,
  totalOnboardPassengerCount: 2,
  totalInDestinationAccessPassengerCount: 4,
  totalCompletedJourneyPassengerCount: 5,
  waitingCohorts: [waiting, { ...waiting, routeId: 'other-route', count: 7 }],
  onboardGroups: [
    onboard,
    {
      ...onboard,
      routeId: 'other-route',
      vehicleId: 'other-vehicle',
      count: 6,
    },
  ],
  destinationAccessGroups: [
    access,
    { ...access, destinationStopPlaceId: 'other-stop', count: 8 },
  ],
} as unknown as PassengerDemandProjection;
const operation = {
  vehicleId: vehicle.vehicleId,
  patternRunSequence: 2,
  stopCallSequence: 7,
} as VehiclePatternRunState;
const load = {
  vehicleId: vehicle.vehicleId,
  passengerCapacity: 80,
  onboardPassengerCount: 2,
  remainingPassengerCapacity: 78,
  currentAlightedPassengerCount: 1,
  currentBoardedPassengerCount: 2,
} as VehiclePassengerLoadProjection;
const boarding = {
  vehicleId: vehicle.vehicleId,
  stopNodeId: stopNode.stopNodeId,
  boardedPassengerCount: 2,
} as CurrentBoardingEvent;
const alighting = {
  vehicleId: vehicle.vehicleId,
  stopNodeId: stopNode.stopNodeId,
  alightedPassengerCount: 1,
} as CurrentAlightingEvent;
const completion = {
  ...access,
  completedAtTick: 4,
  minimumAssignmentToCompletionTicks: 3,
  maximumAssignmentToCompletionTicks: 3,
  inVehicleTicks: 1,
} as unknown as PassengerJourneyCompletionEvent;
const common = {
  scenario,
  fleet: state.fleet,
  passengerDemand: demand,
  vehicleOperations: [operation],
  vehiclePassengerLoads: [load],
  currentBoardingEvents: [
    boarding,
    { ...boarding, vehicleId: otherVehicleId, stopNodeId: otherStopNodeId },
  ],
  currentAlightingEvents: [
    alighting,
    { ...alighting, vehicleId: otherVehicleId, stopNodeId: otherStopNodeId },
  ],
  currentJourneyCompletionEvents: [completion],
  onClear: vi.fn(),
};

it('shows a neutral exact global authority summary', () => {
  const view = render(<GameInspector {...common} selection={null} />);
  expect(
    screen.getByText('Select a route, stop, or vehicle.'),
  ).toBeInTheDocument();
  expect(screen.getByTestId('passenger-summary')).toHaveTextContent('Waiting3');
  view.rerender(
    <GameInspector
      {...common}
      passengerDemand={{ status: 'disabled' }}
      selection={null}
    />,
  );
  expect(screen.getByTestId('passenger-summary')).toHaveTextContent('Waiting0');
});

it('shows exact route authority and attributable passenger totals', () => {
  const view = render(
    <GameInspector
      {...common}
      fleet={[
        { ...vehicle, routeId: route.routeId } as (typeof state.fleet)[number],
      ]}
      selection={{ kind: 'route', routeId: route.routeId }}
    />,
  );
  expect(screen.getByTestId('route-inspector')).toHaveTextContent(
    `Route ${route.publicCode}`,
  );
  expect(screen.getByTestId('route-inspector')).toHaveTextContent(
    'Waiting passengers: 3',
  );
  expect(screen.getByTestId('route-inspector')).toHaveTextContent(
    'Onboard passengers: 2',
  );
  const inspector = screen.getByTestId('route-inspector');
  expect(
    inspector.compareDocumentPosition(screen.getByTestId('passenger-summary')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  expect(
    screen
      .getByTestId('passenger-summary')
      .compareDocumentPosition(screen.getByText(route.routeId)) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);

  const withPlatformOnlyNode = structuredClone(scenario) as typeof scenario;
  const platformOnlyNode = withPlatformOnlyNode.stops.stopNodes.find(
    ({ stopNodeId }) => stopNodeId === route.patterns[0]!.stopNodeIds[0],
  )!;
  Object.assign(platformOnlyNode, { stopPlaceId: null });
  view.rerender(
    <GameInspector
      {...common}
      scenario={withPlatformOnlyNode}
      selection={{ kind: 'route', routeId: route.routeId }}
    />,
  );
  expect(screen.getByTestId('route-inspector')).toBeInTheDocument();
});

it('shows a compact physical StopPlace summary and opens rich details', () => {
  const onOpenSelectionDetails = vi.fn();
  render(
    <GameInspector
      {...common}
      selection={{ kind: 'stop', stopPlaceId: stopPlace.stopPlaceId }}
      onOpenSelectionDetails={onOpenSelectionDetails}
    />,
  );
  const inspector = screen.getByTestId('stop-inspector');
  expect(inspector).toHaveTextContent(`Stop ${stopPlace.name}`);
  expect(inspector).toHaveTextContent(route.publicCode);
  expect(inspector).toHaveTextContent('Waiting passengers: 10');
  expect(inspector).not.toHaveTextContent(pattern.directionLabel);
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
  expect(onOpenSelectionDetails).toHaveBeenCalledOnce();
});

it('omits the open-details action while the representation modal is open', () => {
  if (demand.status !== 'active') throw new Error('active fixture required');
  const view = render(
    <GameInspector
      {...common}
      selectionDetailsOpen
      selection={{ kind: 'stop', stopPlaceId: stopPlace.stopPlaceId }}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Open details' })).toBeNull();
  view.rerender(
    <GameInspector
      {...common}
      passengerDemand={{
        ...demand,
        totalWaitingForVehiclePassengerCount: 4,
      }}
      selection={{ kind: 'stop', stopPlaceId: stopPlace.stopPlaceId }}
    />,
  );
  expect(screen.getByTestId('passenger-summary')).toHaveTextContent('Waiting4');
});

it('keeps selected vehicle context compact and opens its modal details', () => {
  const onOpenSelectionDetails = vi.fn();
  render(
    <GameInspector
      {...common}
      selection={{ kind: 'vehicle', vehicleId: vehicle.vehicleId }}
      selectionDetailsOpen={false}
      onOpenSelectionDetails={onOpenSelectionDetails}
    />,
  );
  const inspector = screen.getByTestId('vehicle-inspector');
  expect(inspector).toHaveTextContent('Occupancy 2');
  expect(inspector).not.toHaveTextContent('Pattern run 2');
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
  expect(onOpenSelectionDetails).toHaveBeenCalledOnce();
});

it('renders stale selection safely and clears it on request', () => {
  const onClear = vi.fn();
  render(
    <GameInspector
      {...common}
      onClear={onClear}
      selection={{ kind: 'vehicle', vehicleId: parseVehicleId('missing') }}
    />,
  );
  expect(screen.getByTestId('unavailable-inspector')).toHaveTextContent(
    'no longer available',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(onClear).toHaveBeenCalledOnce();
});

it.each([
  { kind: 'route', routeId: 'missing-route' },
  { kind: 'stop', stopPlaceId: 'missing-stop' },
] as const)('handles a stale $kind identity without throwing', (selection) => {
  render(<GameInspector {...common} selection={selection as never} />);
  expect(screen.getByTestId('unavailable-inspector')).toBeInTheDocument();
});

it('uses explicit empty diagnostics when optional authority is unavailable', () => {
  const routeView = render(
    <GameInspector
      scenario={scenario}
      fleet={[]}
      passengerDemand={{ status: 'disabled' }}
      selection={{ kind: 'route', routeId: route.routeId }}
      onClear={vi.fn()}
    />,
  );
  expect(screen.getByTestId('route-inspector')).toHaveTextContent(
    'Active vehicles: none',
  );
  routeView.unmount();

  const withoutPosition = structuredClone(scenario) as unknown as {
    routes: { routes: unknown[] };
    stops: { stopPlaces: Array<{ stopPlaceId: string; position?: unknown }> };
  };
  withoutPosition.routes.routes = [];
  delete withoutPosition.stops.stopPlaces.find(
    ({ stopPlaceId }) => stopPlaceId === stopPlace.stopPlaceId,
  )!.position;
  render(
    <GameInspector
      scenario={withoutPosition as never}
      fleet={[]}
      selection={{ kind: 'stop', stopPlaceId: stopPlace.stopPlaceId }}
      onClear={vi.fn()}
    />,
  );
  const stopInspector = screen.getByTestId('stop-inspector');
  expect(stopInspector).toHaveTextContent(`Stop ${stopPlace.name}`);
});

it('shows standalone on-edge movement without optional operation or passenger projections', () => {
  let running = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: vehicle.vehicleId,
  });
  running = advanceTransportTicks(running, parseTickAdvancement(1));
  render(
    <GameInspector
      scenario={scenario}
      fleet={running.fleet}
      selection={{ kind: 'vehicle', vehicleId: vehicle.vehicleId }}
      onClear={vi.fn()}
    />,
  );
  const inspector = screen.getByTestId('vehicle-inspector');
  expect(inspector).toHaveTextContent('Route standalone');
  expect(inspector).toHaveTextContent('Movement running-on-edge');
  expect(inspector).not.toHaveTextContent('Pattern run unavailable');
  expect(inspector).not.toHaveTextContent('Onboard groups: none');
  expect(inspector).not.toHaveTextContent('Journey completion occurred');
});
