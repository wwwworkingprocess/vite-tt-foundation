import {
  representationProfilePrefix,
  summarizeDurations,
} from './representation-profiler.js';

export interface ProfileEntryLike {
  readonly name: string;
  readonly entryType: string;
  readonly duration: number;
  readonly detail?: Readonly<Record<string, unknown>> | undefined;
}

const entriesNamed = (entries: readonly ProfileEntryLike[], suffix: string) =>
  entries.filter(
    ({ name }) => name === `${representationProfilePrefix}${suffix}`,
  );

const maximumDetail = (
  entries: readonly ProfileEntryLike[],
  suffix: string,
  field: string,
) =>
  Math.max(
    0,
    ...entriesNamed(entries, suffix).map(({ detail }) => {
      const value = detail?.[field];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }),
  );

const durationSummary = (
  entries: readonly ProfileEntryLike[],
  suffix: string,
) =>
  summarizeDurations(
    entriesNamed(entries, suffix).map(({ duration }) => duration),
  );

export function createRepresentationProfileResult(input: {
  readonly scenarioId: string;
  readonly representationMode: 'mini' | 'normal';
  readonly passengersVisible: boolean;
  readonly populationVisible: boolean;
  readonly threePrimary: boolean;
  readonly observationDurationMs: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly entries: readonly ProfileEntryLike[];
  readonly primitiveSnapshot: Readonly<{
    routeEdgePrimitives: number;
    stopPlaceMarkers: number;
    vehicleMarkers: number;
    waitingLabels: number;
    onboardLabels: number;
    arrivalPulses: number;
    populationPrimitives: number;
  }>;
}) {
  const { entries } = input;
  return Object.freeze({
    schemaVersion: '1.0.0',
    scenarioId: input.scenarioId,
    representation: Object.freeze({
      mode: input.representationMode,
      passengersVisible: input.passengersVisible,
      populationVisible: input.populationVisible,
      threePrimary: input.threePrimary,
      targetFramesPerSecond: input.representationMode === 'mini' ? 5 : 60,
    }),
    observation: Object.freeze({
      durationMs: input.observationDurationMs,
      startTick: input.startTick,
      endTick: input.endTick,
      tickDelta: input.endTick - input.startTick,
    }),
    svg: Object.freeze({
      commits: entriesNamed(entries, 'svg.commit').length,
      ...durationSummary(entries, 'svg.render-to-commit'),
      routeEdgePrimitives: Math.max(
        input.primitiveSnapshot.routeEdgePrimitives,
        maximumDetail(entries, 'svg.commit', 'routeEdgePrimitives'),
      ),
      stopPlaceMarkers: Math.max(
        input.primitiveSnapshot.stopPlaceMarkers,
        maximumDetail(entries, 'svg.commit', 'stopPlaceMarkers'),
      ),
      vehicleMarkers: Math.max(
        input.primitiveSnapshot.vehicleMarkers,
        maximumDetail(entries, 'svg.commit', 'vehicleMarkers'),
      ),
    }),
    passengerDiagnostics: Object.freeze({
      derivations: entriesNamed(entries, 'passengers.derivation').length,
      commits: entriesNamed(entries, 'passengers.commit').length,
      ...durationSummary(entries, 'passengers.derivation'),
      waitingLabels: Math.max(
        input.primitiveSnapshot.waitingLabels,
        maximumDetail(entries, 'passengers.commit', 'waitingLabels'),
      ),
      onboardLabels: Math.max(
        input.primitiveSnapshot.onboardLabels,
        maximumDetail(entries, 'passengers.commit', 'onboardLabels'),
      ),
      arrivalPulses: Math.max(
        input.primitiveSnapshot.arrivalPulses,
        maximumDetail(entries, 'passengers.commit', 'arrivalPulses'),
      ),
    }),
    population: Object.freeze({
      renders: entriesNamed(entries, 'population.render').length,
      geometryRebuilds: entriesNamed(entries, 'population.geometry').length,
      commits: entriesNamed(entries, 'population.commit').length,
      ...durationSummary(entries, 'population.render-to-commit'),
      geometry: durationSummary(entries, 'population.geometry'),
      primitiveCount: Math.max(
        input.primitiveSnapshot.populationPrimitives,
        maximumDetail(entries, 'population.commit', 'primitiveCount'),
      ),
    }),
    r3f: Object.freeze({
      targetFramesPerSecond: input.threePrimary ? 60 : 5,
      frameAdvances: entriesNamed(entries, 'r3f.frame').length,
      ...durationSummary(entries, 'r3f.advance'),
    }),
  });
}
