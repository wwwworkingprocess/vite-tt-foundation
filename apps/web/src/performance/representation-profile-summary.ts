import {
  representationProfilePrefix,
  summarizeDurations,
} from './representation-profiler.js';
import {
  defaultRepresentationViewForFamily,
  representationFamilies,
  type RepresentationFamily,
} from '../representation/representation-view-capabilities.js';

const familyPlacement = (
  family: RepresentationFamily,
  primaryFamily: RepresentationFamily,
  miniFamily: RepresentationFamily,
) =>
  family === primaryFamily
    ? Object.freeze({
        view: defaultRepresentationViewForFamily(family),
        slot: 'primary' as const,
        mode: 'normal' as const,
        targetFramesPerSecond: 60,
      })
    : family === miniFamily
      ? Object.freeze({
          view: defaultRepresentationViewForFamily(family),
          slot: 'mini' as const,
          mode: 'mini' as const,
          targetFramesPerSecond: 5,
        })
      : Object.freeze({
          view: defaultRepresentationViewForFamily(family),
          slot: 'inactive' as const,
          mode: null,
          targetFramesPerSecond: null,
        });

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
  readonly primaryFamily: RepresentationFamily;
  readonly miniFamily: RepresentationFamily;
  readonly observationDurationMs: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly entries: readonly ProfileEntryLike[];
  readonly primitiveSnapshot: Readonly<{
    routeEdgePrimitives: number;
    stopPlaceMarkers: number;
    vehicleMarkers: number;
    passengerStopStatusCircles: number;
    waitingLabels: number;
    onboardLabels: number;
    arrivalPulses: number;
    populationPrimitives: number;
  }>;
}) {
  const { entries } = input;
  const inactiveFamily = representationFamilies.find(
    (family) => family !== input.primaryFamily && family !== input.miniFamily,
  )!;
  return Object.freeze({
    schemaVersion: '2.0.0',
    scenarioId: input.scenarioId,
    representation: Object.freeze({
      mode: input.representationMode,
      passengersVisible: input.passengersVisible,
      populationVisible: input.populationVisible,
      primaryFamily: input.primaryFamily,
      miniFamily: input.miniFamily,
      inactiveFamily,
      primaryView: defaultRepresentationViewForFamily(input.primaryFamily),
      miniView: defaultRepresentationViewForFamily(input.miniFamily),
      inactiveView: defaultRepresentationViewForFamily(inactiveFamily),
      targetFramesPerSecond: input.representationMode === 'mini' ? 5 : 60,
    }),
    observation: Object.freeze({
      durationMs: input.observationDurationMs,
      startTick: input.startTick,
      endTick: input.endTick,
      tickDelta: input.endTick - input.startTick,
    }),
    svg: Object.freeze({
      wrapperRenders: entriesNamed(entries, 'svg.wrapper.render').length,
      renders: entriesNamed(entries, 'svg.committed.render').length,
      commits: entriesNamed(entries, 'svg.committed.commit').length,
      ...durationSummary(entries, 'svg.committed.render-to-commit'),
      routeEdgePrimitives: Math.max(
        input.primitiveSnapshot.routeEdgePrimitives,
        maximumDetail(entries, 'svg.committed.commit', 'routeEdgePrimitives'),
      ),
      stopPlaceMarkers: Math.max(
        input.primitiveSnapshot.stopPlaceMarkers,
        maximumDetail(entries, 'svg.committed.commit', 'physicalStopPlaces'),
      ),
      vehicleMarkers: Math.max(
        input.primitiveSnapshot.vehicleMarkers,
        maximumDetail(entries, 'svg.committed.commit', 'vehicleMarkers'),
      ),
    }),
    passengerDiagnostics: Object.freeze({
      derivations: entriesNamed(entries, 'passengers.derivation').length,
      renders: entriesNamed(entries, 'passengerStops.render').length,
      commits: entriesNamed(entries, 'passengerStops.commit').length,
      ...durationSummary(entries, 'passengers.derivation'),
      waitingLabels: Math.max(
        input.primitiveSnapshot.waitingLabels,
        maximumDetail(entries, 'passengerStops.commit', 'waitingLabels'),
      ),
      onboardLabels: Math.max(
        input.primitiveSnapshot.onboardLabels,
        maximumDetail(entries, 'svg.committed.commit', 'onboardLabels'),
      ),
      arrivalPulses: Math.max(
        input.primitiveSnapshot.arrivalPulses,
        maximumDetail(entries, 'passengerStops.commit', 'arrivalPulses'),
      ),
      stopStatusCircles: Math.max(
        input.primitiveSnapshot.passengerStopStatusCircles,
        maximumDetail(entries, 'passengerStops.commit', 'stopStatusCircles'),
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
      ...familyPlacement('d3d', input.primaryFamily, input.miniFamily),
      frameAdvances: entriesNamed(entries, 'r3f.frame').length,
      ...durationSummary(entries, 'r3f.advance'),
    }),
    ...(entriesNamed(entries, 'canvas2d.frame').length
      ? {
          canvas2d: Object.freeze({
            ...familyPlacement(
              'canvas2d',
              input.primaryFamily,
              input.miniFamily,
            ),
            frames: entriesNamed(entries, 'canvas2d.frame').length,
            ...durationSummary(entries, 'canvas2d.draw'),
            cssWidth: maximumDetail(entries, 'canvas2d.frame', 'cssWidth'),
            cssHeight: maximumDetail(entries, 'canvas2d.frame', 'cssHeight'),
            backingWidth: maximumDetail(
              entries,
              'canvas2d.frame',
              'backingWidth',
            ),
            backingHeight: maximumDetail(
              entries,
              'canvas2d.frame',
              'backingHeight',
            ),
            devicePixelRatio: maximumDetail(
              entries,
              'canvas2d.frame',
              'devicePixelRatio',
            ),
          }),
        }
      : {}),
  });
}
