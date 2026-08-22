import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createScenarioCoordinate,
  createTransportSimulationState,
  parsePassengerDemandPlan,
} from './index.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'web',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
export const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
export const demandPlan = () => {
  const canonical = scenario();
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'd'.repeat(64),
    scenario: createScenarioCoordinate(canonical),
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 2,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 2,
      totalPopulationWeight: 2,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 1,
    },
    accessPolicy: { accessTicksPerCell: 1 },
    cells: [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        populationWeight: 1,
        assignedStopPlaceId: 'tv-place-0053',
        distanceSquaredCells: 0,
      },
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        populationWeight: 1,
        assignedStopPlaceId: 'tv-place-0065',
        distanceSquaredCells: 0,
      },
    ],
    stops: [{ stopPlaceId: 'tv-place-0053' }, { stopPlaceId: 'tv-place-0065' }],
  });
};

export const dispersedDemandPlan = () => {
  const canonical = scenario();
  const stopPlaceIds = [
    'tv-place-0053',
    'tv-place-0065',
    'tv-place-0067',
    'tv-place-0093',
  ];
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'a'.repeat(64),
    scenario: createScenarioCoordinate(canonical),
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 4,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 4,
      totalPopulationWeight: 10,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 1,
    },
    accessPolicy: { accessTicksPerCell: 1 },
    cells: stopPlaceIds.map((assignedStopPlaceId, column) => ({
      cellId: `r0c${column}`,
      row: 0,
      column,
      populationWeight: column + 1,
      assignedStopPlaceId,
      distanceSquaredCells: 0,
    })),
    stops: stopPlaceIds.map((stopPlaceId) => ({ stopPlaceId })),
  });
};

export const boardingPlan = () => {
  const plan = structuredClone(demandPlan());
  plan.cells[0]!.assignedStopPlaceId = 'tv-place-0108';
  plan.cells[1]!.assignedStopPlaceId = 'tv-place-0093';
  plan.stops = [
    { stopPlaceId: 'tv-place-0093' },
    { stopPlaceId: 'tv-place-0108' },
  ];
  return plan;
};

export const routeCycleVehicle = (
  vehicleId: string,
  passengerCapacity = 1,
) => ({
  kind: 'transport.vehicle.create-route-cycle' as const,
  vehicleId,
  label: vehicleId,
  routeId: 'legacy-A2',
  passengerCapacity,
  legs: [
    {
      patternId: 'legacy-A2-torrevieja-la-mata',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1' as const,
        edgeTravelTicks: [1, 1, 1, 1],
      },
    },
    {
      patternId: 'legacy-A2-la-mata-torrevieja',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1' as const,
        edgeTravelTicks: [1, 1],
      },
    },
  ],
});

export const boardedState = (vehicleId = 'boarding-bus') => {
  const canonical = scenario();
  const plan = boardingPlan();
  let state = advanceTransportTicks(
    createTransportSimulationState(canonical, 0, plan),
    2,
  );
  state = applyTransportVehicleCommand(state, routeCycleVehicle(vehicleId));
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId,
  });
  return { canonical, plan, state };
};

export const destinationAccessStates = () => {
  const canonical = scenario();
  const plan = structuredClone(boardingPlan());
  for (const cell of plan.cells) cell.distanceSquaredCells = 4;
  plan.accessPolicy.accessTicksPerCell = 2;
  let state = advanceTransportTicks(
    createTransportSimulationState(canonical, 0, plan),
    2,
  );
  state = applyTransportVehicleCommand(state, routeCycleVehicle('access-bus'));
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: 'access-bus',
  });
  while (state.currentAlightingEvents.length === 0)
    state = advanceTransportTicks(state, 1);
  const alighted = state;
  state = advanceTransportTicks(state, 1);
  const activeAccess = state;
  return { canonical, plan, alighted, activeAccess };
};

export const completedJourneyState = () => {
  const { canonical, plan, state: boarded } = boardedState('completion-bus');
  let state = boarded;
  while (state.currentJourneyCompletionEvents.length === 0)
    state = advanceTransportTicks(state, 1);
  return { canonical, plan, completed: state };
};

export const laterRunJourneyStates = () => {
  const canonical = scenario();
  const build = (accessDistance: number) => {
    const plan = structuredClone(boardingPlan());
    for (const cell of plan.cells) cell.distanceSquaredCells = accessDistance;
    plan.accessPolicy.accessTicksPerCell = 3;
    plan.emissionPolicy.creditsPerPassenger = 8;
    let state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    state = applyTransportVehicleCommand(
      state,
      routeCycleVehicle('later-run-bus'),
    );
    return {
      plan,
      state: applyTransportVehicleCommand(state, {
        kind: 'transport.vehicle.start',
        vehicleId: 'later-run-bus',
      }),
    };
  };
  const accessAuthority = build(4);
  let access: typeof accessAuthority.state | undefined;
  let state = accessAuthority.state;
  for (let index = 0; index < 200 && !access; index += 1) {
    state = advanceTransportTicks(state, 1);
    if (
      state.passengerDemand.status === 'active' &&
      state.passengerDemand.destinationAccessGroups.some(
        (group) => group.boardedAtPatternRunSequence >= 2,
      )
    )
      access = advanceTransportTicks(state, 1);
  }
  const completionAuthority = build(0);
  let completion: typeof completionAuthority.state | undefined;
  state = completionAuthority.state;
  for (let index = 0; index < 200 && !completion; index += 1) {
    state = advanceTransportTicks(state, 1);
    if (
      state.currentJourneyCompletionEvents.some(
        (event) => event.boardedAtPatternRunSequence >= 2,
      )
    )
      completion = state;
  }
  if (!access || !completion)
    throw new Error('Expected generated later-run passenger journey states.');
  return {
    canonical,
    accessPlan: accessAuthority.plan,
    completionPlan: completionAuthority.plan,
    access,
    completion,
  };
};
