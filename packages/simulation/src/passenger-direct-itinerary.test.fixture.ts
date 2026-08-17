import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { parsePassengerDemandPlan } from './passenger-demand.js';

export function itineraryScenario() {
  return parseScenarioPackage({
    manifest: {
      schemaVersion: '1.0.0',
      scenarioId: 'itinerary-v2-fixture',
      scenarioVersion: '1.0.0',
      status: 'test-fixture',
      title: 'Itinerary V2 fixture',
      primarySettlementId: 'fixture-city',
      settlementIds: ['fixture-city'],
      contentHash: 'a'.repeat(64),
      assets: {
        settlements: {
          path: 'settlements.json',
          required: true,
          sha256: '1'.repeat(64),
        },
        stops: { path: 'stops.json', required: true, sha256: '2'.repeat(64) },
        routes: { path: 'routes.json', required: true, sha256: '3'.repeat(64) },
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
      scenarioId: 'itinerary-v2-fixture',
      settlements: [
        {
          settlementId: 'fixture-city',
          name: 'Fixture',
          countryCode: 'ES',
          adminArea: 'Fixture',
          center: { latitude: 38, longitude: -0.7 },
          bounds: { south: 37, west: -1, north: 39, east: 0 },
        },
      ],
    },
    stops: {
      schemaVersion: '1.0.0',
      scenarioId: 'itinerary-v2-fixture',
      stopPlaces: ['A', 'B', 'U'].map((stopPlaceId, index) => ({
        stopPlaceId,
        settlementId: 'fixture-city',
        name: stopPlaceId,
        position: { latitude: 38 + index / 1000, longitude: -0.7 },
      })),
      stopNodes: [
        ['a', 'A'],
        ['b', 'B'],
        ['u', 'U'],
      ].map(([stopNodeId, stopPlaceId], index) => ({
        stopNodeId,
        stopPlaceId,
        settlementId: 'fixture-city',
        name: stopNodeId,
        position: { latitude: 38 + index / 1000, longitude: -0.7 },
        sourceReferences: [],
        resolution: { status: 'fixture' },
      })),
    },
    routes: {
      schemaVersion: '1.0.0',
      scenarioId: 'itinerary-v2-fixture',
      routes: [
        {
          routeId: 'route',
          publicCode: 'R',
          name: 'Route',
          dataStatus: 'fixture',
          patterns: [
            {
              patternId: 'out',
              directionLabel: 'Outbound',
              closesLoop: false,
              stopNodeIds: ['a', 'b'],
            },
          ],
        },
      ],
    },
  });
}

export function itineraryDemandPlan(scenario = itineraryScenario()) {
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'b'.repeat(64),
    scenario: {
      scenarioSchemaVersion: scenario.manifest.schemaVersion,
      scenarioId: scenario.manifest.scenarioId,
      scenarioVersion: scenario.manifest.scenarioVersion,
      contentHash: scenario.manifest.contentHash,
    },
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 1,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 1,
      totalPopulationWeight: 1,
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
        assignedStopPlaceId: 'A',
        distanceSquaredCells: 0,
      },
    ],
    stops: ['A', 'B', 'U'].map((stopPlaceId) => ({ stopPlaceId })),
  });
}
