import { z } from 'zod';
import type {
  CanonicalScenario,
  RouteId,
  RoutePatternId,
  StopNodeId,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import {
  parsePassengerDemandPlan,
  type PassengerDemandModelHash,
  type PassengerDemandPlanV1,
} from './passenger-demand.js';
import { checkedMultiply, deepFreeze, lexical } from './authority-utils.js';

export const passengerDirectItineraryPlanSchemaVersion = '2.0.0' as const;
export const passengerDirectItineraryRoutingPolicy = Object.freeze({
  kind: 'single-pattern-direct',
  version: '1.0.0',
} as const);
const count = z.number().int().nonnegative().safe();
const id = z.string().trim().min(1);
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const scenarioSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: id,
  scenarioVersion: version,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const demandSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  demandModelContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  cityId: z.string().regex(/^Q[1-9]\d*$/),
  populationGridSchemaVersion: z.literal('1.0.0'),
  gridVersion: version,
});
const directSchema = z.strictObject({
  status: z.literal('direct'),
  originStopPlaceId: id,
  destinationStopPlaceId: id,
  routeId: id,
  patternId: id,
  originStopNodeId: id,
  destinationStopNodeId: id,
  originOccurrenceIndex: count,
  destinationOccurrenceIndex: count,
  wrapsPatternEnd: z.boolean(),
  edgeCount: z.number().int().positive().safe(),
});
const planSchema = z.strictObject({
  schemaVersion: z.literal('2.0.0'),
  routingPolicy: z.strictObject({
    kind: z.literal('single-pattern-direct'),
    version: z.literal('1.0.0'),
  }),
  scenario: scenarioSchema,
  demandPlan: demandSchema,
  stopPlaceIds: z.array(id),
  pairCount: count,
  directPairCount: count,
  unavailablePairCount: count,
  directEntries: z.array(directSchema),
});

export interface PassengerDirectItineraryPlanScenario {
  readonly scenarioSchemaVersion: '1.0.0';
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly contentHash: string;
}
export interface PassengerDirectItineraryPlanDemand {
  readonly schemaVersion: '1.0.0';
  readonly demandModelContentHash: PassengerDemandModelHash;
  readonly cityId: string;
  readonly populationGridSchemaVersion: '1.0.0';
  readonly gridVersion: string;
}
export interface PassengerDirectItinerary {
  readonly status: 'direct';
  readonly originStopPlaceId: StopPlaceId;
  readonly destinationStopPlaceId: StopPlaceId;
  readonly routeId: RouteId;
  readonly patternId: RoutePatternId;
  readonly originStopNodeId: StopNodeId;
  readonly destinationStopNodeId: StopNodeId;
  readonly originOccurrenceIndex: number;
  readonly destinationOccurrenceIndex: number;
  readonly wrapsPatternEnd: boolean;
  readonly edgeCount: number;
}
export interface PassengerDirectItineraryPlanV2 {
  readonly schemaVersion: typeof passengerDirectItineraryPlanSchemaVersion;
  readonly routingPolicy: Readonly<
    typeof passengerDirectItineraryRoutingPolicy
  >;
  readonly scenario: Readonly<PassengerDirectItineraryPlanScenario>;
  readonly demandPlan: Readonly<PassengerDirectItineraryPlanDemand>;
  readonly stopPlaceIds: readonly StopPlaceId[];
  readonly pairCount: number;
  readonly directPairCount: number;
  readonly unavailablePairCount: number;
  readonly directEntries: readonly Readonly<PassengerDirectItinerary>[];
}
export interface PassengerDirectItineraryRuntimeIndex {
  readonly plan: PassengerDirectItineraryPlanV2;
  readonly find: (
    origin: string,
    destination: string,
  ) => Readonly<PassengerDirectItinerary> | undefined;
}
export interface PassengerDirectItineraryAuthority {
  readonly plan: PassengerDirectItineraryPlanV2;
  readonly index: PassengerDirectItineraryRuntimeIndex;
}

const pairKey = (origin: string, destination: string) =>
  `${origin.length}:${origin}${destination}`;
const pairCount = (size: number) =>
  checkedMultiply(
    size,
    size === 0 ? 0 : size - 1,
    'Itinerary StopPlace pair count',
  );
const scenarioIdentity = (
  scenario: CanonicalScenario,
): PassengerDirectItineraryPlanScenario => ({
  scenarioSchemaVersion: scenario.manifest.schemaVersion,
  scenarioId: scenario.manifest.scenarioId,
  scenarioVersion: scenario.manifest.scenarioVersion,
  contentHash: scenario.manifest.contentHash,
});
const demandIdentity = (
  plan: PassengerDemandPlanV1,
): PassengerDirectItineraryPlanDemand => ({
  schemaVersion: plan.schemaVersion,
  demandModelContentHash: plan.demandModelContentHash,
  cityId: plan.grid.cityId,
  populationGridSchemaVersion: plan.grid.populationGridSchemaVersion,
  gridVersion: plan.grid.gridVersion,
});
const sameScenario = (
  a: PassengerDirectItineraryPlanScenario,
  b: PassengerDirectItineraryPlanScenario,
) =>
  a.scenarioSchemaVersion === b.scenarioSchemaVersion &&
  a.scenarioId === b.scenarioId &&
  a.scenarioVersion === b.scenarioVersion &&
  a.contentHash === b.contentHash;
const candidateOrder = (
  a: PassengerDirectItinerary,
  b: PassengerDirectItinerary,
) => {
  const comparisons = [
    a.edgeCount - b.edgeCount,
    lexical(a.routeId, b.routeId),
    lexical(a.patternId, b.patternId),
    a.originOccurrenceIndex - b.originOccurrenceIndex,
    a.destinationOccurrenceIndex - b.destinationOccurrenceIndex,
    lexical(a.originStopNodeId, b.originStopNodeId),
    lexical(a.destinationStopNodeId, b.destinationStopNodeId),
  ];
  return comparisons.find((value) => value !== 0)!;
};
const entryOrder = (a: PassengerDirectItinerary, b: PassengerDirectItinerary) =>
  lexical(a.originStopPlaceId, b.originStopPlaceId) ||
  lexical(a.destinationStopPlaceId, b.destinationStopPlaceId);

function createRuntime(
  plan: PassengerDirectItineraryPlanV2,
): PassengerDirectItineraryRuntimeIndex {
  const stops = new Set<string>(plan.stopPlaceIds);
  const origins = new Map<
    string,
    Map<string, Readonly<PassengerDirectItinerary>>
  >();
  for (const entry of plan.directEntries) {
    let destinations = origins.get(entry.originStopPlaceId);
    if (!destinations) {
      destinations = new Map();
      origins.set(entry.originStopPlaceId, destinations);
    }
    destinations.set(entry.destinationStopPlaceId, entry);
  }
  return Object.freeze({
    plan,
    find(origin: string, destination: string) {
      if (origin === destination)
        throw new Error('Passenger itinerary requires distinct StopPlaces.');
      if (!stops.has(origin) || !stops.has(destination))
        throw new Error('Unknown passenger itinerary StopPlace.');
      return origins.get(origin)?.get(destination);
    },
  });
}

function buildAuthority(
  scenario: CanonicalScenario,
  demandPlan: PassengerDemandPlanV1,
): PassengerDirectItineraryAuthority {
  const coordinate = scenarioIdentity(scenario);
  if (!sameScenario(coordinate, demandPlan.scenario))
    throw new Error('Itinerary scenario and demand plan do not match.');
  const stopPlaceIds = demandPlan.stops
    .map(({ stopPlaceId }) => stopPlaceId)
    .sort(lexical);
  const eligible = new Set(stopPlaceIds);
  const canonical = new Set(
    scenario.stops.stopPlaces.map(({ stopPlaceId }) => stopPlaceId),
  );
  for (const stop of stopPlaceIds)
    if (!canonical.has(stop))
      throw new Error(`Unknown itinerary StopPlace ${stop}.`);
  const nodePlaces = new Map(
    scenario.stops.stopNodes
      .filter(
        (node): node is typeof node & { readonly stopPlaceId: StopPlaceId } =>
          node.stopPlaceId !== null,
      )
      .map((node) => [node.stopNodeId, node.stopPlaceId]),
  );
  const candidates = new Map<string, PassengerDirectItinerary>();
  for (const route of scenario.routes.routes)
    for (const pattern of route.patterns) {
      const length = pattern.stopNodeIds.length;
      for (
        let originOccurrenceIndex = 0;
        originOccurrenceIndex < length;
        originOccurrenceIndex += 1
      ) {
        const originStopNodeId = pattern.stopNodeIds[originOccurrenceIndex]!;
        const originStopPlaceId = nodePlaces.get(originStopNodeId);
        if (!originStopPlaceId || !eligible.has(originStopPlaceId)) continue;
        for (
          let destinationOccurrenceIndex = 0;
          destinationOccurrenceIndex < length;
          destinationOccurrenceIndex += 1
        ) {
          if (
            destinationOccurrenceIndex === originOccurrenceIndex ||
            (!pattern.closesLoop &&
              destinationOccurrenceIndex <= originOccurrenceIndex)
          )
            continue;
          const destinationStopNodeId =
            pattern.stopNodeIds[destinationOccurrenceIndex]!;
          const destinationStopPlaceId = nodePlaces.get(destinationStopNodeId);
          if (
            !destinationStopPlaceId ||
            destinationStopPlaceId === originStopPlaceId ||
            !eligible.has(destinationStopPlaceId)
          )
            continue;
          const edgeCount = pattern.closesLoop
            ? (destinationOccurrenceIndex - originOccurrenceIndex + length) %
              length
            : destinationOccurrenceIndex - originOccurrenceIndex;
          const candidate: PassengerDirectItinerary = {
            status: 'direct',
            originStopPlaceId,
            destinationStopPlaceId,
            routeId: route.routeId,
            patternId: pattern.patternId,
            originStopNodeId,
            destinationStopNodeId,
            originOccurrenceIndex,
            destinationOccurrenceIndex,
            wrapsPatternEnd: originOccurrenceIndex + edgeCount >= length,
            edgeCount,
          };
          const key = pairKey(originStopPlaceId, destinationStopPlaceId);
          const previous = candidates.get(key);
          if (!previous || candidateOrder(candidate, previous) < 0)
            candidates.set(key, candidate);
        }
      }
    }
  const directEntries = [...candidates.values()].sort(entryOrder);
  const completePairCount = pairCount(stopPlaceIds.length);
  const plan = deepFreeze({
    schemaVersion: passengerDirectItineraryPlanSchemaVersion,
    routingPolicy: passengerDirectItineraryRoutingPolicy,
    scenario: coordinate,
    demandPlan: demandIdentity(demandPlan),
    stopPlaceIds,
    pairCount: completePairCount,
    directPairCount: directEntries.length,
    unavailablePairCount: completePairCount - directEntries.length,
    directEntries,
  });
  return Object.freeze({ plan, index: createRuntime(plan) });
}

function parsePlan(value: unknown): PassengerDirectItineraryPlanV2 {
  const parsed = planSchema.parse(
    value,
  ) as unknown as PassengerDirectItineraryPlanV2;
  for (let index = 1; index < parsed.stopPlaceIds.length; index += 1)
    if (
      lexical(parsed.stopPlaceIds[index - 1]!, parsed.stopPlaceIds[index]!) >= 0
    )
      throw new Error(
        'Itinerary StopPlace IDs must be unique and lexically ordered.',
      );
  const stops = new Set<string>(parsed.stopPlaceIds);
  const pairs = new Set<string>();
  let previous: PassengerDirectItinerary | undefined;
  for (const entry of parsed.directEntries) {
    if (
      !stops.has(entry.originStopPlaceId) ||
      !stops.has(entry.destinationStopPlaceId)
    )
      throw new Error('Itinerary entry references an unknown StopPlace.');
    if (entry.originStopPlaceId === entry.destinationStopPlaceId)
      throw new Error('Itinerary plan contains a same-origin pair.');
    const key = pairKey(entry.originStopPlaceId, entry.destinationStopPlaceId);
    if (pairs.has(key)) throw new Error('Itinerary plan contains a duplicate.');
    if (previous && entryOrder(previous, entry) >= 0)
      throw new Error('Itinerary plan entries are not canonically ordered.');
    pairs.add(key);
    previous = entry;
  }
  const completePairCount = pairCount(parsed.stopPlaceIds.length);
  if (
    parsed.pairCount !== completePairCount ||
    parsed.directPairCount !== parsed.directEntries.length ||
    parsed.unavailablePairCount !==
      completePairCount - parsed.directEntries.length
  )
    throw new Error('Itinerary plan pair counts are inconsistent.');
  return deepFreeze(parsed);
}
const sameEntry = (a: PassengerDirectItinerary, b: PassengerDirectItinerary) =>
  a.originStopPlaceId === b.originStopPlaceId &&
  a.destinationStopPlaceId === b.destinationStopPlaceId &&
  a.routeId === b.routeId &&
  a.patternId === b.patternId &&
  a.originStopNodeId === b.originStopNodeId &&
  a.destinationStopNodeId === b.destinationStopNodeId &&
  a.originOccurrenceIndex === b.originOccurrenceIndex &&
  a.destinationOccurrenceIndex === b.destinationOccurrenceIndex &&
  a.wrapsPatternEnd === b.wrapsPatternEnd &&
  a.edgeCount === b.edgeCount;
function assertCanonical(
  actual: PassengerDirectItineraryPlanV2,
  expected: PassengerDirectItineraryPlanV2,
) {
  if (
    !sameScenario(actual.scenario, expected.scenario) ||
    actual.demandPlan.demandModelContentHash !==
      expected.demandPlan.demandModelContentHash ||
    actual.demandPlan.cityId !== expected.demandPlan.cityId ||
    actual.demandPlan.gridVersion !== expected.demandPlan.gridVersion ||
    actual.stopPlaceIds.length !== expected.stopPlaceIds.length ||
    actual.stopPlaceIds.some(
      (stop, index) => stop !== expected.stopPlaceIds[index],
    ) ||
    actual.pairCount !== expected.pairCount ||
    actual.directPairCount !== expected.directPairCount ||
    actual.unavailablePairCount !== expected.unavailablePairCount ||
    actual.directEntries.length !== expected.directEntries.length ||
    actual.directEntries.some(
      (entry, index) => !sameEntry(entry, expected.directEntries[index]!),
    )
  )
    throw new Error('Passenger direct itinerary plan is not canonical.');
}

export function buildPassengerDirectItineraryAuthority(input: {
  readonly scenario: CanonicalScenario;
  readonly demandPlan: PassengerDemandPlanV1;
}): PassengerDirectItineraryAuthority {
  return buildTrustedPassengerDirectItineraryAuthority({
    scenario: input.scenario,
    demandPlan: parsePassengerDemandPlan(input.demandPlan),
  });
}
/** Internal composition boundary. The caller must already own parsed authority. */
export function buildTrustedPassengerDirectItineraryAuthority(input: {
  readonly scenario: CanonicalScenario;
  readonly demandPlan: PassengerDemandPlanV1;
}): PassengerDirectItineraryAuthority {
  return buildAuthority(input.scenario, input.demandPlan);
}
export function buildPassengerDirectItineraryPlan(input: {
  readonly scenario: CanonicalScenario;
  readonly demandPlan: PassengerDemandPlanV1;
}): PassengerDirectItineraryPlanV2 {
  return buildPassengerDirectItineraryAuthority(input).plan;
}
export function validatePassengerDirectItineraryPlan(input: {
  readonly plan: unknown;
  readonly scenario: CanonicalScenario;
  readonly demandPlan: PassengerDemandPlanV1;
}): PassengerDirectItineraryPlanV2 {
  const parsed = parsePlan(input.plan);
  assertCanonical(
    parsed,
    buildPassengerDirectItineraryAuthority({
      scenario: input.scenario,
      demandPlan: input.demandPlan,
    }).plan,
  );
  return parsed;
}
export function createPassengerDirectItineraryRuntimeIndex(input: {
  readonly plan: unknown;
  readonly scenario: CanonicalScenario;
  readonly demandPlan: PassengerDemandPlanV1;
}): PassengerDirectItineraryRuntimeIndex {
  return createRuntime(validatePassengerDirectItineraryPlan(input));
}
export function findPassengerDirectItinerary(
  plan: PassengerDirectItineraryPlanV2,
  origin: string,
  destination: string,
): Readonly<PassengerDirectItinerary> | undefined {
  return createRuntime(parsePlan(plan)).find(origin, destination);
}
