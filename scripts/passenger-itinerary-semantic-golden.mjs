import { createHash } from 'node:crypto';
import { buildPassengerDirectItineraryAuthority } from '../packages/simulation/dist/passenger-direct-itinerary.js';
import {
  loadBenchmarkAssets,
  loadBenchmarkCatalogues,
  parseBenchmarkScenario,
  prepareBenchmarkPopulationView,
  buildBenchmarkCatchment,
  createBenchmarkPassengerDemandPlan,
} from './scenario-benchmark-support.mjs';

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function passengerDirectItinerarySemanticPayload(plan) {
  return plan.directEntries.map(
    ({
      originStopPlaceId,
      destinationStopPlaceId,
      routeId,
      patternId,
      originStopNodeId,
      destinationStopNodeId,
      originOccurrenceIndex,
      destinationOccurrenceIndex,
      wrapsPatternEnd,
      edgeCount,
    }) => ({
      originStopPlaceId,
      destinationStopPlaceId,
      routeId,
      patternId,
      originStopNodeId,
      destinationStopNodeId,
      originOccurrenceIndex,
      destinationOccurrenceIndex,
      wrapsPatternEnd,
      edgeCount,
    }),
  );
}

export const passengerDirectItinerarySemanticDigest = (plan) =>
  digest(passengerDirectItinerarySemanticPayload(plan));

export function selectItineraryMigrationDescriptors(catalogue, scenarioIds) {
  const descriptors = new Map(
    catalogue.scenarios.map((descriptor) => [
      descriptor.scenarioId,
      descriptor,
    ]),
  );
  return scenarioIds.map((scenarioId) => {
    const descriptor = descriptors.get(scenarioId);
    if (!descriptor)
      throw new Error(`Missing V1 migration scenario ${scenarioId}.`);
    return descriptor;
  });
}

export async function collectItinerarySemanticDigests(scenarioIds) {
  const { scenarioCatalogue, populationCatalogue } =
    await loadBenchmarkCatalogues();
  const results = [];
  for (const descriptor of selectItineraryMigrationDescriptors(
    scenarioCatalogue,
    scenarioIds,
  )) {
    const assets = await loadBenchmarkAssets(descriptor, populationCatalogue);
    const scenario = parseBenchmarkScenario(assets.scenarioTexts);
    const populationView = prepareBenchmarkPopulationView(descriptor, assets);
    const catchment = buildBenchmarkCatchment(
      scenario,
      populationView,
      populationCatalogue,
    );
    const demandPlan = createBenchmarkPassengerDemandPlan(
      catchment,
      populationView,
      assets.populationEntry,
      populationCatalogue,
    );
    const plan = buildPassengerDirectItineraryAuthority({
      scenario,
      demandPlan,
    }).plan;
    results.push(
      Object.freeze({
        scenarioId: descriptor.scenarioId,
        directPairCount: plan.directPairCount,
        semanticSha256: passengerDirectItinerarySemanticDigest(plan),
      }),
    );
  }
  return Object.freeze(results);
}

export const publicItinerarySemanticDigest = (entries) => digest(entries);
