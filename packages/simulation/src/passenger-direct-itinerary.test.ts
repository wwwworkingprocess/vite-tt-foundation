import { describe, expect, it } from 'vitest';
import {
  parseScenarioPackage,
  type CanonicalScenario,
} from '@torrevieja-tycoon/transport-domain';
import { parsePassengerDemandPlan } from './passenger-demand.js';
import {
  buildPassengerDirectItineraryPlan,
  findPassengerDirectItinerary,
  validatePassengerDirectItineraryPlan,
} from './passenger-direct-itinerary.js';

const stopPlaceIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'U'] as const;

function scenario(): CanonicalScenario {
  const nodes = [
    ['a-out', 'A'],
    ['a-in', 'A'],
    ['a-repeat', 'A'],
    ['b-out', 'B'],
    ['b-in', 'B'],
    ['c-out', 'C'],
    ['c-in', 'C'],
    ['d-out', 'D'],
    ['d-in', 'D'],
    ['e', 'E'],
    ['f', 'F'],
    ['g', 'G'],
    ['h', 'H'],
    ['u', 'U'],
  ] as const;
  return parseScenarioPackage({
    manifest: {
      schemaVersion: '1.0.0',
      scenarioId: 'itinerary-fixture',
      scenarioVersion: '1.0.0',
      status: 'test-fixture',
      title: 'Itinerary fixture',
      primarySettlementId: 'fixture-city',
      settlementIds: ['fixture-city'],
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
      scenarioId: 'itinerary-fixture',
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
      scenarioId: 'itinerary-fixture',
      stopPlaces: stopPlaceIds.map((stopPlaceId, index) => ({
        stopPlaceId,
        settlementId: 'fixture-city',
        name: stopPlaceId,
        position: { latitude: 38 + index / 1000, longitude: -0.7 },
      })),
      stopNodes: nodes.map(([stopNodeId, stopPlaceId], index) => ({
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
      scenarioId: 'itinerary-fixture',
      routes: [
        {
          routeId: 'route-main',
          publicCode: 'M',
          name: 'Main',
          dataStatus: 'fixture',
          patterns: [
            {
              patternId: 'main-out',
              directionLabel: 'Outbound',
              closesLoop: false,
              stopNodeIds: ['a-out', 'b-out', 'c-out', 'd-out'],
            },
            {
              patternId: 'main-in',
              directionLabel: 'Inbound',
              closesLoop: false,
              stopNodeIds: ['d-in', 'c-in', 'b-in', 'a-in'],
            },
          ],
        },
        {
          routeId: 'route-loop',
          publicCode: 'L',
          name: 'Loop',
          dataStatus: 'fixture',
          patterns: [
            {
              patternId: 'loop',
              directionLabel: 'Loop',
              closesLoop: true,
              stopNodeIds: ['e', 'f', 'g', 'h'],
            },
          ],
        },
        {
          routeId: 'route-repeat',
          publicCode: 'R',
          name: 'Repeated',
          dataStatus: 'fixture',
          patterns: [
            {
              patternId: 'repeat',
              directionLabel: 'Repeated',
              closesLoop: false,
              stopNodeIds: ['a-out', 'b-out', 'a-repeat', 'c-out'],
            },
          ],
        },
        {
          routeId: 'route-handoff',
          publicCode: 'H',
          name: 'Pattern handoff',
          dataStatus: 'fixture',
          patterns: [
            {
              patternId: 'handoff-first',
              directionLabel: 'First',
              closesLoop: false,
              stopNodeIds: ['u', 'a-out'],
            },
            {
              patternId: 'handoff-second',
              directionLabel: 'Second',
              closesLoop: false,
              stopNodeIds: ['e', 'f'],
            },
          ],
        },
      ],
    },
  });
}

function demandPlan(
  canonical = scenario(),
  includedStopPlaceIds: readonly string[] = stopPlaceIds,
) {
  const firstStopPlaceId = includedStopPlaceIds[0] ?? null;
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'b'.repeat(64),
    scenario: {
      scenarioSchemaVersion: canonical.manifest.schemaVersion,
      scenarioId: canonical.manifest.scenarioId,
      scenarioVersion: canonical.manifest.scenarioVersion,
      contentHash: canonical.manifest.contentHash,
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
        assignedStopPlaceId: firstStopPlaceId,
        distanceSquaredCells: firstStopPlaceId === null ? null : 0,
      },
    ],
    stops: includedStopPlaceIds.map((stopPlaceId) => ({ stopPlaceId })),
  });
}

function planForScenario(canonical: CanonicalScenario) {
  const ids = canonical.stops.stopPlaces
    .map(({ stopPlaceId }) => stopPlaceId)
    .sort();
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'd'.repeat(64),
    scenario: {
      scenarioSchemaVersion: canonical.manifest.schemaVersion,
      scenarioId: canonical.manifest.scenarioId,
      scenarioVersion: canonical.manifest.scenarioVersion,
      contentHash: canonical.manifest.contentHash,
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
        assignedStopPlaceId: ids[0] ?? null,
        distanceSquaredCells: ids.length > 0 ? 0 : null,
      },
    ],
    stops: ids.map((stopPlaceId) => ({ stopPlaceId })),
  });
}

function loadScenario(root: string) {
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
}

const mutable = (value: unknown) =>
  structuredClone(value) as {
    scenario: { scenarioId: string };
    demandPlan: { demandModelContentHash: string };
    routingPolicy: { version: string };
    pairCount: number;
    directPairCount: number;
    unavailablePairCount: number;
    stopPlaceIds?: string[];
    entries: Array<Record<string, unknown>>;
    extra?: boolean;
  };

describe('Passenger Direct Itinerary Plan V1', () => {
  it('builds every ordered physical StopPlace pair with exact identities', () => {
    const canonical = scenario();
    const plan = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demandPlan(canonical),
    });
    expect(plan).toMatchObject({
      schemaVersion: '1.0.0',
      routingPolicy: { kind: 'single-pattern-direct', version: '1.0.0' },
      scenario: {
        scenarioId: 'itinerary-fixture',
        contentHash: 'a'.repeat(64),
      },
      demandPlan: {
        schemaVersion: '1.0.0',
        demandModelContentHash: 'b'.repeat(64),
        cityId: 'Q36730',
        populationGridSchemaVersion: '1.0.0',
        gridVersion: '1.0.0',
      },
      pairCount: 72,
    });
    expect(plan.stopPlaceIds).toEqual(stopPlaceIds);
    expect(plan.entries).toHaveLength(9 * 8);
    expect(
      new Set(
        plan.entries.map(
          (entry) =>
            `${entry.originStopPlaceId}->${entry.destinationStopPlaceId}`,
        ),
      ).size,
    ).toBe(plan.pairCount);
    expect(
      plan.entries.some(
        (entry) => entry.originStopPlaceId === entry.destinationStopPlaceId,
      ),
    ).toBe(false);
    expect(plan.directPairCount + plan.unavailablePairCount).toBe(
      plan.pairCount,
    );
  });

  it('rejects a concealed omitted StopPlace in the standalone finder', () => {
    const canonical = scenario();
    const complete = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demandPlan(canonical, ['A', 'B', 'C']),
    });
    const concealed = mutable(complete);
    concealed.entries = concealed.entries.filter(
      (entry) =>
        entry.originStopPlaceId !== 'C' && entry.destinationStopPlaceId !== 'C',
    );
    concealed.pairCount = concealed.entries.length;
    concealed.directPairCount = concealed.entries.filter(
      (entry) => entry.status === 'direct',
    ).length;
    concealed.unavailablePairCount =
      concealed.pairCount - concealed.directPairCount;

    expect(() =>
      findPassengerDirectItinerary(concealed as never, 'A', 'B'),
    ).toThrow(/pair|complete/i);
  });

  it('supports normative zero- and one-StopPlace domains', () => {
    const canonical = scenario();
    const empty = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demandPlan(canonical, []),
    });
    const singleton = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demandPlan(canonical, ['A']),
    });

    expect(empty).toMatchObject({
      stopPlaceIds: [],
      pairCount: 0,
      entries: [],
    });
    expect(singleton).toMatchObject({
      stopPlaceIds: ['A'],
      pairCount: 0,
      entries: [],
    });
    expect(() =>
      findPassengerDirectItinerary(singleton, 'A', 'missing'),
    ).toThrow(/unknown/i);
  });

  it.each([
    [
      'a missing normative StopPlace',
      (plan: ReturnType<typeof mutable>) => {
        plan.stopPlaceIds = plan.stopPlaceIds!.filter((id) => id !== 'C');
      },
    ],
    [
      'an extra normative StopPlace without its pair matrix',
      (plan: ReturnType<typeof mutable>) => {
        plan.stopPlaceIds!.push('Z');
      },
    ],
    [
      'duplicate normative StopPlace IDs',
      (plan: ReturnType<typeof mutable>) => {
        plan.stopPlaceIds!.splice(1, 0, plan.stopPlaceIds![0]!);
      },
    ],
    [
      'non-lexical normative StopPlace IDs',
      (plan: ReturnType<typeof mutable>) => {
        plan.stopPlaceIds!.reverse();
      },
    ],
    [
      'an entry endpoint outside the normative StopPlace domain',
      (plan: ReturnType<typeof mutable>) => {
        plan.entries[0]!.destinationStopPlaceId = 'Z';
      },
    ],
  ])('rejects %s in standalone lookup', (_name, mutatePlan) => {
    const canonical = scenario();
    const malformed = mutable(
      buildPassengerDirectItineraryPlan({
        scenario: canonical,
        demandPlan: demandPlan(canonical, ['A', 'B', 'C']),
      }),
    );
    malformed.stopPlaceIds = ['A', 'B', 'C'];
    mutatePlan(malformed);
    expect(() =>
      findPassengerDirectItinerary(malformed as never, 'A', 'B'),
    ).toThrow();
  });

  it('preserves and freezes the exact StopPlace identity across cloning', () => {
    const canonical = scenario();
    const original = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demandPlan(canonical),
    });
    const cloned = structuredClone(original);
    const validated = validatePassengerDirectItineraryPlan({
      plan: cloned,
      scenario: canonical,
      demandPlan: demandPlan(canonical),
    });

    expect(validated.stopPlaceIds).toEqual(stopPlaceIds);
    expect(Object.isFrozen(validated.stopPlaceIds)).toBe(true);
    expect(Reflect.set(validated.stopPlaceIds, '0', 'changed')).toBe(false);
  });

  it('resolves directional non-loop StopNodes and inclusive forward segments', () => {
    const plan = buildPassengerDirectItineraryPlan({
      scenario: scenario(),
      demandPlan: demandPlan(),
    });
    expect(findPassengerDirectItinerary(plan, 'A', 'D')).toEqual(
      expect.objectContaining({
        status: 'direct',
        routeId: 'route-main',
        patternId: 'main-out',
        originStopNodeId: 'a-out',
        destinationStopNodeId: 'd-out',
        originOccurrenceIndex: 0,
        destinationOccurrenceIndex: 3,
        wrapsPatternEnd: false,
        edgeCount: 3,
        stopNodeIds: ['a-out', 'b-out', 'c-out', 'd-out'],
      }),
    );
    expect(findPassengerDirectItinerary(plan, 'D', 'A')).toEqual(
      expect.objectContaining({
        status: 'direct',
        patternId: 'main-in',
        originStopNodeId: 'd-in',
        destinationStopNodeId: 'a-in',
        wrapsPatternEnd: false,
      }),
    );
    expect(findPassengerDirectItinerary(plan, 'C', 'D')).toMatchObject({
      status: 'direct',
      patternId: 'main-out',
      edgeCount: 1,
    });
  });

  it('wraps only a canonical closed loop and preserves its node order', () => {
    const plan = buildPassengerDirectItineraryPlan({
      scenario: scenario(),
      demandPlan: demandPlan(),
    });
    expect(findPassengerDirectItinerary(plan, 'E', 'G')).toMatchObject({
      status: 'direct',
      patternId: 'loop',
      wrapsPatternEnd: false,
      edgeCount: 2,
      stopNodeIds: ['e', 'f', 'g'],
    });
    expect(findPassengerDirectItinerary(plan, 'H', 'F')).toMatchObject({
      status: 'direct',
      patternId: 'loop',
      wrapsPatternEnd: true,
      edgeCount: 2,
      stopNodeIds: ['h', 'e', 'f'],
    });
  });

  it('uses occurrence indices and the shortest canonical candidate', () => {
    const entry = findPassengerDirectItinerary(
      buildPassengerDirectItineraryPlan({
        scenario: scenario(),
        demandPlan: demandPlan(),
      }),
      'A',
      'C',
    );
    expect(entry).toMatchObject({
      status: 'direct',
      routeId: 'route-repeat',
      patternId: 'repeat',
      originStopNodeId: 'a-repeat',
      originOccurrenceIndex: 2,
      destinationOccurrenceIndex: 3,
      edgeCount: 1,
      stopNodeIds: ['a-repeat', 'c-out'],
    });
  });

  it('uses lexical RouteId and patternId after equal edge counts', () => {
    const raw = structuredClone(scenario());
    raw.routes.routes.push({
      routeId: 'route-a',
      publicCode: 'A',
      name: 'Tie breaker',
      dataStatus: 'fixture',
      patterns: [
        {
          patternId: 'pattern-z',
          directionLabel: 'Z',
          closesLoop: false,
          stopNodeIds: ['b-out', 'c-out', 'd-out'],
        },
        {
          patternId: 'pattern-a',
          directionLabel: 'A',
          closesLoop: false,
          stopNodeIds: ['b-out', 'c-out', 'd-out'],
        },
      ],
    });
    const canonical = parseScenarioPackage(raw);
    expect(
      findPassengerDirectItinerary(
        buildPassengerDirectItineraryPlan({
          scenario: canonical,
          demandPlan: demandPlan(canonical),
        }),
        'B',
        'D',
      ),
    ).toMatchObject({
      status: 'direct',
      routeId: 'route-a',
      patternId: 'pattern-a',
      edgeCount: 2,
    });
  });

  it('keeps disconnected and cross-pattern journeys explicitly unavailable', () => {
    const plan = buildPassengerDirectItineraryPlan({
      scenario: scenario(),
      demandPlan: demandPlan(),
    });
    expect(findPassengerDirectItinerary(plan, 'A', 'U')).toEqual({
      status: 'unavailable',
      originStopPlaceId: 'A',
      destinationStopPlaceId: 'U',
      reason: 'no-direct-pattern',
    });
    expect(findPassengerDirectItinerary(plan, 'A', 'E')).toMatchObject({
      status: 'unavailable',
      reason: 'no-direct-pattern',
    });
    expect(findPassengerDirectItinerary(plan, 'A', 'U')).toMatchObject({
      status: 'unavailable',
      reason: 'no-direct-pattern',
    });
    expect(findPassengerDirectItinerary(plan, 'U', 'E')).toMatchObject({
      status: 'unavailable',
      reason: 'no-direct-pattern',
    });
  });

  it('is source-order independent without reordering pattern nodes', () => {
    const canonical = scenario();
    const expected = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demandPlan(canonical),
    });
    const raw = structuredClone(canonical);
    raw.routes.routes.reverse();
    for (const route of raw.routes.routes) route.patterns.reverse();
    raw.stops.stopNodes.reverse();
    raw.stops.stopPlaces.reverse();
    const reversed = parseScenarioPackage(raw);
    expect(
      buildPassengerDirectItineraryPlan({
        scenario: reversed,
        demandPlan: demandPlan(reversed),
      }),
    ).toEqual(expected);
  });

  it('validates cloned plans semantically and deeply freezes the result', () => {
    const canonical = scenario();
    const plan = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demandPlan(canonical),
    });
    const validated = validatePassengerDirectItineraryPlan({
      plan: structuredClone(plan),
      scenario: canonical,
      demandPlan: demandPlan(canonical),
    });
    expect(validated).toEqual(plan);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.entries)).toBe(true);
    expect(Object.isFrozen(validated.entries[0])).toBe(true);
    expect(
      Reflect.set(validated.entries[0]!, 'originStopPlaceId', 'changed'),
    ).toBe(false);
    expect(
      buildPassengerDirectItineraryPlan({
        scenario: canonical,
        demandPlan: demandPlan(canonical),
      }),
    ).toEqual(plan);
  });

  it.each([
    [
      'scenario identity',
      (plan: ReturnType<typeof mutable>) => {
        plan.scenario.scenarioId = 'wrong';
      },
    ],
    [
      'demand identity',
      (plan: ReturnType<typeof mutable>) => {
        plan.demandPlan.demandModelContentHash = 'c'.repeat(64);
      },
    ],
    [
      'routing policy',
      (plan: ReturnType<typeof mutable>) => {
        plan.routingPolicy.version = '2.0.0';
      },
    ],
    [
      'aggregate count',
      (plan: ReturnType<typeof mutable>) => {
        plan.directPairCount -= 1;
      },
    ],
    [
      'unknown field',
      (plan: ReturnType<typeof mutable>) => {
        plan.extra = true;
      },
    ],
    [
      'missing pair',
      (plan: ReturnType<typeof mutable>) => {
        plan.entries.pop();
        plan.pairCount -= 1;
      },
    ],
    [
      'duplicate pair',
      (plan: ReturnType<typeof mutable>) => {
        plan.entries[1] = structuredClone(plan.entries[0]!);
      },
    ],
    [
      'same-origin pair',
      (plan: ReturnType<typeof mutable>) => {
        plan.entries[0]!.destinationStopPlaceId =
          plan.entries[0]!.originStopPlaceId;
      },
    ],
    [
      'extra pair',
      (plan: ReturnType<typeof mutable>) => {
        plan.entries.push({
          status: 'unavailable',
          originStopPlaceId: 'A',
          destinationStopPlaceId: 'extra',
          reason: 'no-direct-pattern',
        });
        plan.pairCount += 1;
        plan.unavailablePairCount += 1;
      },
    ],
    [
      'noncanonical order',
      (plan: ReturnType<typeof mutable>) => {
        plan.entries.reverse();
      },
    ],
    [
      'wrong route',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.routeId = 'wrong';
      },
    ],
    [
      'wrong pattern',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.patternId = 'wrong';
      },
    ],
    [
      'wrong occurrence',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.originOccurrenceIndex = 99;
      },
    ],
    [
      'wrong wrap',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.wrapsPatternEnd = !direct.wrapsPatternEnd;
      },
    ],
    [
      'wrong edge count',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.edgeCount = 99;
      },
    ],
    [
      'invented segment',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.stopNodeIds = ['invented', 'also-invented'];
      },
    ],
    [
      'unknown origin node',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.originStopNodeId = 'missing';
      },
    ],
    [
      'unknown destination node',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.destinationStopNodeId = 'missing';
      },
    ],
    [
      'wrong StopNode mapping',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        direct.originStopNodeId = 'b-out';
      },
    ],
    [
      'missing segment node',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        (direct.stopNodeIds as unknown[]).pop();
      },
    ],
    [
      'extra segment node',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        (direct.stopNodeIds as unknown[]).push('a-out');
      },
    ],
    [
      'reversed segment',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find((entry) => entry.status === 'direct')!;
        (direct.stopNodeIds as unknown[]).reverse();
      },
    ],
    [
      'non-ranked valid candidate',
      (plan: ReturnType<typeof mutable>) => {
        const direct = plan.entries.find(
          (entry) =>
            entry.status === 'direct' &&
            entry.originStopPlaceId === 'A' &&
            entry.destinationStopPlaceId === 'C',
        )!;
        Object.assign(direct, {
          routeId: 'route-main',
          patternId: 'main-out',
          originStopNodeId: 'a-out',
          destinationStopNodeId: 'c-out',
          originOccurrenceIndex: 0,
          destinationOccurrenceIndex: 2,
          wrapsPatternEnd: false,
          edgeCount: 2,
          stopNodeIds: ['a-out', 'b-out', 'c-out'],
        });
      },
    ],
    [
      'wrong classification',
      (plan: ReturnType<typeof mutable>) => {
        const directIndex = plan.entries.findIndex(
          (entry) => entry.status === 'direct',
        );
        const direct = plan.entries[directIndex]!;
        plan.entries[directIndex] = {
          status: 'unavailable',
          originStopPlaceId: direct.originStopPlaceId,
          destinationStopPlaceId: direct.destinationStopPlaceId,
          reason: 'no-direct-pattern',
        };
      },
    ],
    [
      'invented direct classification',
      (plan: ReturnType<typeof mutable>) => {
        const unavailableIndex = plan.entries.findIndex(
          (entry) => entry.status === 'unavailable',
        );
        const unavailable = plan.entries[unavailableIndex]!;
        plan.entries[unavailableIndex] = {
          status: 'direct',
          originStopPlaceId: unavailable.originStopPlaceId,
          destinationStopPlaceId: unavailable.destinationStopPlaceId,
          routeId: 'route-main',
          patternId: 'main-out',
          originStopNodeId: 'a-out',
          destinationStopNodeId: 'b-out',
          originOccurrenceIndex: 0,
          destinationOccurrenceIndex: 1,
          wrapsPatternEnd: false,
          edgeCount: 1,
          stopNodeIds: ['a-out', 'b-out'],
        };
      },
    ],
  ])('rejects %s mutations', (_name, mutate) => {
    const canonical = scenario();
    const plan = mutable(
      buildPassengerDirectItineraryPlan({
        scenario: canonical,
        demandPlan: demandPlan(canonical),
      }),
    );
    mutate(plan);
    expect(() =>
      validatePassengerDirectItineraryPlan({
        plan,
        scenario: canonical,
        demandPlan: demandPlan(canonical),
      }),
    ).toThrow();
  });

  it('rejects mismatched inputs and invalid finder pairs', () => {
    const canonical = scenario();
    const demand = demandPlan(canonical);
    const plan = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demand,
    });
    const wrongDemand = mutable(demand);
    wrongDemand.scenario.scenarioId = 'wrong';
    expect(() =>
      buildPassengerDirectItineraryPlan({
        scenario: canonical,
        demandPlan: wrongDemand as never,
      }),
    ).toThrow();
    expect(() => findPassengerDirectItinerary(plan, 'A', 'A')).toThrow();
    expect(() => findPassengerDirectItinerary(plan, 'missing', 'A')).toThrow();
    expect(() => findPassengerDirectItinerary(plan, 'A', 'missing')).toThrow();
    const incomplete = structuredClone(plan);
    const target = incomplete.entries.findIndex(
      (entry) =>
        entry.originStopPlaceId === 'A' && entry.destinationStopPlaceId === 'B',
    );
    incomplete.entries.splice(target, 1);
    expect(() => findPassengerDirectItinerary(incomplete, 'A', 'B')).toThrow(
      /pair counts/i,
    );
    const unrelatedMissing = structuredClone(plan);
    unrelatedMissing.entries.pop();
    expect(() =>
      findPassengerDirectItinerary(unrelatedMissing, 'A', 'B'),
    ).toThrow(/pair counts/i);
  });

  it('rejects a demand-plan StopPlace absent from the canonical scenario', () => {
    const canonical = scenario();
    const raw = structuredClone(demandPlan(canonical));
    raw.stops.push({ stopPlaceId: 'missing' as never });
    expect(() =>
      buildPassengerDirectItineraryPlan({
        scenario: canonical,
        demandPlan: parsePassengerDemandPlan(raw),
      }),
    ).toThrow(/Unknown itinerary StopPlace/);
  });

  it.each([
    [
      'Torrevieja Mini',
      join(
        import.meta.dirname,
        '..',
        '..',
        'transport-domain',
        'fixtures',
        'torrevieja-mini-v1',
      ),
    ],
    [
      'multi-route Torrevieja',
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'apps',
        'web',
        'public',
        'scenarios',
        'torrevieja-legacy-abc-v1',
      ),
    ],
  ])('builds and validates deterministic %s direct segments', (_name, root) => {
    const canonical = loadScenario(root);
    const demand = planForScenario(canonical);
    const first = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: demand,
    });
    const second = buildPassengerDirectItineraryPlan({
      scenario: canonical,
      demandPlan: structuredClone(demand),
    });
    if (_name === 'multi-route Torrevieja') {
      expect(first.stopPlaceIds.length).toBeGreaterThan(0);
      expect(first.pairCount).toBeGreaterThan(0);
    }
    expect(second).toEqual(first);
    expect(
      validatePassengerDirectItineraryPlan({
        plan: structuredClone(first),
        scenario: canonical,
        demandPlan: demand,
      }),
    ).toEqual(first);
    const patterns = new Map(
      canonical.routes.routes.flatMap((route) =>
        route.patterns.map((pattern) => [pattern.patternId, pattern]),
      ),
    );
    for (const entry of first.entries) {
      if (entry.status !== 'direct') continue;
      const pattern = patterns.get(entry.patternId)!;
      expect(entry.stopNodeIds[0]).toBe(entry.originStopNodeId);
      expect(entry.stopNodeIds.at(-1)).toBe(entry.destinationStopNodeId);
      for (let index = 0; index < entry.edgeCount; index += 1) {
        const occurrence =
          (entry.originOccurrenceIndex + index) % pattern.stopNodeIds.length;
        expect(entry.stopNodeIds[index]).toBe(pattern.stopNodeIds[occurrence]);
        expect(entry.stopNodeIds[index + 1]).toBe(
          pattern.stopNodeIds[(occurrence + 1) % pattern.stopNodeIds.length],
        );
      }
    }
  });
});
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
