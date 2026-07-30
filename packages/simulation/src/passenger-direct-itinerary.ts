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

export const passengerDirectItineraryPlanSchemaVersion = '1.0.0' as const;
export const passengerDirectItineraryRoutingPolicy = Object.freeze({
  kind: 'single-pattern-direct',
  version: '1.0.0',
} as const);

const safeCount = z.number().int().nonnegative().safe();
const identifier = z.string().trim().min(1);
const semanticVersion = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const scenarioSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: identifier,
  scenarioVersion: semanticVersion,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const demandPlanSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  demandModelContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  cityId: z.string().regex(/^Q[1-9]\d*$/),
  populationGridSchemaVersion: z.literal('1.0.0'),
  gridVersion: semanticVersion,
});
const pairSchema = z.object({
  originStopPlaceId: identifier,
  destinationStopPlaceId: identifier,
});
const directEntrySchema = pairSchema
  .extend({
    status: z.literal('direct'),
    routeId: identifier,
    patternId: identifier,
    originStopNodeId: identifier,
    destinationStopNodeId: identifier,
    originOccurrenceIndex: safeCount,
    destinationOccurrenceIndex: safeCount,
    wrapsPatternEnd: z.boolean(),
    edgeCount: z.number().int().positive().safe(),
    stopNodeIds: z.array(identifier).min(2),
  })
  .strict();
const unavailableEntrySchema = pairSchema
  .extend({
    status: z.literal('unavailable'),
    reason: z.literal('no-direct-pattern'),
  })
  .strict();
const entrySchema = z.discriminatedUnion('status', [
  directEntrySchema,
  unavailableEntrySchema,
]);
const planSchema = z.strictObject({
  schemaVersion: z.literal(passengerDirectItineraryPlanSchemaVersion),
  routingPolicy: z.strictObject({
    kind: z.literal(passengerDirectItineraryRoutingPolicy.kind),
    version: z.literal(passengerDirectItineraryRoutingPolicy.version),
  }),
  scenario: scenarioSchema,
  demandPlan: demandPlanSchema,
  stopPlaceIds: z.array(identifier),
  pairCount: safeCount,
  directPairCount: safeCount,
  unavailablePairCount: safeCount,
  entries: z.array(entrySchema),
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
  readonly stopNodeIds: readonly StopNodeId[];
}

export interface PassengerDirectItineraryUnavailable {
  readonly status: 'unavailable';
  readonly originStopPlaceId: StopPlaceId;
  readonly destinationStopPlaceId: StopPlaceId;
  readonly reason: 'no-direct-pattern';
}

export type PassengerDirectItineraryEntry =
  PassengerDirectItinerary | PassengerDirectItineraryUnavailable;

export interface PassengerDirectItineraryPlanV1 {
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
  readonly entries: readonly Readonly<PassengerDirectItineraryEntry>[];
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

const lexical = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
const pairKey = (origin: string, destination: string) =>
  `${origin.length}:${origin}${destination}`;

function checkedOrderedPairCount(stopPlaceCount: number): number {
  const otherStopPlaceCount = stopPlaceCount === 0 ? 0 : stopPlaceCount - 1;
  if (
    otherStopPlaceCount > 0 &&
    stopPlaceCount > Math.floor(Number.MAX_SAFE_INTEGER / otherStopPlaceCount)
  )
    throw new Error('Itinerary StopPlace pair count exceeds safe arithmetic.');
  return stopPlaceCount * otherStopPlaceCount;
}

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

const identitiesEqual = (
  left: PassengerDirectItineraryPlanScenario,
  right: PassengerDirectItineraryPlanScenario,
) =>
  left.scenarioSchemaVersion === right.scenarioSchemaVersion &&
  left.scenarioId === right.scenarioId &&
  left.scenarioVersion === right.scenarioVersion &&
  left.contentHash === right.contentHash;

const compareCandidate = (
  left: PassengerDirectItinerary,
  right: PassengerDirectItinerary,
) => {
  const comparisons = [
    left.edgeCount - right.edgeCount,
    lexical(left.routeId, right.routeId),
    lexical(left.patternId, right.patternId),
    left.originOccurrenceIndex - right.originOccurrenceIndex,
    left.destinationOccurrenceIndex - right.destinationOccurrenceIndex,
    lexical(left.originStopNodeId, right.originStopNodeId),
    lexical(left.destinationStopNodeId, right.destinationStopNodeId),
  ];
  return comparisons.find((comparison) => comparison !== 0) ?? 0;
};

function canonicalPlan(
  scenario: CanonicalScenario,
  suppliedDemandPlan: PassengerDemandPlanV1,
): PassengerDirectItineraryPlanV1 {
  const demandPlan = parsePassengerDemandPlan(suppliedDemandPlan);
  const coordinate = scenarioIdentity(scenario);
  if (!identitiesEqual(coordinate, demandPlan.scenario))
    throw new Error('Itinerary scenario and demand plan do not match.');

  const stopPlaces = [...demandPlan.stops]
    .map(({ stopPlaceId }) => stopPlaceId)
    .sort(lexical);
  const canonicalStopPlaces = new Set(
    scenario.stops.stopPlaces.map(({ stopPlaceId }) => stopPlaceId),
  );
  for (const stopPlaceId of stopPlaces)
    if (!canonicalStopPlaces.has(stopPlaceId))
      throw new Error(`Unknown itinerary StopPlace ${stopPlaceId}.`);

  const nodeToPlace = new Map(
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
      for (let originIndex = 0; originIndex < length; originIndex += 1) {
        const originNode = pattern.stopNodeIds[originIndex]!;
        const originPlace = nodeToPlace.get(originNode);
        if (!originPlace || !stopPlaces.includes(originPlace)) continue;
        for (
          let destinationIndex = 0;
          destinationIndex < length;
          destinationIndex += 1
        ) {
          if (
            destinationIndex === originIndex ||
            (!pattern.closesLoop && destinationIndex <= originIndex)
          )
            continue;
          const destinationNode = pattern.stopNodeIds[destinationIndex]!;
          const destinationPlace = nodeToPlace.get(destinationNode);
          if (
            !destinationPlace ||
            destinationPlace === originPlace ||
            !stopPlaces.includes(destinationPlace)
          )
            continue;
          const edgeCount = pattern.closesLoop
            ? (destinationIndex - originIndex + length) % length
            : destinationIndex - originIndex;
          const stopNodeIds = Array.from(
            { length: edgeCount + 1 },
            (_, offset) =>
              pattern.stopNodeIds[(originIndex + offset) % length]!,
          );
          const candidate: PassengerDirectItinerary = {
            status: 'direct',
            originStopPlaceId: originPlace,
            destinationStopPlaceId: destinationPlace,
            routeId: route.routeId,
            patternId: pattern.patternId,
            originStopNodeId: originNode,
            destinationStopNodeId: destinationNode,
            originOccurrenceIndex: originIndex,
            destinationOccurrenceIndex: destinationIndex,
            wrapsPatternEnd: originIndex + edgeCount >= length,
            edgeCount,
            stopNodeIds,
          };
          const key = pairKey(originPlace, destinationPlace);
          const previous = candidates.get(key);
          if (!previous || compareCandidate(candidate, previous) < 0)
            candidates.set(key, candidate);
        }
      }
    }

  const entries: PassengerDirectItineraryEntry[] = [];
  let directPairCount = 0;
  for (const originStopPlaceId of stopPlaces)
    for (const destinationStopPlaceId of stopPlaces) {
      if (originStopPlaceId === destinationStopPlaceId) continue;
      const candidate = candidates.get(
        pairKey(originStopPlaceId, destinationStopPlaceId),
      );
      if (candidate) {
        directPairCount += 1;
        entries.push(candidate);
      } else
        entries.push({
          status: 'unavailable',
          originStopPlaceId,
          destinationStopPlaceId,
          reason: 'no-direct-pattern',
        });
    }
  const pairCount = checkedOrderedPairCount(stopPlaces.length);
  return deepFreeze({
    schemaVersion: passengerDirectItineraryPlanSchemaVersion,
    routingPolicy: passengerDirectItineraryRoutingPolicy,
    scenario: coordinate,
    demandPlan: demandIdentity(demandPlan),
    stopPlaceIds: stopPlaces,
    pairCount,
    directPairCount,
    unavailablePairCount: pairCount - directPairCount,
    entries,
  });
}

function parsePlan(value: unknown): PassengerDirectItineraryPlanV1 {
  const parsed = planSchema.parse(
    value,
  ) as unknown as PassengerDirectItineraryPlanV1;
  for (let index = 1; index < parsed.stopPlaceIds.length; index += 1)
    if (
      lexical(parsed.stopPlaceIds[index - 1]!, parsed.stopPlaceIds[index]!) >= 0
    )
      throw new Error(
        'Itinerary StopPlace IDs must be unique and lexically ordered.',
      );
  const stopPlaces = new Set<string>(parsed.stopPlaceIds);
  const pairs = new Set<string>();
  let directCount = 0;
  let previousOrigin = '';
  let previousDestination = '';
  for (const entry of parsed.entries) {
    if (
      !stopPlaces.has(entry.originStopPlaceId) ||
      !stopPlaces.has(entry.destinationStopPlaceId)
    )
      throw new Error('Itinerary entry references an unknown StopPlace.');
    if (entry.originStopPlaceId === entry.destinationStopPlaceId)
      throw new Error('Itinerary plan contains a same-origin pair.');
    const key = pairKey(entry.originStopPlaceId, entry.destinationStopPlaceId);
    if (pairs.has(key)) throw new Error('Itinerary plan contains a duplicate.');
    pairs.add(key);
    if (
      lexical(previousOrigin, entry.originStopPlaceId) > 0 ||
      (previousOrigin === entry.originStopPlaceId &&
        lexical(previousDestination, entry.destinationStopPlaceId) >= 0)
    )
      throw new Error('Itinerary plan entries are not canonically ordered.');
    previousOrigin = entry.originStopPlaceId;
    previousDestination = entry.destinationStopPlaceId;
    if (entry.status === 'direct') directCount += 1;
  }
  const expectedPairCount = checkedOrderedPairCount(parsed.stopPlaceIds.length);
  if (
    parsed.entries.length !== expectedPairCount ||
    parsed.pairCount !== expectedPairCount ||
    parsed.directPairCount !== directCount ||
    parsed.unavailablePairCount !== expectedPairCount - directCount
  )
    throw new Error('Itinerary plan pair counts are inconsistent.');
  return deepFreeze(parsed);
}

const canonicalJson = (value: unknown): string =>
  value !== null && typeof value === 'object'
    ? Array.isArray(value)
      ? `[${value.map(canonicalJson).join(',')}]`
      : `{${Object.entries(value)
          .sort(([left], [right]) => lexical(left, right))
          .map(
            ([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`,
          )
          .join(',')}}`
    : JSON.stringify(value);

export function buildPassengerDirectItineraryPlan(input: {
  readonly scenario: CanonicalScenario;
  readonly demandPlan: PassengerDemandPlanV1;
}): PassengerDirectItineraryPlanV1 {
  return canonicalPlan(input.scenario, input.demandPlan);
}

export function validatePassengerDirectItineraryPlan(input: {
  readonly plan: unknown;
  readonly scenario: CanonicalScenario;
  readonly demandPlan: PassengerDemandPlanV1;
}): PassengerDirectItineraryPlanV1 {
  const parsed = parsePlan(input.plan);
  const expected = canonicalPlan(input.scenario, input.demandPlan);
  if (canonicalJson(parsed) !== canonicalJson(expected))
    throw new Error('Passenger direct itinerary plan is not canonical.');
  return parsed;
}

export function findPassengerDirectItinerary(
  planInput: PassengerDirectItineraryPlanV1,
  originStopPlaceId: string,
  destinationStopPlaceId: string,
): Readonly<PassengerDirectItineraryEntry> {
  const plan = parsePlan(planInput);
  if (originStopPlaceId === destinationStopPlaceId)
    throw new Error('Passenger itinerary requires distinct StopPlaces.');
  const stopPlaces = new Set<string>(plan.stopPlaceIds);
  if (
    !stopPlaces.has(originStopPlaceId) ||
    !stopPlaces.has(destinationStopPlaceId)
  )
    throw new Error('Unknown passenger itinerary StopPlace.');
  const entry = plan.entries.find(
    (candidate) =>
      candidate.originStopPlaceId === originStopPlaceId &&
      candidate.destinationStopPlaceId === destinationStopPlaceId,
  );
  if (!entry) throw new Error('Passenger direct itinerary plan is incomplete.');
  return entry;
}
