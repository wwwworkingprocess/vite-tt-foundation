import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  boardPassengersAtVehicleCalls,
  createVehiclePassengerCapacity,
  processPassengerTransitAtVehicleCalls,
  type PassengerBoardingInput,
  type PassengerTransitInput,
} from './index.js';

const publicRoot = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'web',
  'public',
  'scenarios',
);
const scenario = (scenarioId: string) => {
  const root = join(publicRoot, scenarioId);
  const json = (name: string) =>
    JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
  return parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
};

const board = (input: {
  routeId: string;
  patternId: string;
  callNodeId: string;
  cohortNodeId: string;
  occurrenceIndex: number;
  wrapsPatternEnd?: boolean;
}) =>
  boardPassengersAtVehicleCalls({
    tick: 10,
    waitingCohorts: [
      {
        passengerWaitingCohortId: 'passenger-waiting-cohort-1',
        originStopPlaceId: 'origin-place',
        originStopNodeId: input.cohortNodeId,
        routeId: input.routeId,
        patternId: input.patternId,
        originOccurrenceIndex: input.occurrenceIndex,
        destinationCellId: 'r0c0',
        destinationStopPlaceId: 'destination-place',
        destinationStopNodeId: 'destination-node',
        destinationOccurrenceIndex: 0,
        wrapsPatternEnd: input.wrapsPatternEnd ?? false,
        edgeCount: 1,
        count: 3,
        firstAssignedTick: 1,
        lastAssignedTick: 2,
      },
    ] as PassengerBoardingInput['waitingCohorts'],
    onboardGroups: [],
    nextPassengerOnboardGroupSequence: 1,
    totalBoardedPassengerCount: 0,
    capacities: [createVehiclePassengerCapacity('real-bus', 3)],
    vehicleOperations: [
      {
        vehicleId: 'real-bus',
        patternRunSequence: 1,
        patternRunStartedAtTick: 0,
        movementStartedAtTick: 0,
        stopCallSequence: 2,
      },
    ] as PassengerBoardingInput['vehicleOperations'],
    currentStopCalls: [
      {
        vehicleId: 'real-bus',
        routeId: input.routeId,
        patternId: input.patternId,
        stopNodeId: input.callNodeId,
        occurrenceIndex: input.occurrenceIndex,
        patternRunSequence: 1,
        stopCallSequence: 2,
        tick: 10,
      },
    ] as PassengerBoardingInput['currentStopCalls'],
    itineraryIsValid: () => true,
  });

describe('public scenario passenger boarding evidence', () => {
  it('keeps Torrevieja Route C platform directions distinct', () => {
    const canonical = scenario('torrevieja-legacy-abc-v1');
    const route = canonical.routes.routes.find(
      ({ routeId }) => routeId === 'legacy-C',
    )!;
    const outboundTerminal = route.patterns[0]!.stopNodeIds.at(-1)!;
    const returnOrigin = route.patterns[1]!.stopNodeIds[0]!;
    const nodes = new Map(
      canonical.stops.stopNodes.map((node) => [node.stopNodeId, node]),
    );
    expect(outboundTerminal).toBe('tv-stop-0207');
    expect(returnOrigin).toBe('tv-stop-0209');
    expect(nodes.get(outboundTerminal)!.stopPlaceId).toBe(
      nodes.get(returnOrigin)!.stopPlaceId,
    );
    expect(
      board({
        routeId: route.routeId,
        patternId: route.patterns[1]!.patternId,
        callNodeId: outboundTerminal,
        cohortNodeId: returnOrigin,
        occurrenceIndex: 0,
      }).totalBoardedPassengerCount,
    ).toBe(0);
    expect(
      board({
        routeId: route.routeId,
        patternId: route.patterns[1]!.patternId,
        callNodeId: returnOrigin,
        cohortNodeId: returnOrigin,
        occurrenceIndex: 0,
      }).totalBoardedPassengerCount,
    ).toBe(3);
  });

  it('boards on a real Elche closed loop with next-run alight identity', () => {
    const canonical = scenario('elche-urban-abc-v1');
    expect(canonical.stops.stopPlaces.length).toBeGreaterThan(0);
    const route = canonical.routes.routes.find((candidate) =>
      candidate.patterns.some(({ closesLoop }) => closesLoop),
    )!;
    const pattern = route.patterns.find(({ closesLoop }) => closesLoop)!;
    const originOccurrenceIndex = pattern.stopNodeIds.length - 1;
    const result = board({
      routeId: route.routeId,
      patternId: pattern.patternId,
      callNodeId: pattern.stopNodeIds[originOccurrenceIndex]!,
      cohortNodeId: pattern.stopNodeIds[originOccurrenceIndex]!,
      occurrenceIndex: originOccurrenceIndex,
      wrapsPatternEnd: true,
    });
    expect(result.onboardGroups[0]).toMatchObject({
      boardedAtPatternRunSequence: 1,
      alightAtPatternRunSequence: 2,
      count: 3,
    });
  });

  it('completes a Torrevieja Route C journey only at the exact directional platform', () => {
    const canonical = scenario('torrevieja-legacy-abc-v1');
    const route = canonical.routes.routes.find(
      ({ routeId }) => routeId === 'legacy-C',
    )!;
    const pattern = route.patterns[1]!;
    const destinationNodeId = pattern.stopNodeIds[0]!;
    const destinationPlaceId = canonical.stops.stopNodes.find(
      ({ stopNodeId }) => stopNodeId === destinationNodeId,
    )!.stopPlaceId!;
    const transit = (stopNodeId: string) =>
      processPassengerTransitAtVehicleCalls({
        tick: 20 as never,
        demandPlan: {
          accessPolicy: { accessTicksPerCell: 1 },
          catchmentPolicy: { maxAccessDistanceCells: 5 },
          cells: [
            {
              cellId: 'r0c0',
              row: 0,
              column: 0,
              populationWeight: 1,
              assignedStopPlaceId: destinationPlaceId,
              distanceSquaredCells: 0,
            },
          ],
        } as PassengerTransitInput['demandPlan'],
        waitingCohorts: [],
        waitingGenerationLineageWatermarks: [],
        onboardGroups: [
          {
            passengerOnboardGroupId: 'passenger-onboard-group-1',
            sourceWaitingCohortId: 'passenger-waiting-cohort-1',
            vehicleId: 'route-c-bus',
            routeId: route.routeId,
            patternId: pattern.patternId,
            originStopPlaceId: destinationPlaceId,
            originStopNodeId: pattern.stopNodeIds.at(-1)!,
            originOccurrenceIndex: pattern.stopNodeIds.length - 1,
            destinationCellId: 'r0c0',
            destinationStopPlaceId: destinationPlaceId,
            destinationStopNodeId: destinationNodeId,
            destinationOccurrenceIndex: 0,
            wrapsPatternEnd: true,
            edgeCount: 1,
            boardedAtTick: 10,
            boardedAtPatternRunSequence: 1,
            alightAtPatternRunSequence: 2,
            boardedAtStopCallSequence: 2,
            count: 4,
            firstAssignedTick: 5,
            lastAssignedTick: 6,
          },
        ],
        destinationAccessGroups: [],
        nextPassengerOnboardGroupSequence: 2,
        nextPassengerDestinationAccessGroupSequence: 1,
        totalWaitingForVehiclePassengerCount: 0,
        totalBoardedPassengerCount: 4,
        totalOnboardPassengerCount: 4,
        totalAlightedPassengerCount: 0,
        totalInDestinationAccessPassengerCount: 0,
        totalCompletedJourneyPassengerCount: 0,
        capacities: [createVehiclePassengerCapacity('route-c-bus', 4)],
        vehicleOperations: [
          {
            vehicleId: 'route-c-bus',
            patternRunSequence: 2,
            patternRunStartedAtTick: 20,
            movementStartedAtTick: 10,
            stopCallSequence: 3,
          },
        ],
        currentStopCalls: [
          {
            vehicleId: 'route-c-bus',
            routeId: route.routeId,
            patternId: pattern.patternId,
            stopNodeId,
            occurrenceIndex: 0,
            patternRunSequence: 2,
            stopCallSequence: 3,
            tick: 20,
          },
        ],
        itineraryIsValid: () => true,
      } as PassengerTransitInput);
    expect(transit('tv-stop-0207').totalOnboardPassengerCount).toBe(4);
    const completed = transit('tv-stop-0209');
    expect(completed.totalOnboardPassengerCount).toBe(0);
    expect(completed.totalCompletedJourneyPassengerCount).toBe(4);
  });

  it('completes an Elche wrapped circular journey only in its target run', () => {
    const canonical = scenario('elche-urban-abc-v1');
    const route = canonical.routes.routes.find((candidate) =>
      candidate.patterns.some(({ closesLoop }) => closesLoop),
    )!;
    const pattern = route.patterns.find(({ closesLoop }) => closesLoop)!;
    expect(pattern.stopNodeIds.length).toBeGreaterThan(2);
    const destinationNodeId = pattern.stopNodeIds[1]!;
    const destinationPlaceId = canonical.stops.stopNodes.find(
      ({ stopNodeId }) => stopNodeId === destinationNodeId,
    )!.stopPlaceId!;
    const base = {
      tick: 30 as never,
      demandPlan: {
        accessPolicy: { accessTicksPerCell: 1 },
        catchmentPolicy: { maxAccessDistanceCells: 5 },
        cells: [
          {
            cellId: 'r0c0',
            row: 0,
            column: 0,
            populationWeight: 1,
            assignedStopPlaceId: destinationPlaceId,
            distanceSquaredCells: 0,
          },
        ],
      },
      waitingCohorts: [],
      waitingGenerationLineageWatermarks: [],
      onboardGroups: [
        {
          passengerOnboardGroupId: 'passenger-onboard-group-1',
          sourceWaitingCohortId: 'passenger-waiting-cohort-1',
          vehicleId: 'elche-bus',
          routeId: route.routeId,
          patternId: pattern.patternId,
          originStopPlaceId: destinationPlaceId,
          originStopNodeId: pattern.stopNodeIds.at(-1)!,
          originOccurrenceIndex: pattern.stopNodeIds.length - 1,
          destinationCellId: 'r0c0',
          destinationStopPlaceId: destinationPlaceId,
          destinationStopNodeId: destinationNodeId,
          destinationOccurrenceIndex: 1,
          wrapsPatternEnd: true,
          edgeCount: 2,
          boardedAtTick: 10,
          boardedAtPatternRunSequence: 1,
          alightAtPatternRunSequence: 2,
          boardedAtStopCallSequence: 1,
          count: 2,
          firstAssignedTick: 4,
          lastAssignedTick: 5,
        },
      ],
      destinationAccessGroups: [],
      nextPassengerOnboardGroupSequence: 2,
      nextPassengerDestinationAccessGroupSequence: 1,
      totalWaitingForVehiclePassengerCount: 0,
      totalBoardedPassengerCount: 2,
      totalOnboardPassengerCount: 2,
      totalAlightedPassengerCount: 0,
      totalInDestinationAccessPassengerCount: 0,
      totalCompletedJourneyPassengerCount: 0,
      capacities: [createVehiclePassengerCapacity('elche-bus', 2)],
      itineraryIsValid: () => true,
    } as unknown as PassengerTransitInput;
    const run = (patternRunSequence: number) =>
      processPassengerTransitAtVehicleCalls({
        ...base,
        vehicleOperations: [
          {
            vehicleId: 'elche-bus',
            patternRunSequence,
            patternRunStartedAtTick: 20,
            movementStartedAtTick: 10,
            stopCallSequence: 2,
          },
        ],
        currentStopCalls: [
          {
            vehicleId: 'elche-bus',
            routeId: route.routeId,
            patternId: pattern.patternId,
            stopNodeId: destinationNodeId,
            occurrenceIndex: 1,
            patternRunSequence,
            stopCallSequence: 2,
            tick: 30,
          },
        ],
      } as PassengerTransitInput);
    expect(run(1).totalOnboardPassengerCount).toBe(2);
    expect(run(2).totalCompletedJourneyPassengerCount).toBe(2);
  });
});
