import { describe, expect, it } from 'vitest';
import {
  buildPassengerDirectItineraryAuthority,
  buildPassengerDirectItineraryPlan,
  createPassengerDirectItineraryRuntimeIndex,
  findPassengerDirectItinerary,
  passengerDirectItineraryPlanSchemaVersion,
  validatePassengerDirectItineraryPlan,
} from './passenger-direct-itinerary.js';
import {
  itineraryScenario,
  itineraryDemandPlan,
} from './passenger-direct-itinerary.test.fixture.js';

describe('Passenger Direct Itinerary Plan V2', () => {
  it('retains only canonical direct pairs and represents unavailability implicitly', () => {
    const scenario = itineraryScenario();
    const demandPlan = itineraryDemandPlan(scenario);
    const plan = buildPassengerDirectItineraryPlan({ scenario, demandPlan });

    expect(passengerDirectItineraryPlanSchemaVersion).toBe('2.0.0');
    expect(plan.schemaVersion).toBe('2.0.0');
    expect(plan.directEntries).toHaveLength(plan.directPairCount);
    expect(plan.directEntries.length).toBeLessThan(plan.pairCount);
    expect(plan.directEntries.every((entry) => !('stopNodeIds' in entry))).toBe(
      true,
    );
    expect(plan.unavailablePairCount).toBe(
      plan.pairCount - plan.directPairCount,
    );
  });

  it('builds trusted plan and sparse runtime authority in one public operation', () => {
    const scenario = itineraryScenario();
    const demandPlan = itineraryDemandPlan(scenario);
    const authority = buildPassengerDirectItineraryAuthority({
      scenario,
      demandPlan,
    });

    expect(authority.plan).toEqual(
      buildPassengerDirectItineraryPlan({ scenario, demandPlan }),
    );
    expect(authority.index.find('A', 'B')).toEqual(
      authority.plan.directEntries.find(
        (entry) =>
          entry.originStopPlaceId === 'A' &&
          entry.destinationStopPlaceId === 'B',
      ),
    );
    expect(authority.index.find('A', 'U')).toBeUndefined();
    expect(Object.isFrozen(authority.plan)).toBe(true);
  });

  it('strictly rejects obsolete V1 dense authority', () => {
    const scenario = itineraryScenario();
    const demandPlan = itineraryDemandPlan(scenario);
    const v1 = {
      schemaVersion: '1.0.0',
      routingPolicy: { kind: 'single-pattern-direct', version: '1.0.0' },
      scenario: {},
      demandPlan: {},
      stopPlaceIds: [],
      pairCount: 0,
      directPairCount: 0,
      unavailablePairCount: 0,
      entries: [],
    };

    expect(() =>
      createPassengerDirectItineraryRuntimeIndex({
        plan: v1,
        scenario,
        demandPlan,
      }),
    ).toThrow();
  });

  it('validates sparse ordering, identities, counts and canonical fields strictly', () => {
    const scenario = itineraryScenario();
    const demandPlan = itineraryDemandPlan(scenario);
    const plan = buildPassengerDirectItineraryPlan({ scenario, demandPlan });
    const corrupt = (change: (value: Record<string, unknown>) => void) => {
      const value = structuredClone(plan) as unknown as Record<string, unknown>;
      change(value);
      expect(() =>
        validatePassengerDirectItineraryPlan({
          plan: value,
          scenario,
          demandPlan,
        }),
      ).toThrow();
    };

    corrupt((value) => {
      value.stopPlaceIds = ['B', 'A', 'U'];
    });
    corrupt((value) => {
      const entries = value.directEntries as Array<Record<string, unknown>>;
      entries[0]!.originStopPlaceId = 'missing';
    });
    corrupt((value) => {
      const entries = value.directEntries as Array<Record<string, unknown>>;
      entries[0]!.destinationStopPlaceId = entries[0]!.originStopPlaceId;
    });
    corrupt((value) => {
      const entries = value.directEntries as Array<Record<string, unknown>>;
      entries.push(structuredClone(entries[0]!));
      value.directPairCount = 2;
      value.unavailablePairCount = 4;
    });
    corrupt((value) => {
      value.pairCount = 5;
    });
    corrupt((value) => {
      const entries = value.directEntries as Array<Record<string, unknown>>;
      entries[0]!.edgeCount = 2;
    });
  });

  it('rejects scenario/demand mismatches and unknown demand StopPlaces', () => {
    const scenario = itineraryScenario();
    const mismatched = structuredClone(itineraryDemandPlan(scenario));
    (mismatched.scenario as { scenarioId: string }).scenarioId = 'other';
    expect(() =>
      buildPassengerDirectItineraryPlan({ scenario, demandPlan: mismatched }),
    ).toThrow(/do not match/i);

    const unknown = structuredClone(itineraryDemandPlan(scenario));
    (unknown.stops as Array<{ stopPlaceId: string }>).push({
      stopPlaceId: 'X',
    });
    expect(() =>
      buildPassengerDirectItineraryPlan({ scenario, demandPlan: unknown }),
    ).toThrow(/unknown itinerary StopPlace X/i);
  });

  it('supports empty authority, standalone lookup validation and loop wrapping', () => {
    const scenario = itineraryScenario();
    const emptyDemand = structuredClone(itineraryDemandPlan(scenario));
    (emptyDemand.stops as unknown[]).length = 0;
    emptyDemand.cells[0] = {
      ...emptyDemand.cells[0]!,
      assignedStopPlaceId: null,
      distanceSquaredCells: null,
    };
    const empty = buildPassengerDirectItineraryPlan({
      scenario,
      demandPlan: emptyDemand,
    });
    expect(empty).toMatchObject({ pairCount: 0, directEntries: [] });

    const demandPlan = itineraryDemandPlan(scenario);
    const plan = buildPassengerDirectItineraryPlan({ scenario, demandPlan });
    expect(findPassengerDirectItinerary(plan, 'A', 'B')).toMatchObject({
      edgeCount: 1,
    });
    expect(findPassengerDirectItinerary(plan, 'A', 'U')).toBeUndefined();
    expect(() => findPassengerDirectItinerary(plan, 'A', 'A')).toThrow(
      /distinct/i,
    );
    expect(() => findPassengerDirectItinerary(plan, 'missing', 'A')).toThrow(
      /unknown/i,
    );

    const loop = structuredClone(scenario);
    const pattern = loop.routes.routes[0]!.patterns[0]! as {
      closesLoop: boolean;
      stopNodeIds: string[];
    };
    pattern.closesLoop = true;
    pattern.stopNodeIds = ['a', 'b', 'u'];
    const loopPlan = buildPassengerDirectItineraryPlan({
      scenario: loop,
      demandPlan: itineraryDemandPlan(loop),
    });
    expect(findPassengerDirectItinerary(loopPlan, 'U', 'B')).toMatchObject({
      wrapsPatternEnd: true,
      edgeCount: 2,
    });
    const unorderedLoop = structuredClone(loopPlan);
    (unorderedLoop.directEntries as unknown as unknown[]).reverse();
    expect(() =>
      validatePassengerDirectItineraryPlan({
        plan: unorderedLoop,
        scenario: loop,
        demandPlan: itineraryDemandPlan(loop),
      }),
    ).toThrow(/ordered/i);
  });
});
