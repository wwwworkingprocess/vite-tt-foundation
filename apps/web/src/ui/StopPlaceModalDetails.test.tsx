import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import StopPlaceModalDetails from './StopPlaceModalDetails.js';
import * as detailsModel from './stop-place-details-model.js';

afterEach(cleanup);

const scenario = {
  settlements: {
    settlements: [{ settlementId: 'town', name: 'Town' }],
  },
  stops: {
    stopPlaces: [
      {
        stopPlaceId: 'hotel',
        settlementId: 'town',
        name: 'Hotel Fontana',
        position: { latitude: 1, longitude: 2 },
      },
      { stopPlaceId: 'beach', settlementId: 'town', name: 'Beach' },
    ],
    stopNodes: [
      { stopNodeId: 'hotel-a', stopPlaceId: 'hotel', name: 'Hotel A' },
      { stopNodeId: 'beach-a', stopPlaceId: 'beach', name: 'Beach A' },
    ],
  },
  routes: {
    routes: [
      {
        routeId: 'route-a',
        publicCode: 'A',
        name: 'Route A',
        dataStatus: 'reviewed',
        patterns: [
          {
            patternId: 'pattern-a',
            directionLabel: 'Outbound',
            closesLoop: false,
            stopNodeIds: ['hotel-a', 'beach-a'],
          },
        ],
      },
    ],
  },
} as never;

it('combines memoized static topology with exact live StopPlace authority', () => {
  render(
    <StopPlaceModalDetails
      scenario={scenario}
      stopPlaceId={'hotel' as never}
      passengerDemand={
        {
          status: 'active',
          waitingCohorts: [
            {
              originStopPlaceId: 'hotel',
              destinationStopPlaceId: 'beach',
              count: 3,
            },
          ],
          destinationAccessGroups: [
            { destinationStopPlaceId: 'hotel', count: 2 },
          ],
        } as never
      }
      currentBoardingEvents={[
        { stopNodeId: 'hotel-a', boardedPassengerCount: 1 } as never,
      ]}
      currentAlightingEvents={[
        { stopNodeId: 'hotel-a', alightedPassengerCount: 4 } as never,
      ]}
    />,
  );
  expect(
    screen.getByRole('heading', { name: 'Stop overview' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Live StopPlace state')).toHaveTextContent(
    'Waiting passengers3',
  );
  expect(screen.getByLabelText('Live StopPlace state')).toHaveTextContent(
    'Boarding this tick1',
  );
  expect(screen.getByText('Route A')).toBeInTheDocument();
  expect(screen.getByText('Technical stop information')).toBeInTheDocument();
});

it('handles unavailable and passenger-disabled authority truthfully', () => {
  const view = render(
    <StopPlaceModalDetails
      scenario={scenario}
      stopPlaceId={'missing' as never}
    />,
  );
  expect(screen.getByText(/no longer available/)).toBeInTheDocument();
  view.rerender(
    <StopPlaceModalDetails
      scenario={scenario}
      stopPlaceId={'hotel' as never}
      passengerDemand={{ status: 'disabled' }}
    />,
  );
  expect(screen.getByLabelText('Live StopPlace state')).toHaveTextContent(
    'Waiting passengers0',
  );
});

it('does not rederive static topology for live-only authority updates', () => {
  const derive = vi.spyOn(detailsModel, 'deriveStopPlaceDetailsModel');
  const view = render(
    <StopPlaceModalDetails
      scenario={scenario}
      stopPlaceId={'hotel' as never}
      passengerDemand={{ status: 'disabled' }}
    />,
  );
  const calls = derive.mock.calls.length;
  view.rerender(
    <StopPlaceModalDetails
      scenario={scenario}
      stopPlaceId={'hotel' as never}
      passengerDemand={
        {
          status: 'active',
          waitingCohorts: [],
          destinationAccessGroups: [],
        } as never
      }
    />,
  );
  expect(derive).toHaveBeenCalledTimes(calls);
  derive.mockRestore();
});
