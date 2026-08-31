import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import StopPlaceDetails from './StopPlaceDetails.js';
import type { StopPlaceDetailsModel } from './stop-place-details-model.js';

afterEach(cleanup);

it('renders every optional topology state semantically', () => {
  const model = {
    stopPlace: {
      stopPlaceId: 'selected',
      settlementId: 'town',
      name: 'Selected',
    },
    settlement: undefined,
    directionalNodes: [],
    services: [
      {
        routeId: 'route',
        publicCode: 'R',
        name: 'Route',
        dataStatus: 'reviewed',
        patterns: [
          {
            patternId: 'loop',
            directionLabel: 'Circular',
            closesLoop: true,
            stops: [
              {
                occurrenceIndex: 0,
                stopNodeId: 'platform',
                stopPlaceId: null,
                name: 'Platform',
                selected: false,
                services: [],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as StopPlaceDetailsModel;
  const view = render(<StopPlaceDetails model={model} />);
  expect(screen.getByText(/Settlement: town/)).toHaveTextContent(
    'No canonical position',
  );
  expect(screen.getByText(/Directional nodes:/)).toHaveTextContent('none');
  expect(
    screen.getByRole('heading', { name: 'Circular · Loop' }),
  ).toBeInTheDocument();
  expect(screen.getByText('No physical StopPlace')).toBeInTheDocument();
  expect(screen.queryByText('Selected StopPlace', { exact: false })).toBeNull();
  view.rerender(
    <StopPlaceDetails model={{ ...model, services: [] } as never} />,
  );
  expect(screen.getByText('No routes.')).toBeInTheDocument();
});
