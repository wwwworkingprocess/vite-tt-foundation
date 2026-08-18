import { expect, it } from 'vitest';
import { createRepresentationProfileResult } from './representation-profile-summary.js';
import { representationProfilePrefix } from './representation-profiler.js';

it('creates a stable structural browser-profile result', () => {
  const named = (
    name: string,
    entryType: 'mark' | 'measure',
    duration = 0,
    detail?: Record<string, unknown>,
  ) => ({
    name: `${representationProfilePrefix}${name}`,
    entryType,
    duration,
    detail,
  });
  const result = createRepresentationProfileResult({
    scenarioId: 'torrevieja-legacy-abc-v1',
    representationMode: 'mini',
    passengersVisible: true,
    populationVisible: false,
    threePrimary: false,
    observationDurationMs: 1_000,
    startTick: 10,
    endTick: 30,
    primitiveSnapshot: {
      routeEdgePrimitives: 5,
      stopPlaceMarkers: 4,
      vehicleMarkers: 2,
      waitingLabels: 3,
      onboardLabels: 2,
      arrivalPulses: 0,
      populationPrimitives: 8,
    },
    entries: [
      named('svg.render-to-commit', 'measure', 3),
      named('svg.commit', 'mark', 0, {
        routeEdgePrimitives: 4,
        vehicleMarkers: 2,
      }),
      named('passengers.derivation', 'measure', 2),
      named('passengers.commit', 'mark', 0, {
        waitingLabels: 3,
        onboardLabels: 2,
      }),
      named('population.render', 'mark'),
      named('population.geometry', 'measure', 5, { primitiveCount: 8 }),
      named('population.commit', 'mark', 0, { primitiveCount: 8 }),
      named('population.render-to-commit', 'measure', 7),
      named('r3f.frame', 'mark'),
      named('r3f.advance', 'measure', 1),
    ],
  });
  expect(result.observation).toEqual({
    durationMs: 1_000,
    startTick: 10,
    endTick: 30,
    tickDelta: 20,
  });
  expect(result.representation).toMatchObject({
    mode: 'mini',
    targetFramesPerSecond: 5,
  });
  expect(result.svg).toMatchObject({
    commits: 1,
    totalMs: 3,
    vehicleMarkers: 2,
  });
  expect(result.passengerDiagnostics).toMatchObject({
    derivations: 1,
    waitingLabels: 3,
  });
  expect(result.population).toMatchObject({
    renders: 1,
    geometryRebuilds: 1,
    primitiveCount: 8,
  });
  expect(result.r3f).toMatchObject({
    targetFramesPerSecond: 5,
    frameAdvances: 1,
    totalMs: 1,
  });
});
