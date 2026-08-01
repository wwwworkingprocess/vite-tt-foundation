import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  boardPassengersAtVehicleCalls,
  createVehiclePassengerCapacity,
  type PassengerBoardingInput,
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
});
