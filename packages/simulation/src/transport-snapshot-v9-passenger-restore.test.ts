import { describe, expect, it } from 'vitest';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  restoreTransportSimulationState,
} from './index.js';
import {
  scenario,
  demandPlan,
  dispersedDemandPlan,
  boardingPlan,
  routeCycleVehicle,
  boardedState,
} from './transport-snapshot-v9.fixture.test.js';

describe('Transport Snapshot V9 — passenger restore', () => {
  it('rederives destination permutations and indexes across exact continuation restore', () => {
    const canonical = scenario();
    const plan = dispersedDemandPlan();
    const atA = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      7,
    );
    if (atA.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    expect(
      atA.passengerDemand.destinationCursors.some(
        ({ destinationCursor }) => destinationCursor > 0,
      ),
    ).toBe(true);
    const snapshotAtA = createTransportSimulationSnapshot(atA);
    const uninterrupted = advanceTransportTicks(atA, 11);
    const restored = restoreTransportSimulationState(
      snapshotAtA,
      canonical,
      plan,
    );
    const continued = advanceTransportTicks(restored, 11);
    expect(createTransportSimulationSnapshot(continued)).toEqual(
      createTransportSimulationSnapshot(uninterrupted),
    );
  });

  it('round-trips canonical onboard authority rather than numeric issuance order', () => {
    const canonical = scenario();
    const plan = boardingPlan();
    let state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    state = applyTransportVehicleCommand(state, routeCycleVehicle('z-bus'));
    state = applyTransportVehicleCommand(state, routeCycleVehicle('a-bus'));
    state = advanceTransportTicks(state, 1);
    if (state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    expect(
      state.passengerDemand.onboardGroups.map((group) => [
        group.vehicleId,
        group.passengerOnboardGroupId,
      ]),
    ).toEqual([
      ['a-bus', 'passenger-onboard-group-2'],
      ['z-bus', 'passenger-onboard-group-1'],
    ]);
    expect(state.currentBoardingEvents).toEqual([]);
    const snapshot = createTransportSimulationSnapshot(state);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, canonical, plan),
      ),
    ).toEqual(snapshot);
  });

  it('rejects passenger events while passenger authority is disabled', () => {
    const canonical = scenario();
    const disabled = createTransportSimulationSnapshot(
      createTransportSimulationState(canonical, 0),
    );
    const { plan, state } = boardedState();
    let alighted = state;
    while (alighted.currentAlightingEvents.length === 0)
      alighted = advanceTransportTicks(alighted, 1);
    const passengerSnapshot = createTransportSimulationSnapshot(alighted);
    const corruptions = [
      (value: typeof disabled) => {
        value.state.currentBoardingEvents = structuredClone(
          createTransportSimulationSnapshot(
            applyTransportVehicleCommand(
              advanceTransportTicks(
                createTransportSimulationState(canonical, 0, plan),
                2,
              ),
              routeCycleVehicle('event-bus'),
            ),
          ).state.currentBoardingEvents,
        );
      },
      (value: typeof disabled) => {
        value.state.currentAlightingEvents = structuredClone(
          passengerSnapshot.state.currentAlightingEvents,
        );
      },
      (value: typeof disabled) => {
        value.state.currentJourneyCompletionEvents = structuredClone(
          passengerSnapshot.state.currentJourneyCompletionEvents,
        );
      },
    ];
    for (const mutate of corruptions) {
      const corrupted = structuredClone(disabled);
      mutate(corrupted);
      expect(() =>
        restoreTransportSimulationState(corrupted, canonical),
      ).toThrow(/disabled passenger authority/i);
    }
  });

  it('round-trips active waiting authority without embedding static plans', () => {
    const canonical = scenario();
    const plan = demandPlan();
    const state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    const snapshot = createTransportSimulationSnapshot(state);
    expect(snapshot).toMatchObject({
      schemaVersion: 9,
      simulationVersion: 'transport-9',
      state: {
        passengerDemand: {
          status: 'active',
          processedThroughTick: 2,
          totalWaitingForVehiclePassengerCount: expect.any(Number),
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('itineraryEntries');
    expect(JSON.stringify(snapshot)).not.toContain('populationWeights');
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, canonical, plan),
      ),
    ).toEqual(snapshot);
  });
});
