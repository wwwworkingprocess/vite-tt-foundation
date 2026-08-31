import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import VehicleModalDetails from './VehicleModalDetails.js';

afterEach(cleanup);

const vehicle = {
  vehicleId: 'vehicle-1',
  label: 'Vehicle One',
  routeId: 'route-a',
  patternId: 'pattern-a',
  routeLegIndex: 1,
  completedRouteCycles: 3,
  movement: { kind: 'running-at-stop', stopNodeId: 'stop-a' },
} as never;

it('shows exact selected vehicle movement, operation, capacity, and passenger authority', () => {
  render(
    <VehicleModalDetails
      vehicleId={'vehicle-1' as never}
      fleet={[vehicle]}
      passengerDemand={
        {
          status: 'active',
          onboardGroups: [
            {
              vehicleId: 'vehicle-1',
              passengerOnboardGroupId: 'passenger-onboard-group-1',
              destinationStopPlaceId: 'destination-a',
              count: 2,
            },
          ],
        } as never
      }
      vehicleOperations={[
        {
          vehicleId: 'vehicle-1',
          patternRunSequence: 2,
          stopCallSequence: 7,
        } as never,
      ]}
      vehiclePassengerLoads={[
        {
          vehicleId: 'vehicle-1',
          passengerCapacity: 80,
          onboardPassengerCount: 2,
          remainingPassengerCapacity: 78,
        } as never,
      ]}
      currentBoardingEvents={[
        { vehicleId: 'vehicle-1', boardedPassengerCount: 2 } as never,
      ]}
      currentAlightingEvents={[
        { vehicleId: 'vehicle-1', alightedPassengerCount: 1 } as never,
      ]}
      currentJourneyCompletionEvents={[{ vehicleId: 'vehicle-1' } as never]}
    />,
  );
  const details = screen.getByTestId('vehicle-modal-details');
  expect(details).toHaveTextContent('Pattern run 2');
  expect(details).toHaveTextContent('Stop call 7');
  expect(details).toHaveTextContent('Capacity 80');
  expect(details).toHaveTextContent('Occupancy 2');
  expect(details).toHaveTextContent('Journey completion occurred this tick.');
});

it('fails safely when the selected vehicle is no longer available', () => {
  render(<VehicleModalDetails vehicleId={'missing' as never} fleet={[]} />);
  expect(screen.getByText(/no longer available/)).toBeInTheDocument();
});

it('shows explicit empty authority for a standalone vehicle on an edge', () => {
  render(
    <VehicleModalDetails
      vehicleId={'vehicle-1' as never}
      fleet={[
        {
          vehicleId: 'vehicle-1',
          label: 'Vehicle One',
          routeId: undefined,
          patternId: 'pattern-a',
          movement: { kind: 'running-on-edge', edgeId: 'edge-a' },
        } as never,
      ]}
    />,
  );
  const details = screen.getByTestId('vehicle-modal-details');
  expect(details).toHaveTextContent('Route standalone');
  expect(details).toHaveTextContent('Location edge-a');
  expect(details).toHaveTextContent('Pattern run unavailable');
  expect(details).toHaveTextContent('Onboard groups: none');
  expect(details).not.toHaveTextContent('Journey completion occurred');
});
