import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { parsePassengerDemandPlan } from './passenger-demand.js';
import {
  buildPassengerDirectItineraryPlan,
  createPassengerDirectItineraryRuntimeIndex,
} from './passenger-direct-itinerary.js';
import { activatePassengerDirectItineraries } from './passenger-waiting-cohort.js';

const scenario = parseScenarioPackage({
  manifest: {
    schemaVersion: '1.0.0',
    scenarioId: 'waiting-fixture',
    scenarioVersion: '1.0.0',
    status: 'test-fixture',
    title: 'Waiting fixture',
    primarySettlementId: 'city',
    settlementIds: ['city'],
    contentHash: 'a'.repeat(64),
    assets: {
      settlements: {
        path: 'settlements.json',
        required: true,
        sha256: '1'.repeat(64),
      },
      stops: {
        path: 'stops.json',
        required: true,
        sha256: '2'.repeat(64),
      },
      routes: {
        path: 'routes.json',
        required: true,
        sha256: '3'.repeat(64),
      },
    },
    graphContract: {
      vertexSource: 'stops.stopNodes',
      edgeDerivation: 'consecutive-stopNodeIds',
      closeLoopPolicy: 'add-last-to-first-only-when-closesLoop-is-true',
      reverseEdgePolicy: 'never-infer',
    },
  },
  settlements: {
    schemaVersion: '1.0.0',
    scenarioId: 'waiting-fixture',
    settlements: [
      {
        settlementId: 'city',
        name: 'City',
        countryCode: 'ES',
        adminArea: 'Fixture',
        center: { latitude: 38, longitude: -0.7 },
        bounds: { south: 37, west: -1, north: 39, east: 0 },
      },
    ],
  },
  stops: {
    schemaVersion: '1.0.0',
    scenarioId: 'waiting-fixture',
    stopPlaces: ['A', 'B', 'C'].map((stopPlaceId, index) => ({
      stopPlaceId,
      settlementId: 'city',
      name: stopPlaceId,
      position: { latitude: 38, longitude: -0.7 + index * 0.001 },
    })),
    stopNodes: ['A', 'B', 'C'].map((stopPlaceId, index) => ({
      stopNodeId: `node-${stopPlaceId}`,
      stopPlaceId,
      settlementId: 'city',
      name: stopPlaceId,
      position: { latitude: 38, longitude: -0.7 + index * 0.001 },
      sourceReferences: [],
      resolution: { status: 'fixture' },
    })),
  },
  routes: {
    schemaVersion: '1.0.0',
    scenarioId: 'waiting-fixture',
    routes: [
      {
        routeId: 'route-direct',
        publicCode: 'D',
        name: 'Direct',
        dataStatus: 'fixture',
        patterns: [
          {
            patternId: 'pattern-direct',
            directionLabel: 'Direct',
            closesLoop: false,
            stopNodeIds: ['node-A', 'node-B'],
          },
        ],
      },
    ],
  },
});

const demandPlan = parsePassengerDemandPlan({
  schemaVersion: '1.0.0',
  demandModelContentHash: 'b'.repeat(64),
  scenario: {
    scenarioSchemaVersion: '1.0.0',
    scenarioId: 'waiting-fixture',
    scenarioVersion: '1.0.0',
    contentHash: 'a'.repeat(64),
  },
  grid: {
    cityId: 'Q1',
    populationGridSchemaVersion: '1.0.0',
    gridVersion: '1.0.0',
    rows: 1,
    columns: 3,
    resolutionDegrees: 0.001,
    totalActiveCellCount: 3,
    totalPopulationWeight: 3,
  },
  catchmentPolicy: { maxAccessDistanceCells: 5 },
  emissionPolicy: {
    emissionCreditsPerWeightPerTick: 1,
    creditsPerPassenger: 1,
  },
  accessPolicy: { accessTicksPerCell: 1 },
  cells: ['A', 'B', 'C'].map((stopPlaceId, column) => ({
    cellId: `r0c${column}`,
    row: 0,
    column,
    populationWeight: 1,
    assignedStopPlaceId: stopPlaceId,
    distanceSquaredCells: 0,
  })),
  stops: ['A', 'B', 'C'].map((stopPlaceId) => ({ stopPlaceId })),
});

const itineraryPlan = buildPassengerDirectItineraryPlan({
  scenario,
  demandPlan,
});
const itineraryIndex = createPassengerDirectItineraryRuntimeIndex({
  plan: itineraryPlan,
  scenario,
  demandPlan,
});

describe('directional passenger waiting cohorts', () => {
  it('activates direct assignments, merges stable cohorts, and counts unavailable journeys', () => {
    const first = activatePassengerDirectItineraries({
      itineraryIndex,
      demandPlan,
      destinationAssignedGroups: [
        {
          passengerJourneyGroupId: 'passenger-journey-group-1',
          originStopPlaceId: 'A',
          destinationCellId: 'r0c1',
          destinationStopPlaceId: 'B',
          count: 3,
          firstAssignedTick: 4,
          lastAssignedTick: 4,
        },
        {
          passengerJourneyGroupId: 'passenger-journey-group-2',
          originStopPlaceId: 'A',
          destinationCellId: 'r0c2',
          destinationStopPlaceId: 'C',
          count: 2,
          firstAssignedTick: 4,
          lastAssignedTick: 4,
        },
      ],
      waitingCohorts: [],
      nextPassengerWaitingCohortSequence: 1,
      directItineraryUnavailablePassengerCount: 0,
      activationTick: 4,
    });

    expect(first).toMatchObject({
      nextPassengerWaitingCohortSequence: 2,
      directItineraryUnavailablePassengerCount: 2,
      totalWaitingForVehiclePassengerCount: 3,
      waitingCohorts: [
        {
          passengerWaitingCohortId: 'passenger-waiting-cohort-1',
          originStopPlaceId: 'A',
          originStopNodeId: 'node-A',
          routeId: 'route-direct',
          patternId: 'pattern-direct',
          destinationStopPlaceId: 'B',
          destinationStopNodeId: 'node-B',
          destinationCellId: 'r0c1',
          count: 3,
          firstAssignedTick: 4,
          lastAssignedTick: 4,
        },
      ],
    });

    const merged = activatePassengerDirectItineraries({
      itineraryIndex,
      demandPlan,
      destinationAssignedGroups: [
        {
          passengerJourneyGroupId: 'passenger-journey-group-3',
          originStopPlaceId: 'A',
          destinationCellId: 'r0c1',
          destinationStopPlaceId: 'B',
          count: 5,
          firstAssignedTick: 7,
          lastAssignedTick: 7,
        },
      ],
      waitingCohorts: first.waitingCohorts,
      nextPassengerWaitingCohortSequence:
        first.nextPassengerWaitingCohortSequence,
      directItineraryUnavailablePassengerCount:
        first.directItineraryUnavailablePassengerCount,
      activationTick: 7,
    });
    expect(merged.waitingCohorts[0]).toMatchObject({
      passengerWaitingCohortId: 'passenger-waiting-cohort-1',
      count: 8,
      firstAssignedTick: 4,
      lastAssignedTick: 7,
    });
    expect(Object.isFrozen(merged.waitingCohorts)).toBe(true);
    expect(Object.isFrozen(merged.waitingCohorts[0])).toBe(true);

    const separated = activatePassengerDirectItineraries({
      itineraryIndex,
      demandPlan,
      destinationAssignedGroups: [
        {
          passengerJourneyGroupId: 'passenger-journey-group-4',
          originStopPlaceId: 'A',
          destinationCellId: 'r0c1',
          destinationStopPlaceId: 'B',
          count: 1,
          firstAssignedTick: 8,
          lastAssignedTick: 8,
        },
      ],
      waitingCohorts: first.waitingCohorts,
      nextPassengerWaitingCohortSequence:
        first.nextPassengerWaitingCohortSequence,
      directItineraryUnavailablePassengerCount:
        first.directItineraryUnavailablePassengerCount,
      activationTick: 8,
      nonMergeableWaitingCohortIds: new Set([
        first.waitingCohorts[0]!.passengerWaitingCohortId,
      ]),
    });
    expect(separated.waitingCohorts).toEqual([
      expect.objectContaining({
        passengerWaitingCohortId: 'passenger-waiting-cohort-1',
        count: 3,
        lastAssignedTick: 4,
      }),
      expect.objectContaining({
        passengerWaitingCohortId: 'passenger-waiting-cohort-2',
        count: 1,
        firstAssignedTick: 8,
        lastAssignedTick: 8,
      }),
    ]);
  });

  it('rejects malformed authority and assignment references without mutation', () => {
    const base = {
      itineraryIndex,
      demandPlan,
      destinationAssignedGroups: [],
      waitingCohorts: [],
      nextPassengerWaitingCohortSequence: 1,
      directItineraryUnavailablePassengerCount: 0,
      activationTick: 4,
    } as const;
    expect(() =>
      activatePassengerDirectItineraries({
        ...base,
        nextPassengerWaitingCohortSequence: 0,
      }),
    ).toThrow('waiting-cohort authority');
    expect(() =>
      activatePassengerDirectItineraries({
        ...base,
        directItineraryUnavailablePassengerCount: -1,
      }),
    ).toThrow('waiting-cohort authority');

    const assignment = {
      passengerJourneyGroupId: 'passenger-journey-group-1',
      originStopPlaceId: 'A',
      destinationCellId: 'r0c1',
      destinationStopPlaceId: 'B',
      count: 1,
      firstAssignedTick: 4,
      lastAssignedTick: 4,
    } as const;
    expect(() =>
      activatePassengerDirectItineraries({
        ...base,
        destinationAssignedGroups: [{ ...assignment, count: 0 }],
      }),
    ).toThrow('destination assignment activation');
    expect(() =>
      activatePassengerDirectItineraries({
        ...base,
        destinationAssignedGroups: [
          { ...assignment, destinationStopPlaceId: 'C' },
        ],
      }),
    ).toThrow('does not match its cell');
    expect(assignment).toEqual({
      passengerJourneyGroupId: 'passenger-journey-group-1',
      originStopPlaceId: 'A',
      destinationCellId: 'r0c1',
      destinationStopPlaceId: 'B',
      count: 1,
      firstAssignedTick: 4,
      lastAssignedTick: 4,
    });
  });

  it('rejects corrupted restored cohorts and duplicate canonical keys', () => {
    const activated = activatePassengerDirectItineraries({
      itineraryIndex,
      demandPlan,
      destinationAssignedGroups: [
        {
          passengerJourneyGroupId: 'passenger-journey-group-1',
          originStopPlaceId: 'A',
          destinationCellId: 'r0c1',
          destinationStopPlaceId: 'B',
          count: 1,
          firstAssignedTick: 2,
          lastAssignedTick: 2,
        },
      ],
      waitingCohorts: [],
      nextPassengerWaitingCohortSequence: 1,
      directItineraryUnavailablePassengerCount: 0,
      activationTick: 2,
    });
    const cohort = activated.waitingCohorts[0]!;
    const base = {
      itineraryIndex,
      demandPlan,
      destinationAssignedGroups: [],
      nextPassengerWaitingCohortSequence: 2,
      directItineraryUnavailablePassengerCount: 0,
      activationTick: 2,
    } as const;
    expect(() =>
      activatePassengerDirectItineraries({
        ...base,
        waitingCohorts: [{ ...cohort, count: 0 }],
      }),
    ).toThrow('directional waiting cohort');
    expect(() =>
      activatePassengerDirectItineraries({
        ...base,
        waitingCohorts: [cohort, { ...cohort }],
      }),
    ).toThrow('directional waiting cohort');
    expect(() =>
      activatePassengerDirectItineraries({
        ...base,
        waitingCohorts: [{ ...cohort, destinationStopNodeId: 'node-C' }],
      }),
    ).toThrow('directional waiting cohort');
  });

  it('performs exactly one indexed lookup per cohort and new assignment', () => {
    let lookups = 0;
    const countedIndex = Object.freeze({
      plan: itineraryIndex.plan,
      find: (origin: string, destination: string) => {
        lookups += 1;
        return itineraryIndex.find(origin, destination);
      },
    });
    const first = activatePassengerDirectItineraries({
      itineraryIndex: countedIndex,
      demandPlan,
      destinationAssignedGroups: Array.from({ length: 20 }, (_, index) => ({
        passengerJourneyGroupId: `passenger-journey-group-${index + 1}`,
        originStopPlaceId: 'A',
        destinationCellId: 'r0c1',
        destinationStopPlaceId: 'B',
        count: 1,
        firstAssignedTick: 1,
        lastAssignedTick: 1,
      })),
      waitingCohorts: [],
      nextPassengerWaitingCohortSequence: 1,
      directItineraryUnavailablePassengerCount: 0,
      activationTick: 1,
    });
    expect(lookups).toBe(20);
    expect(first.waitingCohorts).toHaveLength(1);
    lookups = 0;
    activatePassengerDirectItineraries({
      itineraryIndex: countedIndex,
      demandPlan,
      destinationAssignedGroups: Array.from({ length: 15 }, (_, index) => ({
        passengerJourneyGroupId: `passenger-journey-group-${index + 21}`,
        originStopPlaceId: 'A',
        destinationCellId: 'r0c1',
        destinationStopPlaceId: 'B',
        count: 1,
        firstAssignedTick: 2,
        lastAssignedTick: 2,
      })),
      waitingCohorts: first.waitingCohorts,
      nextPassengerWaitingCohortSequence:
        first.nextPassengerWaitingCohortSequence,
      directItineraryUnavailablePassengerCount: 0,
      activationTick: 2,
    });
    expect(lookups).toBe(16);
  });

  it('activates a real Torrevieja direct pair without inventing platform connectivity', () => {
    const root = join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'apps',
      'web',
      'public',
      'scenarios',
      'torrevieja-legacy-all-v1',
    );
    const read = (name: string) =>
      JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
    const canonical = parseScenarioPackage({
      manifest: read('scenario.json'),
      settlements: read('settlements.json'),
      stops: read('stops.json'),
      routes: read('routes.json'),
      presentation: read('presentation.json'),
      provenance: read('provenance.json'),
    });
    const realDemand = parsePassengerDemandPlan({
      schemaVersion: '1.0.0',
      demandModelContentHash: 'e'.repeat(64),
      scenario: {
        scenarioSchemaVersion: '1.0.0',
        scenarioId: canonical.manifest.scenarioId,
        scenarioVersion: canonical.manifest.scenarioVersion,
        contentHash: canonical.manifest.contentHash,
      },
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
          assignedStopPlaceId: 'tv-place-0137',
          distanceSquaredCells: 0,
        },
        {
          cellId: 'r0c1',
          row: 0,
          column: 1,
          populationWeight: 1,
          assignedStopPlaceId: 'tv-place-0180',
          distanceSquaredCells: 0,
        },
      ],
      stops: canonical.stops.stopPlaces.map(({ stopPlaceId }) => ({
        stopPlaceId,
      })),
    });
    const realItineraries = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: realDemand,
    });
    const realItineraryIndex = createPassengerDirectItineraryRuntimeIndex({
      plan: realItineraries,
      scenario: canonical,
      demandPlan: realDemand,
    });
    expect(realItineraries.stopPlaceIds).toHaveLength(134);
    expect(realItineraries.directPairCount).toBeGreaterThan(0);
    expect(realItineraries.unavailablePairCount).toBeGreaterThan(0);
    const result = activatePassengerDirectItineraries({
      itineraryIndex: realItineraryIndex,
      demandPlan: realDemand,
      destinationAssignedGroups: [
        {
          passengerJourneyGroupId: 'passenger-journey-group-1',
          originStopPlaceId: 'tv-place-0137',
          destinationCellId: 'r0c1',
          destinationStopPlaceId: 'tv-place-0180',
          count: 2,
          firstAssignedTick: 1,
          lastAssignedTick: 1,
        },
      ],
      waitingCohorts: [],
      nextPassengerWaitingCohortSequence: 1,
      directItineraryUnavailablePassengerCount: 0,
      activationTick: 1,
    });
    expect(result.waitingCohorts[0]).toMatchObject({
      originStopNodeId: 'tv-stop-0137',
      destinationStopNodeId: 'tv-stop-0180',
      routeId: 'legacy-A',
      patternId: 'legacy-A-torrevieja-la-mata',
      count: 2,
    });
    expect(
      realItineraries.entries.find(
        (entry) =>
          entry.originStopPlaceId === 'tv-place-0207' &&
          entry.destinationStopPlaceId === 'tv-place-0207',
      ),
    ).toBeUndefined();
  });
});
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
