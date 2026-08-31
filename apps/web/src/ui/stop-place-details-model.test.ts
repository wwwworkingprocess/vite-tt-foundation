import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  deriveStopPlaceDetailsModel,
  type StopPlaceDetailsModel,
} from './stop-place-details-model.js';

const loadScenario = (city: string, scenarioId: string) => {
  const root = join(
    import.meta.dirname,
    '..',
    '..',
    'public',
    'scenarios',
    city,
    scenarioId,
  );
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

const synthetic = parseScenarioPackage({
  manifest: {
    schemaVersion: '1.0.0',
    scenarioId: 'details-fixture',
    scenarioVersion: '1.0.0',
    status: 'development-seed',
    title: 'Details fixture',
    primarySettlementId: 'town',
    settlementIds: ['town'],
    contentHash: 'a'.repeat(64),
    assets: {
      settlements: {
        path: 'settlements.json',
        sha256: 'b'.repeat(64),
        required: true,
      },
      stops: { path: 'stops.json', sha256: 'c'.repeat(64), required: true },
      routes: { path: 'routes.json', sha256: 'd'.repeat(64), required: true },
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
    scenarioId: 'details-fixture',
    settlements: [
      {
        settlementId: 'town',
        name: 'Test Town',
        countryCode: 'ES',
        adminArea: 'Test',
        center: { latitude: 1, longitude: 1 },
        bounds: { south: 0, west: 0, north: 2, east: 2 },
      },
    ],
  },
  stops: {
    schemaVersion: '1.0.0',
    scenarioId: 'details-fixture',
    stopPlaces: [
      {
        stopPlaceId: 'shared',
        settlementId: 'town',
        name: 'Shared',
        position: { latitude: 1, longitude: 1 },
      },
      { stopPlaceId: 'other', settlementId: 'town', name: 'Other' },
    ],
    stopNodes: [
      {
        stopNodeId: 'shared-a',
        stopPlaceId: 'shared',
        settlementId: 'town',
        name: 'Shared A',
        position: { latitude: 1, longitude: 1 },
        sourceReferences: [],
        resolution: { status: 'exact' },
      },
      {
        stopNodeId: 'platform',
        stopPlaceId: null,
        settlementId: 'town',
        name: null,
        position: { latitude: 1.1, longitude: 1.1 },
        sourceReferences: [],
        resolution: { status: 'unresolved' },
      },
      {
        stopNodeId: 'other',
        stopPlaceId: 'other',
        settlementId: 'town',
        name: 'Other node',
        position: { latitude: 1.2, longitude: 1.2 },
        sourceReferences: [],
        resolution: { status: 'exact' },
      },
      {
        stopNodeId: 'shared-b',
        stopPlaceId: 'shared',
        settlementId: 'town',
        name: 'Shared B',
        position: { latitude: 1, longitude: 1 },
        sourceReferences: [],
        resolution: { status: 'exact' },
      },
    ],
  },
  routes: {
    schemaVersion: '1.0.0',
    scenarioId: 'details-fixture',
    routes: [
      {
        routeId: 'route-a',
        publicCode: 'A',
        name: 'Alpha',
        dataStatus: 'accepted',
        patterns: [
          {
            patternId: 'a-loop',
            directionLabel: 'Clockwise',
            closesLoop: true,
            stopNodeIds: ['shared-a', 'platform', 'other', 'shared-b'],
          },
          {
            patternId: 'a-return',
            directionLabel: 'Return',
            closesLoop: false,
            stopNodeIds: ['other', 'shared-a'],
          },
        ],
      },
      {
        routeId: 'route-b',
        publicCode: 'B',
        name: 'Beta',
        dataStatus: 'accepted',
        patterns: [
          {
            patternId: 'b-out',
            directionLabel: 'Outbound',
            closesLoop: false,
            stopNodeIds: ['other', 'shared-b'],
          },
        ],
      },
    ],
  },
});

describe('deriveStopPlaceDetailsModel', () => {
  it('exposes every projection-owned collection as readonly', () => {
    type IsReadonlyArray<Value> = Value extends unknown[]
      ? false
      : Value extends readonly unknown[]
        ? true
        : false;
    type Services = StopPlaceDetailsModel['services'];
    type Patterns = Services[number]['patterns'];
    type Stops = Patterns[number]['stops'];
    type Badges = Stops[number]['services'];
    const proof: [
      IsReadonlyArray<Services>,
      IsReadonlyArray<Patterns>,
      IsReadonlyArray<Stops>,
      IsReadonlyArray<Badges>,
    ] = [true, true, true, true];
    expect(proof).toEqual([true, true, true, true]);
  });

  it('preserves canonical routes, patterns, occurrences, loops, platform nodes, and interchange order', () => {
    const model = deriveStopPlaceDetailsModel(synthetic, 'shared' as never)!;
    expect(model.settlement?.name).toBe('Test Town');
    expect(model.directionalNodes.map(({ stopNodeId }) => stopNodeId)).toEqual([
      'shared-a',
      'shared-b',
    ]);
    expect(model.services.map(({ publicCode }) => publicCode)).toEqual([
      'A',
      'B',
    ]);
    expect(
      model.services[0]!.patterns.map(({ patternId }) => patternId),
    ).toEqual(['a-loop', 'a-return']);
    const loop = model.services[0]!.patterns[0]!;
    expect(loop.closesLoop).toBe(true);
    expect(loop.stops.map(({ stopNodeId }) => stopNodeId)).toEqual([
      'shared-a',
      'platform',
      'other',
      'shared-b',
    ]);
    expect(loop.stops.filter(({ selected }) => selected)).toHaveLength(2);
    expect(loop.stops[1]).toMatchObject({
      occurrenceIndex: 1,
      stopPlaceId: null,
      name: 'platform',
      services: [],
    });
    expect(loop.stops[0]!.services.map(({ publicCode }) => publicCode)).toEqual(
      ['A', 'B'],
    );
    expect(loop.stops[0]!.services).toHaveLength(2);
    expect(Object.isFrozen(model)).toBe(true);
  });

  it('projects real Torrevieja topology exactly and rejects an unknown StopPlace', () => {
    const scenario = loadScenario('torrevieja-v1', 'torrevieja-legacy-abc-v1');
    const route = scenario.routes.routes[0]!;
    const pattern = route.patterns[0]!;
    const node = scenario.stops.stopNodes.find(
      ({ stopNodeId }) => stopNodeId === pattern.stopNodeIds[0],
    )!;
    const model = deriveStopPlaceDetailsModel(scenario, node.stopPlaceId!)!;
    expect(model.stopPlace.name).toBe('Hotel Fontana');
    expect(model.services.map(({ publicCode }) => publicCode)).toEqual([
      'A',
      'B',
    ]);
    expect(model.services[0]).toMatchObject({
      routeId: route.routeId,
      publicCode: route.publicCode,
      name: route.name,
    });
    expect(
      model.services[0]!.patterns[0]!.stops.map(({ stopNodeId }) => stopNodeId),
    ).toEqual(pattern.stopNodeIds);
    const selected = model.services[0]!.patterns[0]!.stops.find(
      (occurrence) => occurrence.selected,
    )!;
    expect(selected.services.map(({ publicCode }) => publicCode)).toEqual([
      'A',
      'B',
    ]);
    expect(
      deriveStopPlaceDetailsModel(scenario, 'missing' as never),
    ).toBeUndefined();
  });

  it.each([
    ['cartagena-v1', 'cartagena-radial-legacy-all-v1'],
    ['malaga-v1', 'malaga-day-legacy-all-v1'],
  ])('does not truncate serving topology for %s', (city, scenarioId) => {
    const scenario = loadScenario(city, scenarioId);
    const place = scenario.stops.stopPlaces.find((candidate) =>
      scenario.routes.routes.some((route) =>
        route.patterns.some((pattern) =>
          pattern.stopNodeIds.some(
            (id) =>
              scenario.stops.stopNodes.find((node) => node.stopNodeId === id)
                ?.stopPlaceId === candidate.stopPlaceId,
          ),
        ),
      ),
    )!;
    const expected = scenario.routes.routes.filter((route) =>
      route.patterns.some((pattern) =>
        pattern.stopNodeIds.some(
          (id) =>
            scenario.stops.stopNodes.find((node) => node.stopNodeId === id)
              ?.stopPlaceId === place.stopPlaceId,
        ),
      ),
    );
    const model = deriveStopPlaceDetailsModel(scenario, place.stopPlaceId)!;
    expect(model.services.map(({ routeId }) => routeId)).toEqual(
      expected.map(({ routeId }) => routeId),
    );
    expect(model.services.every(({ patterns }) => patterns.length > 0)).toBe(
      true,
    );
  });
});
