import { describe, expect, it } from 'vitest';
import {
  advanceTransportTicks,
  advanceTransportTicksWithEvents,
  applyTransportVehicleCommand,
  createTransportSimulationState,
  parseSimulationTick,
  type PassengerOriginStopArrivalEvent,
} from './index.js';
import {
  scenario,
  demandPlan,
  boardingPlan,
  routeCycleVehicle,
  destinationAccessStates,
} from './transport-snapshot-v9.fixture.test.js';

describe('Transport Snapshot V9 — passenger transitions', () => {
  it('collects the complete immutable passenger-arrival interval without changing state semantics', () => {
    const canonical = scenario();
    const plan = demandPlan();
    const initial = createTransportSimulationState(canonical, 0, plan);
    const batch = advanceTransportTicksWithEvents(initial, 3);
    let splitState = initial;
    const splitEvents: PassengerOriginStopArrivalEvent[] = [];
    for (let index = 0; index < 3; index += 1) {
      const step = advanceTransportTicksWithEvents(splitState, 1);
      splitState = step.state;
      splitEvents.push(...step.passengerOriginStopArrivalEvents);
    }
    expect(batch.state).toEqual(advanceTransportTicks(initial, 3));
    expect(batch.state).toEqual(splitState);
    expect(batch.passengerOriginStopArrivalEvents).toEqual(splitEvents);
    expect(Object.isFrozen(batch.passengerOriginStopArrivalEvents)).toBe(true);
  });

  it('reports a physical-stop arrival even when equal same-tick boarding hides the queue delta', () => {
    const canonical = scenario();
    const plan = boardingPlan();
    const originStopPlaceId = 'tv-place-0108';
    let state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    state = applyTransportVehicleCommand(
      state,
      routeCycleVehicle('arrival-ambiguity-bus', 1),
    );
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'arrival-ambiguity-bus',
    });
    const waitingAtOrigin = (candidate: typeof state) => {
      if (candidate.passengerDemand.status !== 'active')
        throw new Error('Expected active passenger authority.');
      return candidate.passengerDemand.waitingCohorts
        .filter((cohort) => cohort.originStopPlaceId === originStopPlaceId)
        .reduce((total, cohort) => total + cohort.count, 0);
    };
    let evidence:
      | Readonly<{
          tick: number;
          waitingBefore: number;
          waitingAfter: number;
          arrivedPassengerCount: number;
          boardedPassengerCount: number;
        }>
      | undefined;
    for (
      let attempt = 0;
      attempt < 20 && evidence === undefined;
      attempt += 1
    ) {
      const waitingBefore = waitingAtOrigin(state);
      const advancement = advanceTransportTicksWithEvents(state, 1);
      const arrival = advancement.passengerOriginStopArrivalEvents.find(
        (event) => event.stopPlaceId === originStopPlaceId,
      );
      const boardedPassengerCount = advancement.state.currentBoardingEvents
        .filter((event) =>
          canonical.stops.stopNodes.some(
            (node) =>
              node.stopNodeId === event.stopNodeId &&
              node.stopPlaceId === originStopPlaceId,
          ),
        )
        .reduce((total, event) => total + event.boardedPassengerCount, 0);
      const waitingAfter = waitingAtOrigin(advancement.state);
      if (
        arrival &&
        boardedPassengerCount === arrival.arrivedPassengerCount &&
        waitingAfter === waitingBefore
      )
        evidence = {
          tick: advancement.state.tick,
          waitingBefore,
          waitingAfter,
          arrivedPassengerCount: arrival.arrivedPassengerCount,
          boardedPassengerCount,
        };
      state = advancement.state;
    }
    expect(evidence).toEqual({
      tick: 9,
      waitingBefore: 7,
      waitingAfter: 7,
      arrivedPassengerCount: 1,
      boardedPassengerCount: 1,
    });
  });

  it('preserves only current-tick alighting events across vehicle creation', () => {
    const { alighted } = destinationAccessStates();
    const current = alighted.currentAlightingEvents;
    const withStaleEvent = {
      ...alighted,
      currentAlightingEvents: [
        ...current,
        {
          ...current[0]!,
          tick: parseSimulationTick(alighted.tick - 1),
        },
      ],
    };
    const next = applyTransportVehicleCommand(withStaleEvent, {
      kind: 'transport.vehicle.create',
      vehicleId: 'event-preservation-bus',
      label: 'Event preservation bus',
      patternId: 'legacy-A2-torrevieja-la-mata',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1, 1, 1],
      },
    });

    expect(next.currentAlightingEvents).toEqual(current);
  });
});
