import { expect, it } from 'vitest';
import { createRepresentationProfileResult } from './representation-profile-summary.js';
import { representationProfilePrefix } from './representation-profiler.js';
import { defaultRepresentationViewForFamily } from '../representation/representation-view-capabilities.js';

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
    primaryFamily: 'dom2d',
    miniFamily: 'd3d',
    observationDurationMs: 1_000,
    startTick: 10,
    endTick: 30,
    primitiveSnapshot: {
      routeEdgePrimitives: 5,
      stopPlaceMarkers: 4,
      vehicleMarkers: 2,
      passengerStopStatusCircles: 7,
      waitingLabels: 3,
      onboardLabels: 2,
      arrivalPulses: 0,
      populationPrimitives: 8,
    },
    entries: [
      named('svg.wrapper.render', 'mark'),
      named('svg.committed.render', 'mark'),
      named('svg.committed.render-to-commit', 'measure', 3),
      named('svg.committed.commit', 'mark', 0, {
        routeEdgePrimitives: 4,
        vehicleMarkers: 2,
      }),
      named('passengers.derivation', 'measure', 2),
      named('passengerStops.render', 'mark'),
      named('passengerStops.commit', 'mark', 0, {
        waitingLabels: 3,
        stopStatusCircles: 7,
      }),
      named('population.render', 'mark'),
      named('population.geometry', 'measure', 5, { primitiveCount: 8 }),
      named('population.commit', 'mark', 0, { primitiveCount: 8 }),
      named('population.render-to-commit', 'measure', 7),
      named('r3f.frame', 'mark'),
      named('r3f.advance', 'measure', 1),
      named('canvas2d.frame', 'mark', 0, {
        cssWidth: 100,
        cssHeight: 50,
        backingWidth: 200,
        backingHeight: 100,
        devicePixelRatio: 2,
      }),
      named('canvas2d.draw', 'measure', 2),
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
    primaryFamily: 'dom2d',
    miniFamily: 'd3d',
    inactiveFamily: 'canvas2d',
    primaryView: 'map',
    miniView: 'main',
    inactiveView: 'map',
    targetFramesPerSecond: 5,
  });
  expect(result.svg).toMatchObject({
    wrapperRenders: 1,
    renders: 1,
    commits: 1,
    totalMs: 3,
    vehicleMarkers: 2,
  });
  expect(result.passengerDiagnostics).toMatchObject({
    derivations: 1,
    renders: 1,
    stopStatusCircles: 7,
    waitingLabels: 3,
  });
  expect(result.population).toMatchObject({
    renders: 1,
    geometryRebuilds: 1,
    primitiveCount: 8,
  });
  expect(result.r3f).toMatchObject({
    view: 'main',
    slot: 'mini',
    mode: 'mini',
    targetFramesPerSecond: 5,
    frameAdvances: 1,
    totalMs: 1,
  });
  expect(result.canvas2d).toMatchObject({
    view: 'map',
    slot: 'inactive',
    mode: null,
    targetFramesPerSecond: null,
    frames: 1,
    totalMs: 2,
    devicePixelRatio: 2,
  });
});

it.each([
  {
    name: 'Canvas mini with D3D inactive',
    primaryFamily: 'dom2d',
    miniFamily: 'canvas2d',
    d3d: { slot: 'inactive', mode: null, targetFramesPerSecond: null },
    canvas: { slot: 'mini', mode: 'mini', targetFramesPerSecond: 5 },
  },
  {
    name: 'Canvas primary with D3D inactive',
    primaryFamily: 'canvas2d',
    miniFamily: 'dom2d',
    d3d: { slot: 'inactive', mode: null, targetFramesPerSecond: null },
    canvas: { slot: 'primary', mode: 'normal', targetFramesPerSecond: 60 },
  },
  {
    name: 'D3D primary with Canvas mini',
    primaryFamily: 'd3d',
    miniFamily: 'canvas2d',
    d3d: { slot: 'primary', mode: 'normal', targetFramesPerSecond: 60 },
    canvas: { slot: 'mini', mode: 'mini', targetFramesPerSecond: 5 },
  },
] as const)(
  'reports actual visible placement for $name',
  ({ primaryFamily, miniFamily, d3d, canvas }) => {
    const result = createRepresentationProfileResult({
      scenarioId: 'torrevieja-legacy-abc-v1',
      representationMode: primaryFamily === 'dom2d' ? 'normal' : 'mini',
      passengersVisible: false,
      populationVisible: false,
      primaryFamily,
      miniFamily,
      observationDurationMs: 1,
      startTick: 0,
      endTick: 0,
      primitiveSnapshot: {
        routeEdgePrimitives: 0,
        stopPlaceMarkers: 0,
        vehicleMarkers: 0,
        passengerStopStatusCircles: 0,
        waitingLabels: 0,
        onboardLabels: 0,
        arrivalPulses: 0,
        populationPrimitives: 0,
      },
      entries: [
        {
          name: `${representationProfilePrefix}canvas2d.frame`,
          entryType: 'mark',
          duration: 0,
        },
      ],
    });
    const inactiveFamily = (['dom2d', 'canvas2d', 'd3d'] as const).find(
      (family) => family !== primaryFamily && family !== miniFamily,
    )!;
    expect(result.representation).toMatchObject({
      primaryFamily,
      miniFamily,
      primaryView: defaultRepresentationViewForFamily(primaryFamily),
      miniView: defaultRepresentationViewForFamily(miniFamily),
      inactiveView: defaultRepresentationViewForFamily(inactiveFamily),
    });
    expect(result.r3f).toMatchObject({ view: 'main', ...d3d });
    expect(result.canvas2d).toMatchObject({ view: 'map', ...canvas });
  },
);
