import { expect, it } from 'vitest';
import {
  passengerWaitingTotals,
  updatePassengerArrivalTicks,
} from './passenger-map-diagnostics.js';

it('derives safe physical-StopPlace totals from active waiting authority', () => {
  expect(passengerWaitingTotals(undefined)).toEqual(new Map());
  expect(
    passengerWaitingTotals({
      status: 'active',
      waitingCohorts: [
        { originStopPlaceId: 'place-a', count: 2 },
        { originStopPlaceId: 'place-a', count: 3 },
      ],
    } as never),
  ).toEqual(new Map([['place-a', 5]]));
  expect(() =>
    passengerWaitingTotals({
      status: 'active',
      waitingCohorts: [
        { originStopPlaceId: 'place-a', count: Number.MAX_SAFE_INTEGER },
        { originStopPlaceId: 'place-a', count: 1 },
      ],
    } as never),
  ).toThrow(/safe range/i);
});

it('retains only current arrival pulses and the latest event per StopPlace', () => {
  expect(
    updatePassengerArrivalTicks(
      new Map([
        ['current', 8],
        ['expired', 5],
      ]),
      [
        { tick: 7, stopPlaceId: 'current', arrivedPassengerCount: 1 },
        { tick: 9, stopPlaceId: 'current', arrivedPassengerCount: 1 },
        { tick: 5, stopPlaceId: 'ignored', arrivedPassengerCount: 1 },
      ] as never,
      10,
    ),
  ).toEqual(new Map([['current', 9]]));
});
