import { describe, expect, it } from 'vitest';
import {
  advanceTransportTicks,
  advanceTransportTicksWithEvents,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parseTransportSimulationRuntimeTuning,
  restoreTransportSimulationState,
  type PassengerEmissionBucket,
  type PassengerOriginStopArrivalEvent,
} from './index.js';
import {
  scenario,
  demandPlan,
  dispersedDemandPlan,
  boardingPlan,
  routeCycleVehicle,
} from './transport-snapshot-v9.fixture.test.js';

describe('Transport Snapshot V9 — work windows', () => {
  it('preserves exact authority and arrival evidence across all emission work windows', () => {
    const canonical = scenario();
    const plan = structuredClone(dispersedDemandPlan());
    const run = (passengerEmissionWorkWindowTicks: number) => {
      let state = createTransportSimulationState(canonical, 0, plan, {
        passengerEmissionWorkWindowTicks,
      });
      const snapshots = [];
      const events: PassengerOriginStopArrivalEvent[] = [];
      for (const checkpoint of [1, 2, 5, 7, 13, 25]) {
        const advanced = advanceTransportTicksWithEvents(
          state,
          checkpoint - state.tick,
        );
        state = advanced.state;
        events.push(...advanced.passengerOriginStopArrivalEvents);
        snapshots.push(createTransportSimulationSnapshot(state));
      }
      return { state, snapshots, events };
    };
    const reference = run(1);
    for (let window = 2; window <= 12; window += 1) {
      const actual = run(window);
      expect(actual.snapshots).toEqual(reference.snapshots);
      expect(actual.events).toEqual(reference.events);
      expect(
        Math.ceil(
          plan.cells.length /
            actual.state.passengerEmissionScheduler!.workWindowTicks,
        ),
      ).toBeLessThan(plan.cells.length);
    }
  });

  it('restores across the calibration window matrix without persisting runtime tuning', () => {
    const canonical = scenario();
    const plan = dispersedDemandPlan();
    const referenceAtSeven = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan, {
        passengerEmissionWorkWindowTicks: 1,
      }),
      7,
    );
    const reference = advanceTransportTicksWithEvents(referenceAtSeven, 18);
    for (const sourceWindow of [1, 4, 12]) {
      const atSeven = advanceTransportTicks(
        createTransportSimulationState(canonical, 0, plan, {
          passengerEmissionWorkWindowTicks: sourceWindow,
        }),
        7,
      );
      const snapshot = createTransportSimulationSnapshot(atSeven);
      expect(snapshot).not.toHaveProperty('runtimeTuning');
      expect(snapshot.state).not.toHaveProperty('passengerEmissionScheduler');
      for (const destinationWindow of [1, 5, 12]) {
        const actual = advanceTransportTicksWithEvents(
          restoreTransportSimulationState(snapshot, canonical, plan, {
            passengerEmissionWorkWindowTicks: destinationWindow,
          }),
          18,
        );
        expect(createTransportSimulationSnapshot(actual.state)).toEqual(
          createTransportSimulationSnapshot(reference.state),
        );
        expect(actual.passengerOriginStopArrivalEvents).toEqual(
          reference.passengerOriginStopArrivalEvents,
        );
      }
    }
  });

  it('preserves waiting, boarding, onboard, alighting, and completion authority across windows', () => {
    const canonical = scenario();
    const plan = boardingPlan();
    const run = (passengerEmissionWorkWindowTicks: number) => {
      let state = advanceTransportTicks(
        createTransportSimulationState(canonical, 0, plan, {
          passengerEmissionWorkWindowTicks,
        }),
        2,
      );
      state = applyTransportVehicleCommand(
        state,
        routeCycleVehicle('window-bus', 2),
      );
      state = applyTransportVehicleCommand(state, {
        kind: 'transport.vehicle.start',
        vehicleId: 'window-bus',
      });
      const events: PassengerOriginStopArrivalEvent[] = [];
      for (let tick = 0; tick < 24; tick += 1) {
        const advanced = advanceTransportTicksWithEvents(state, 1);
        state = advanced.state;
        events.push(...advanced.passengerOriginStopArrivalEvents);
      }
      return { snapshot: createTransportSimulationSnapshot(state), events };
    };
    expect(run(12)).toEqual(run(1));
  });

  it('strictly validates the runtime-only emission work window', () => {
    const canonical = scenario();
    for (const passengerEmissionWorkWindowTicks of [0, 1.5, 13])
      expect(() =>
        createTransportSimulationState(canonical, 0, demandPlan(), {
          passengerEmissionWorkWindowTicks,
        }),
      ).toThrow();
    for (const value of [
      null,
      [],
      {},
      { passengerEmissionWorkWindowTicks: Number.NaN },
      { passengerEmissionWorkWindowTicks: Number.POSITIVE_INFINITY },
      { passengerEmissionWorkWindowTicks: 1, extra: true },
    ])
      expect(() => parseTransportSimulationRuntimeTuning(value)).toThrow();
  });

  it('exposes genuinely immutable structured-clone-safe scheduler authority', () => {
    const state = createTransportSimulationState(
      scenario(),
      0,
      dispersedDemandPlan(),
      { passengerEmissionWorkWindowTicks: 4 },
    );
    const scheduler = state.passengerEmissionScheduler!;
    const bucket = scheduler.buckets[0]!;
    const emission = bucket[1][0]!;
    expect(Object.isFrozen(scheduler)).toBe(true);
    expect(Object.isFrozen(scheduler.seedCredits)).toBe(true);
    expect(Object.isFrozen(scheduler.buckets)).toBe(true);
    expect(Object.isFrozen(bucket)).toBe(true);
    expect(Object.isFrozen(bucket[1])).toBe(true);
    expect(Object.isFrozen(emission)).toBe(true);
    expect(() =>
      (scheduler.buckets as PassengerEmissionBucket[]).push(bucket),
    ).toThrow();
    expect(() => Object.assign(emission, { count: 999 })).toThrow();
    expect(structuredClone(scheduler)).toEqual(scheduler);
  });

  it('schedules served, unserved, and multiple same-cell emissions exactly', () => {
    const canonical = scenario();
    const plan = structuredClone(dispersedDemandPlan());
    plan.cells[0]!.assignedStopPlaceId = null;
    plan.cells[0]!.distanceSquaredCells = null;
    plan.cells[3]!.populationWeight = 7;
    plan.grid.totalPopulationWeight = 13;
    const run = (passengerEmissionWorkWindowTicks: number) =>
      createTransportSimulationSnapshot(
        advanceTransportTicks(
          createTransportSimulationState(canonical, 0, plan, {
            passengerEmissionWorkWindowTicks,
          }),
          13,
        ),
      );
    const reference = run(1);
    expect(reference.state.passengerDemand).toMatchObject({
      totalEmittedPassengerCount: 169,
      unservedAtSourcePassengerCount: 13,
      servedEmittedPassengerCount: 156,
    });
    expect(run(12)).toEqual(reference);
  });

  it('retains linear bounded scheduler authority for sixty thousand cells', () => {
    const canonical = scenario();
    const plan = structuredClone(dispersedDemandPlan());
    plan.grid.rows = 1;
    plan.grid.columns = 60_000;
    plan.grid.totalActiveCellCount = 60_000;
    plan.grid.totalPopulationWeight = 60_000;
    plan.emissionPolicy.creditsPerPassenger = 50_000;
    plan.cells = Array.from({ length: 60_000 }, (_, column) => ({
      cellId: `r0c${column}`,
      row: 0,
      column,
      populationWeight: 1,
      assignedStopPlaceId: null,
      distanceSquaredCells: null,
    }));
    const state = createTransportSimulationState(canonical, 0, plan, {
      passengerEmissionWorkWindowTicks: 12,
    });
    const scheduler = state.passengerEmissionScheduler!;
    expect(scheduler.seedCredits).toHaveLength(60_000);
    expect(scheduler.buckets).toHaveLength(0);
  });

  it('keeps near-safe-integer emission arithmetic exact at window twelve', () => {
    const canonical = scenario();
    const plan = structuredClone(dispersedDemandPlan());
    plan.grid.rows = 1;
    plan.grid.columns = 1;
    plan.grid.totalActiveCellCount = 1;
    plan.grid.totalPopulationWeight = Number.MAX_SAFE_INTEGER;
    plan.emissionPolicy.creditsPerPassenger = Number.MAX_SAFE_INTEGER;
    plan.cells = [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        populationWeight: Number.MAX_SAFE_INTEGER,
        assignedStopPlaceId: null,
        distanceSquaredCells: null,
      },
    ];
    const run = (passengerEmissionWorkWindowTicks: number) =>
      createTransportSimulationSnapshot(
        advanceTransportTicks(
          createTransportSimulationState(canonical, 0, plan, {
            passengerEmissionWorkWindowTicks,
          }),
          12,
        ),
      );
    const reference = run(1);
    expect(reference.state.passengerDemand).toMatchObject({
      totalEmittedPassengerCount: 12,
      unservedAtSourcePassengerCount: 12,
    });
    expect(run(12)).toEqual(reference);
  });
});
