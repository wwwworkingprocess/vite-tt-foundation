import type { PassengerDirectItineraryPlanV2 } from '../packages/simulation/src/passenger-direct-itinerary.js';

export interface PassengerItinerarySemanticDigest {
  readonly scenarioId: string;
  readonly directPairCount: number;
  readonly semanticSha256: string;
}

export function passengerDirectItinerarySemanticPayload(
  plan: PassengerDirectItineraryPlanV2,
): readonly Readonly<Record<string, string | number | boolean>>[];

export function passengerDirectItinerarySemanticDigest(
  plan: PassengerDirectItineraryPlanV2,
): string;

export function selectItineraryMigrationDescriptors<
  T extends Readonly<{ readonly scenarioId: string }>,
>(
  catalogue: Readonly<{ readonly scenarios: readonly T[] }>,
  scenarioIds: readonly string[],
): readonly T[];

export function collectItinerarySemanticDigests(
  scenarioIds: readonly string[],
): Promise<readonly Readonly<PassengerItinerarySemanticDigest>[]>;

export function publicItinerarySemanticDigest(
  entries: readonly Readonly<PassengerItinerarySemanticDigest>[],
): string;
