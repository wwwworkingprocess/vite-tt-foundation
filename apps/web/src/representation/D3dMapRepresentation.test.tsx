import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as r3f from '@react-three/fiber';
import {
  listActivePopulationCells,
  parseCityPopulationGrid,
  parseScenarioPackage,
} from '@torrevieja-tycoon/transport-domain';
import {
  parseVehicleId,
  type VehicleState,
} from '@torrevieja-tycoon/simulation';
import { RepresentationModeProvider } from './RepresentationModeContext.js';
import D3dMapRepresentation, {
  createD3dRibbonGeometry,
  writeD3dDiagnostics,
} from './D3dMapRepresentation.js';
import { createTransportMapProjection } from './transport-map-projection.js';
import { createD3dMapModel } from './d3d-map-model.js';
import { fitD3dCamera } from './d3d-map-model.js';
import type { ScenarioPopulationView } from '../population/population-field-loader.js';
import { BoxGeometry, BufferGeometry } from 'three';
import { buildProceduralCity } from './d3d-city-model.js';
import { useSettlementMetadata } from '../settlement/use-settlement-metadata.js';
import { parseSettlementMetadata } from '../settlement/settlement-metadata.js';
vi.mock('../settlement/use-settlement-metadata.js', () => ({
  useSettlementMetadata: vi.fn(() => ({ status: 'unavailable' })),
}));
import {
  selectRoute,
  selectStop,
  selectVehicle,
} from '../ui/game-selection.js';
import {
  clearRepresentationProfiles,
  configureRepresentationProfiling,
  representationProfilePrefix,
} from '../performance/representation-profiler.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-legacy-abc-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});
const stop = scenario.stops.stopPlaces[0]!;
const route = scenario.routes.routes[0]!;
const pattern = route.patterns[0]!;
const fleet: VehicleState[] = [
  {
    vehicleId: parseVehicleId('d3d-bus'),
    label: 'D3D bus',
    patternId: pattern.patternId,
    movementPlan: { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: [10] },
    movement: {
      kind: 'parked-at-stop',
      stopNodeId: pattern.stopNodeIds[0]!,
      nextEdgeSequence: 0,
    },
  },
];
const onSelectionChange = vi.fn();
const model = createD3dMapModel(createTransportMapProjection(scenario));
const populationGrid = parseCityPopulationGrid({
  schemaVersion: '1.0.0',
  cityId: 'Q36730',
  gridVersion: '1.0.0',
  originCellCenter: {
    latitude:
      (model.projection.bounds.north + model.projection.bounds.south) / 2,
    longitude:
      (model.projection.bounds.west + model.projection.bounds.east) / 2,
  },
  resolutionDegrees: 0.001,
  rowDirection: 'north-to-south',
  columnDirection: 'west-to-east',
  rows: 12,
  columns: 12,
  populationWeights: Array.from({ length: 12 }, (_, r) =>
    Array.from({ length: 12 }, (_, c) => 1 + r * 8 + c * 4),
  ),
});
const canonicalCells = listActivePopulationCells(populationGrid);
const population: ScenarioPopulationView = {
  grid: populationGrid,
  crop: { rowStart: 0, rowEnd: 12, columnStart: 0, columnEnd: 12 },
  canonicalCells,
  totalPopulationWeight: canonicalCells.reduce(
    (sum, cell) => sum + cell.populationWeight,
    0,
  ),
  nonzeroCellCount: canonicalCells.length,
  gridSha256: 'a'.repeat(64),
  cropSha256: 'b'.repeat(64),
  demandModelContentHash: 'c'.repeat(64),
  operationalCropPolicy: { maxAccessDistanceCells: 5 },
};
const controls = (
  r3f as unknown as {
    __testControls: {
      camera: { zoom: number; position: { x: number; z: number } };
      canvas: HTMLCanvasElement;
      renderWorld: boolean;
      eventConnect: ReturnType<typeof vi.fn>;
      eventManager?: { connect: (element: HTMLElement | null) => void };
    };
  }
).__testControls;
const pointer = (kind: string, x: number, y: number, pointerId = 1) => {
  if (!controls.canvas.setPointerCapture)
    controls.canvas.setPointerCapture = vi.fn();
  const event = new MouseEvent(kind, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  controls.canvas.dispatchEvent(event);
};

afterEach(() => {
  controls.renderWorld = false;
  controls.eventConnect.mockClear();
  for (const property of [
    'setMatrixAt',
    'setColorAt',
    'instanceMatrix',
    'instanceColor',
    'computeBoundingSphere',
  ])
    Reflect.deleteProperty(HTMLElement.prototype, property);
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  configureRepresentationProfiling(false);
  clearRepresentationProfiles();
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'unavailable' });
});

it('connects R3F pointer events only to a mounted canvas target', () => {
  render(scene('normal'));
  controls.eventManager!.connect(null);
  expect(controls.eventConnect).not.toHaveBeenCalled();
  const target = document.createElement('div');
  controls.eventManager!.connect(target);
  expect(controls.eventConnect).toHaveBeenCalledExactlyOnceWith(target);
});

const sceneProps = (element: Element) =>
  (element as unknown as Record<string, unknown>)[
    Object.keys(element).find((key) => key.startsWith('__reactProps$'))!
  ] as { onClick?: (event: unknown) => void; raycast?: () => unknown };

const chooseSceneObject = (
  element: Element,
  options: { instanceId?: number; delta: number },
) => {
  const stopPropagation = vi.fn();
  sceneProps(element).onClick?.({ ...options, stopPropagation });
  return stopPropagation;
};

const enableWorld = () => {
  controls.renderWorld = true;
  const setMatrixAt = vi.fn();
  const setColorAt = vi.fn();
  const computeBoundingSphere = vi.fn();
  Object.assign(HTMLElement.prototype, {
    setMatrixAt,
    setColorAt,
    computeBoundingSphere,
    instanceMatrix: { needsUpdate: false },
    instanceColor: { needsUpdate: false },
  });
  return { setMatrixAt, setColorAt, computeBoundingSphere };
};

it('publishes read-only diagnostics when mounted and tolerates R3F host teardown', () => {
  const element = document.createElement('section');
  writeD3dDiagnostics(element, { cameraMode: 'full' });
  expect(element).toHaveAttribute('data-camera-mode', 'full');
  expect(() =>
    writeD3dDiagnostics(null, { cameraMode: 'manual' }),
  ).not.toThrow();
  expect(element).toHaveAttribute('data-camera-mode', 'full');
});

it('materializes route, terrain, StopPlace, and Vehicle geometry through the scene boundary', () => {
  const { setMatrixAt, setColorAt, computeBoundingSphere } = enableWorld();
  render(scene('normal'));
  expect(document.querySelectorAll('instancedmesh')).toHaveLength(3);
  expect(setMatrixAt).toHaveBeenCalled();
  expect(computeBoundingSphere).toHaveBeenCalled();
  expect(setColorAt).not.toHaveBeenCalled();
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute(
    'data-pointer-stop-id',
    model.stops.at(-1)!.stopPlaceId,
  );
  expect(map).toHaveAttribute('data-pointer-vehicle-id', fleet[0]!.vehicleId);
  expect(Number(map.getAttribute('data-pointer-stop-x'))).toBeGreaterThan(0);
  expect(Number(map.getAttribute('data-pointer-vehicle-y'))).toBeGreaterThan(0);
  expect(Number(map.getAttribute('data-pointer-route-x'))).toBeGreaterThan(0);
  onSelectionChange.mockClear();
  const stopMesh = document.querySelectorAll('instancedmesh')[0]!;
  expect(
    chooseSceneObject(stopMesh, { instanceId: 0, delta: 0 }),
  ).toHaveBeenCalled();
  expect(onSelectionChange).toHaveBeenCalledWith(
    selectStop(model.stops[0]!.stopPlaceId),
  );
});

it('batches five city silhouettes with near roofs and cheap far/mini geometry without stealing selection', () => {
  const { setMatrixAt, setColorAt, computeBoundingSphere } = enableWorld();
  onSelectionChange.mockClear();
  const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
  const city = buildProceduralCity(model, population);
  const { rerender, unmount } = render(
    scene('normal', null, undefined, scenario, population),
  );
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute(
    'data-city-building-count',
    String(city.buildings.length),
  );
  expect(city.buildings.length).toBeGreaterThan(0);
  expect(setColorAt).toHaveBeenCalled();
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  expect(map).toHaveAttribute('data-city-lod', 'near');
  expect(map).toHaveAttribute(
    'data-city-building-instances',
    String(city.buildings.length),
  );
  expect(map).toHaveAttribute(
    'data-city-roof-instances',
    String(city.buildings.length),
  );
  const buildings = document.querySelector('instancedmesh[name^="city-"]')!;
  expect(sceneProps(buildings).raycast?.()).toBeNull();
  expect(
    chooseSceneObject(buildings, { instanceId: 0, delta: 0 }),
  ).not.toHaveBeenCalled();
  const streets = document.querySelector('mesh[name="provisional-streets"]')!;
  expect(sceneProps(streets).raycast?.()).toBeNull();
  expect(
    sceneProps(
      document.querySelector('mesh[name="settlement-ground"]')!,
    ).raycast?.(),
  ).toBeNull();
  expect(chooseSceneObject(streets, { delta: 0 })).not.toHaveBeenCalled();
  expect(onSelectionChange).not.toHaveBeenCalled();
  expect(
    chooseSceneObject(
      document.querySelector('instancedmesh[name="stop-hit-targets"]')!,
      { instanceId: 0, delta: 0 },
    ),
  ).toHaveBeenCalled();
  expect(onSelectionChange).toHaveBeenCalledWith(
    selectStop(model.stops[0]!.stopPlaceId),
  );
  const staticCalls = setMatrixAt.mock.calls.length;
  const staticBounds = computeBoundingSphere.mock.calls.length;
  rerender(scene('normal', null, undefined, scenario, population, [...fleet]));
  expect(setMatrixAt).toHaveBeenCalledTimes(staticCalls);
  expect(computeBoundingSphere).toHaveBeenCalledTimes(staticBounds);
  fireEvent.wheel(controls.canvas, { deltaY: 10000 });
  expect(map).toHaveAttribute('data-city-lod', 'far');
  expect(map).toHaveAttribute(
    'data-city-building-instances',
    String(city.far.length),
  );
  expect(map).toHaveAttribute('data-city-roof-instances', '0');
  rerender(scene('mini', null, undefined, scenario, population));
  expect(map).toHaveAttribute(
    'data-city-building-instances',
    String(city.mini.length),
  );
  expect(map).toHaveAttribute('data-city-roof-instances', '0');
  expect(document.querySelector('mesh[name="provisional-streets"]')).toBeNull();
  const replacementPopulation = {
    ...population,
    canonicalCells: population.canonicalCells.filter((c) => c.column < 5),
  };
  const replacementScenario = {
    ...scenario,
    manifest: { ...scenario.manifest, scenarioId: 'population-replacement' },
  } as typeof scenario;
  rerender(
    scene(
      'normal',
      null,
      undefined,
      replacementScenario,
      replacementPopulation,
    ),
  );
  expect(map).toHaveAttribute('data-scenario-id', 'population-replacement');
  expect(Number(map.getAttribute('data-city-building-count'))).toBeLessThan(
    city.buildings.length,
  );
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  expect(map).toHaveAttribute(
    'data-city-roof-instances',
    map.getAttribute('data-city-building-count'),
  );
  unmount();
  expect(dispose).toHaveBeenCalled();
});

const readyMetadata = parseSettlementMetadata(
  JSON.parse(
    readFileSync(
      join(
        root,
        '../../../settlement-metadata/torrevieja/torrevieja-settlement-metadata.v0.json',
      ),
      'utf8',
    ),
  ) as unknown,
);
const readyView = {
  status: 'ready',
  metadata: readyMetadata,
  sha256: 'research',
  primarySettlementId: 'es-torrevieja',
} as const;
// Static fixture acquisition is exercised independently by the city-model tests.
buildProceduralCity(model, population, readyView);

it('exposes research diagnostics and keeps scaled city surfaces outside entity hit targets', () => {
  enableWorld();
  vi.mocked(useSettlementMetadata).mockReturnValue(readyView);
  const { rerender, unmount } = render(
    scene('normal', null, undefined, scenario, population),
  );
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-settlement-metadata-status', 'ready');
  expect(map).toHaveAttribute('data-research-district-count', '13');
  expect(map).toHaveAttribute('data-morphology-zone-count', '31');
  expect(map).toHaveAttribute('data-landmark-zone-mismatch-count', '3');
  expect(
    document.querySelector('mesh[name="research-landscape"]'),
  ).not.toBeNull();
  for (const name of ['research-landscape', 'landmark-reservations'])
    expect(
      sceneProps(document.querySelector(`mesh[name="${name}"]`)!).raycast!(),
    ).toBeNull();
  chooseSceneObject(
    document.querySelector('instancedmesh[name="stop-hit-targets"]')!,
    { instanceId: 0, delta: 0 },
  );
  expect(onSelectionChange).toHaveBeenCalled();
  const unitsPerPixel = 20 / (660 * cameraState().zoom);
  fireEvent.wheel(controls.canvas, {
    deltaY: -Math.log(unitsPerPixel / 0.07) * 1000,
  });
  expect(map).toHaveAttribute('data-city-lod', 'medium');
  fireEvent.wheel(controls.canvas, { deltaY: -1550 });
  rerender(
    scene(
      'normal',
      selectStop(stop.stopPlaceId),
      undefined,
      scenario,
      population,
    ),
  );
  rerender(
    scene(
      'normal',
      selectVehicle(fleet[0]!.vehicleId),
      undefined,
      scenario,
      population,
    ),
  );
  rerender(scene('mini', null, undefined, scenario, population));
  expect(map).toHaveAttribute('data-city-roof-instances', '0');
  unmount();
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'unavailable' });
});

it('keeps an empty population crop as cheap land context with no zero-capacity instance batch', () => {
  enableWorld();
  render(
    scene('mini', null, undefined, scenario, {
      ...population,
      canonicalCells: [],
    }),
  );
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-city-building-count', '0');
  expect(map).toHaveAttribute('data-city-building-instances', '0');
  expect(document.querySelector('instancedmesh[name^="city-"]')).toBeNull();
});

it('renders transport immediately while metadata loads, then retains generic fallback and stable framing', () => {
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'loading' });
  const { rerender } = render(
    scene('normal', null, undefined, scenario, population),
  );
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-city-building-count', '0');
  const camera = cameraState();
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'failed' });
  rerender(scene('normal', null, undefined, scenario, population));
  expect(Number(map.getAttribute('data-city-building-count'))).toBeGreaterThan(
    0,
  );
  expect(cameraState()).toEqual(camera);
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'unavailable' });
});

it('keeps route ribbons nonselectable and highlights only the selected canonical Route', () => {
  enableWorld();
  const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
  const { rerender, unmount } = render(
    scene('normal', selectRoute(route.routeId)),
  );
  const ribbons = [...document.querySelectorAll('mesh')].filter(
    (element) => sceneProps(element).raycast,
  );
  expect(ribbons.length).toBeGreaterThan(
    new Set(model.routes.map((edge) => edge.routeId)).size,
  );
  expect(
    ribbons.every((element) => sceneProps(element).raycast?.() === null),
  ).toBe(true);
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-selected-kind',
    'route',
  );
  rerender(scene('normal', selectStop(stop.stopPlaceId)));
  expect(document.querySelectorAll('cylindergeometry').length).toBeGreaterThan(
    0,
  );
  unmount();
  expect(dispose).toHaveBeenCalled();
});

it('rejects invalid, dragged, and mini StopPlace clicks but accepts exact instance selection', () => {
  enableWorld();
  onSelectionChange.mockClear();
  const { rerender } = render(scene('normal'));
  let platform = document.querySelectorAll('instancedmesh')[0]!;
  expect(chooseSceneObject(platform, { delta: 0 })).not.toHaveBeenCalled();
  expect(
    chooseSceneObject(platform, { instanceId: 0, delta: 6 }),
  ).not.toHaveBeenCalled();
  expect(
    chooseSceneObject(platform, { instanceId: model.stops.length, delta: 0 }),
  ).toHaveBeenCalled();
  expect(onSelectionChange).not.toHaveBeenCalled();
  expect(
    chooseSceneObject(platform, { instanceId: 1, delta: 0 }),
  ).toHaveBeenCalled();
  expect(onSelectionChange).toHaveBeenCalledWith(
    selectStop(model.stops[1]!.stopPlaceId),
  );
  rerender(scene('mini'));
  platform = document.querySelectorAll('instancedmesh')[0]!;
  onSelectionChange.mockClear();
  expect(
    chooseSceneObject(platform, { instanceId: 0, delta: 0 }),
  ).not.toHaveBeenCalled();
  expect(onSelectionChange).not.toHaveBeenCalled();
});

it('selects Vehicle meshes but ignores dragged and mini clicks and disposes geometry', () => {
  enableWorld();
  const dispose = vi.spyOn(BoxGeometry.prototype, 'dispose');
  onSelectionChange.mockClear();
  const { rerender, unmount } = render(
    scene('normal', selectVehicle(fleet[0]!.vehicleId)),
  );
  const body = [...document.querySelectorAll('mesh')].find(
    (element) => sceneProps(element).onClick,
  )!;
  expect(body).toBeDefined();
  expect(chooseSceneObject(body, { delta: 6 })).not.toHaveBeenCalled();
  expect(chooseSceneObject(body, { delta: 0 })).toHaveBeenCalled();
  expect(onSelectionChange).toHaveBeenCalledWith(
    selectVehicle(fleet[0]!.vehicleId),
  );
  rerender(scene('mini'));
  const miniBody = [...document.querySelectorAll('mesh')].find(
    (element) => sceneProps(element).onClick,
  )!;
  onSelectionChange.mockClear();
  expect(chooseSceneObject(miniBody, { delta: 0 })).not.toHaveBeenCalled();
  expect(onSelectionChange).not.toHaveBeenCalled();
  unmount();
  expect(dispose).toHaveBeenCalled();
});

it('keeps terrain and selected markers nonselectable in detailed and far LOD', () => {
  enableWorld();
  const { rerender } = render(scene('normal', selectStop(stop.stopPlaceId)));
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-lod',
    'medium',
  );
  const ignored = [...document.querySelectorAll('mesh')].filter(
    (element) => sceneProps(element).raycast,
  );
  expect(
    ignored.every((element) => sceneProps(element).raycast?.() === null),
  ).toBe(true);
  rerender(scene('mini', selectVehicle(fleet[0]!.vehicleId)));
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-lod',
    'far',
  );
  expect(document.querySelectorAll('instancedmesh')).toHaveLength(2);
  expect(
    [...document.querySelectorAll('mesh')]
      .filter((element) => sceneProps(element).raycast)
      .some((element) => sceneProps(element).raycast?.() === null),
  ).toBe(true);
  const terrain = [...document.querySelectorAll('mesh')].find(
    (element) => sceneProps(element).raycast,
  )!;
  expect(sceneProps(terrain).raycast?.()).toBeNull();
  rerender(scene('normal', selectVehicle(fleet[0]!.vehicleId)));
  const vehicleMarker = [...document.querySelectorAll('mesh')].find((element) =>
    [...element.querySelectorAll('cylindergeometry')].some(
      (shape) => sceneProps(shape) !== undefined,
    ),
  );
  expect(vehicleMarker).toBeDefined();
  expect(sceneProps(vehicleMarker!).raycast?.()).toBeNull();
});

it('restores an unchanged Route fit without inventing manual camera state', () => {
  const { rerender } = render(scene('normal', null, route.routeId));
  const original = cameraState();
  rerender(scene('mini', null, route.routeId));
  rerender(scene('normal', null, route.routeId));
  expect(cameraState()).toEqual(original);
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-camera-mode',
    'route-fit',
  );
});

it('shows an empty keyboard status when canonical nodes have no physical StopPlace or Vehicle', () => {
  const emptyScenario = {
    ...scenario,
    routes: { ...scenario.routes, routes: [] },
    stops: {
      ...scenario.stops,
      stopPlaces: [],
      stopNodes: scenario.stops.stopNodes.map((node) => ({
        ...node,
        stopPlaceId: null,
      })),
    },
  } as typeof scenario;
  render(
    <RepresentationModeProvider mode="normal">
      <D3dMapRepresentation
        scenario={emptyScenario}
        fleet={[]}
        selection={null}
        onSelectionChange={onSelectionChange}
      />
    </RepresentationModeProvider>,
  );
  const keyboard = screen.getByRole('group', { name: /3D Map selection/ });
  expect(keyboard).toHaveTextContent('No selectable objects');
  expect(screen.getByTestId('d3d-map-representation')).not.toHaveAttribute(
    'data-pointer-stop-id',
  );
  expect(screen.getByTestId('d3d-map-representation')).not.toHaveAttribute(
    'data-pointer-vehicle-id',
  );
  expect(screen.getByTestId('d3d-map-representation')).not.toHaveAttribute(
    'data-pointer-route-x',
  );
  onSelectionChange.mockClear();
  fireEvent.keyDown(keyboard, { key: 'Enter' });
  expect(onSelectionChange).not.toHaveBeenCalled();
});

it('handles pinch zoom, pointer cancellation, and wheel bounds without keeping stale pointers', () => {
  render(scene('normal'));
  const map = screen.getByTestId('d3d-map-representation');
  const initial = cameraState();
  pointer('pointermove', 200, 200);
  expect(cameraState()).toEqual(initial);
  pointer('pointerdown', 200, 200, 1);
  pointer('pointerdown', 200, 200, 2);
  pointer('pointermove', 200, 200, 1);
  expect(cameraState().zoom).toBe(initial.zoom);
  pointer('pointermove', 260, 200, 1);
  pointer('pointermove', 320, 200, 1);
  expect(cameraState().zoom).toBeGreaterThan(initial.zoom);
  pointer('pointercancel', 320, 200, 1);
  pointer('pointerup', 200, 200, 2);
  const after = cameraState();
  pointer('pointermove', 400, 300, 1);
  expect(cameraState()).toEqual(after);
  fireEvent.wheel(controls.canvas, { deltaY: -100000 });
  expect(Number(map.getAttribute('data-camera-zoom'))).toBe(
    fitD3dCamera(model, undefined, 1000, 660).maxZoom,
  );
  fireEvent.wheel(controls.canvas, { deltaY: 100000 });
  expect(Number(map.getAttribute('data-camera-zoom'))).toBe(
    fitD3dCamera(model, undefined, 1000, 660).minZoom,
  );
});

it('advances without profile records when presentation profiling is disabled', () => {
  vi.useFakeTimers();
  const mark = vi.spyOn(performance, 'mark');
  render(scene('normal'));
  act(() => vi.advanceTimersByTime(1000 / 60 + 1));
  expect(mark).not.toHaveBeenCalled();
});

const scene = (
  mode: 'normal' | 'mini',
  selection = null as ReturnType<typeof selectStop>,
  focusedRouteId?: typeof route.routeId,
  currentScenario = scenario,
  currentPopulation?: ScenarioPopulationView,
  currentFleet = fleet,
) => (
  <RepresentationModeProvider mode={mode}>
    <D3dMapRepresentation
      scenario={currentScenario}
      fleet={currentFleet}
      selection={selection}
      onSelectionChange={onSelectionChange}
      focusedRouteId={focusedRouteId}
      population={currentPopulation}
    />
  </RepresentationModeProvider>
);

const cameraState = () => {
  const map = screen.getByTestId('d3d-map-representation');
  return {
    targetX: Number(map.getAttribute('data-camera-target-x')),
    targetZ: Number(map.getAttribute('data-camera-target-z')),
    zoom: Number(map.getAttribute('data-camera-zoom')),
  };
};

it('fits the current Route after another Route replaces focus while D3D is mini', () => {
  const otherRoute = scenario.routes.routes[1]!;
  const { rerender } = render(scene('normal', null, route.routeId));
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 260, 220);
  pointer('pointerup', 260, 220);
  const saved = cameraState();
  rerender(scene('mini', null, route.routeId));
  rerender(scene('mini', null, otherRoute.routeId));
  rerender(scene('normal', null, otherRoute.routeId));
  const expected = fitD3dCamera(model, otherRoute.routeId, 1000, 660);
  expect(cameraState()).toEqual({
    targetX: expected.targetX,
    targetZ: expected.targetZ,
    zoom: expected.zoom,
  });
  expect(cameraState()).not.toEqual(saved);
});

it('fits the full network after Route focus is cleared while D3D is mini', () => {
  const { rerender } = render(scene('normal', null, route.routeId));
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 260, 220);
  pointer('pointerup', 260, 220);
  const saved = cameraState();
  rerender(scene('mini', null, route.routeId));
  rerender(scene('mini'));
  rerender(scene('normal'));
  const expected = fitD3dCamera(model, undefined, 1000, 660);
  expect(cameraState()).toEqual({
    targetX: expected.targetX,
    targetZ: expected.targetZ,
    zoom: expected.zoom,
  });
  expect(cameraState()).not.toEqual(saved);
});

it('restores the exact manual full-network camera when mini focus is unchanged', () => {
  const { rerender } = render(scene('normal'));
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 260, 220);
  pointer('pointerup', 260, 220);
  fireEvent.wheel(controls.canvas, { deltaY: -120 });
  const saved = cameraState();
  rerender(scene('mini'));
  rerender(scene('normal'));
  expect(cameraState()).toEqual(saved);
});

it('rejects an old camera when the scenario model changes while mini', () => {
  const replacement = {
    ...scenario,
    manifest: { ...scenario.manifest, scenarioId: 'replacement' },
  } as typeof scenario;
  const { rerender } = render(scene('normal'));
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 260, 220);
  pointer('pointerup', 260, 220);
  fireEvent.wheel(controls.canvas, { deltaY: -120 });
  const saved = cameraState();
  rerender(scene('mini'));
  rerender(scene('mini', null, undefined, replacement));
  rerender(scene('normal', null, undefined, replacement));
  const expected = fitD3dCamera(
    createD3dMapModel(createTransportMapProjection(replacement)),
    undefined,
    1000,
    660,
  );
  expect(cameraState()).toEqual({
    targetX: expected.targetX,
    targetZ: expected.targetZ,
    zoom: expected.zoom,
  });
  expect(cameraState()).not.toEqual(saved);
});

it.each([
  ['normal', '60'],
  ['mini', '5'],
] as const)(
  'uses the shared %s cadence and authoritative Map counts',
  (mode, fps) => {
    render(scene(mode));
    const map = screen.getByTestId('d3d-map-representation');
    expect(map).toHaveAttribute('data-representation-mode', mode);
    expect(map).toHaveAttribute('data-target-frames-per-second', fps);
    expect(map).toHaveAttribute(
      'data-scenario-id',
      scenario.manifest.scenarioId,
    );
    expect(
      Number(map.getAttribute('data-directed-edge-count')),
    ).toBeGreaterThan(0);
    expect(map).toHaveAttribute(
      'data-stop-place-count',
      String(scenario.stops.stopPlaces.length),
    );
    expect(map).toHaveAttribute('data-vehicle-count', '1');
    expect(screen.getByTestId('r3f-canvas')).toHaveAttribute(
      'data-frameloop',
      'never',
    );
    expect(
      screen.queryByText('Canvas 2D representation is unavailable.'),
    ).toBeNull();
  },
);

it('profiles actual manually advanced R3F frames without leaking WebGL elements into DOM tests', () => {
  vi.useFakeTimers();
  configureRepresentationProfiling(true);
  const mark = vi.spyOn(performance, 'mark');
  const measure = vi.spyOn(performance, 'measure');
  const errors = vi.spyOn(console, 'error');
  render(scene('normal'));
  act(() => vi.advanceTimersByTime(1000 / 60 + 1));
  expect(mark).toHaveBeenCalledWith(
    `${representationProfilePrefix}r3f.frame`,
    expect.anything(),
  );
  expect(measure).toHaveBeenCalledWith(
    `${representationProfilePrefix}r3f.advance`,
    expect.anything(),
  );
  expect(errors).not.toHaveBeenCalled();
});

it('exposes canonical selection and keyboard traversal in normal mode', () => {
  onSelectionChange.mockClear();
  const { rerender } = render(scene('normal', selectRoute(route.routeId)));
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-selected-kind', 'route');
  const keyboard = screen.getByRole('group', { name: /3D Map selection/ });
  fireEvent.keyDown(keyboard, { key: 'Home' });
  fireEvent.keyDown(keyboard, { key: 'Enter' });
  expect(onSelectionChange).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'stop' }),
  );
  fireEvent.keyDown(keyboard, { key: 'End' });
  fireEvent.keyDown(keyboard, { key: ' ' });
  expect(onSelectionChange).toHaveBeenCalledWith(
    selectVehicle(fleet[0]!.vehicleId),
  );
  rerender(scene('normal', selectStop(stop.stopPlaceId)));
  expect(map).toHaveAttribute('data-selected-kind', 'stop');
  rerender(scene('normal', selectVehicle(fleet[0]!.vehicleId)));
  expect(map).toHaveAttribute('data-selected-kind', 'vehicle');
  fireEvent.keyDown(keyboard, { key: 'ArrowUp' });
  fireEvent.keyDown(keyboard, { key: 'ArrowRight' });
  fireEvent.keyDown(keyboard, { key: 'ArrowLeft' });
  fireEvent.keyDown(keyboard, { key: 'ArrowDown' });
  fireEvent.keyDown(keyboard, { key: 'Escape' });
});

it('fits full and focused route cameras and handles bounded pointer pan and wheel zoom', () => {
  Object.defineProperty(controls.canvas, 'setPointerCapture', {
    value: vi.fn(),
    configurable: true,
  });
  const { rerender } = render(scene('normal'));
  const map = screen.getByTestId('d3d-map-representation');
  const fullZoom = Number(map.getAttribute('data-camera-zoom'));
  expect(fullZoom).toBeGreaterThan(0);
  pointer('pointerdown', 200, 200);
  pointer('pointermove', 250, 220);
  pointer('pointerup', 250, 220);
  expect(map).toHaveAttribute('data-camera-mode', 'manual');
  expect(Number(map.getAttribute('data-camera-target-x'))).not.toBe(0);
  act(() =>
    controls.canvas.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, cancelable: true }),
    ),
  );
  expect(Number(map.getAttribute('data-camera-zoom'))).toBeGreaterThan(
    fullZoom,
  );
  rerender(
    <RepresentationModeProvider mode="normal">
      <D3dMapRepresentation
        scenario={scenario}
        fleet={fleet}
        selection={null}
        onSelectionChange={onSelectionChange}
        focusedRouteId={route.routeId}
      />
    </RepresentationModeProvider>,
  );
  expect(map).toHaveAttribute('data-camera-mode', 'route-fit');
  rerender(scene('normal'));
  expect(map).toHaveAttribute('data-camera-mode', 'full');
});

it('keeps mini camera noninteractive and restores the normal view after a mini transition', () => {
  Object.defineProperty(controls.canvas, 'setPointerCapture', {
    value: vi.fn(),
    configurable: true,
  });
  const { rerender } = render(scene('normal'));
  const map = screen.getByTestId('d3d-map-representation');
  const fullZoom = Number(map.getAttribute('data-camera-zoom'));
  rerender(scene('mini'));
  expect(map).toHaveAttribute('data-camera-mode', 'full');
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 150, 100);
  act(() =>
    controls.canvas.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, cancelable: true }),
    ),
  );
  expect(Number(map.getAttribute('data-camera-zoom'))).toBe(fullZoom);
  rerender(scene('normal'));
  expect(Number(map.getAttribute('data-camera-zoom'))).toBe(fullZoom);
});

it('builds directed route ribbons and arrows while skipping degenerate edges', () => {
  const edge = model.routes[0]!;
  const degenerate = { ...edge, length: 0 };
  const ribbon = createD3dRibbonGeometry([edge, degenerate], 0.65, false);
  const arrows = createD3dRibbonGeometry([edge, degenerate], 0.9, true);
  expect(ribbon.getAttribute('position').count).toBe(6);
  expect(arrows.getAttribute('position').count).toBe(3);
  expect(
    Array.from(ribbon.getAttribute('position').array).every(Number.isFinite),
  ).toBe(true);
  ribbon.dispose();
  arrows.dispose();
});
