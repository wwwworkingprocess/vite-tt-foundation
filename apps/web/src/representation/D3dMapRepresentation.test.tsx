import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';

import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as r3f from '@react-three/fiber';
import {
  listActivePopulationCells,
  parseCityPopulationGrid,
  parseScenarioPackage,
  buildDirectedScenarioGraph,
} from '@torrevieja-tycoon/transport-domain';
import {
  parseVehicleId,
  type VehicleState,
} from '@torrevieja-tycoon/simulation';
import { RepresentationModeProvider } from './RepresentationModeContext.js';
import D3dMapRepresentation, {
  createD3dRibbonGeometry,
  writeD3dDiagnostics,
  writeD3dRenderedTerrain,
  createD3dCameraAcknowledgement,
  prioritiseD3dEntityHits,
} from './D3dMapRepresentation.js';
import { createTransportMapProjection } from './transport-map-projection.js';
import { d3dMetreScale, createD3dMapModel } from './d3d-map-model.js';
import { fitD3dCamera } from './d3d-map-model.js';
import type { ScenarioPopulationView } from '../population/population-field-loader.js';
import {
  BoxGeometry,
  BufferGeometry,
  OrthographicCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { parseRoutePresentation } from './route-presentation.js';
import { createRoutePresentationView } from './route-presentation-view.js';
import { buildProceduralCity } from './d3d-city-model.js';
import { useTerrain } from '../terrain/use-terrain.js';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
vi.mock('../terrain/use-terrain.js', () => ({
  useTerrain: vi.fn(() => ({ status: 'unavailable' })),
}));
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
      frame?: (() => void) | undefined;
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
  controls.frame = undefined;
  controls.eventConnect.mockClear();
  for (const property of [
    'setMatrixAt',
    'setColorAt',
    'instanceMatrix',
    'instanceColor',
    'computeBoundingSphere',
    'scale',
  ])
    Reflect.deleteProperty(HTMLElement.prototype, property);
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  configureRepresentationProfiling(false);
  clearRepresentationProfiles();
  vi.mocked(useTerrain).mockReturnValue({ status: 'unavailable' });
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'unavailable' });
});

it('uses screen-sized vehicle HUDs at far, medium and near LOD and preserves canonical click authority', () => {
  enableWorld();
  const set = vi.fn();
  Object.assign(HTMLElement.prototype, { scale: { set } });
  const rendered = render(scene('normal'));
  const check = (pixels: number, ratio: number) => {
    const hud = document.querySelector('sprite[name="vehicle-hud"]')!;
    const properties = sceneProps(hud) as {
      onBeforeRender: (
        renderer: unknown,
        scene: unknown,
        camera: OrthographicCamera,
      ) => void;
    };
    properties.onBeforeRender(
      undefined,
      undefined,
      new OrthographicCamera(-10, 10, 10, -10),
    );
    expect(set).toHaveBeenLastCalledWith(
      (pixels * 20) / 660,
      ((pixels * 20) / 660) * ratio,
      1,
    );
    onSelectionChange.mockClear();
    chooseSceneObject(hud, { delta: 0 });
    expect(onSelectionChange).toHaveBeenCalledWith(
      selectVehicle(fleet[0]!.vehicleId),
    );
  };
  check(12, 0.7);
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  rendered.rerender(scene('normal', selectVehicle(fleet[0]!.vehicleId)));
  check(14, 0.7);
  fireEvent.wheel(controls.canvas, { deltaY: 10000 });
  check(6, 1);
  rendered.rerender(scene('mini'));
  const hud = document.querySelector('sprite[name="vehicle-hud"]')!;
  const properties = sceneProps(hud) as {
    onBeforeRender: (
      renderer: unknown,
      scene: unknown,
      camera: OrthographicCamera,
    ) => void;
  };
  properties.onBeforeRender(
    undefined,
    undefined,
    new OrthographicCamera(-10, 10, 10, -10),
  );
  expect(set).toHaveBeenLastCalledWith((6 * 20) / 660, (6 * 20) / 660, 1);
  onSelectionChange.mockClear();
  expect(chooseSceneObject(hud, { delta: 0 })).not.toHaveBeenCalled();
});

it('projects every source vertex into low ground ribbons with selected alpha and disposes cached geometry', () => {
  enableWorld();
  const directory = join(root, '..', 'torrevieja-legacy-all-v1');
  const data = (name: string) =>
    JSON.parse(readFileSync(join(directory, name), 'utf8')) as unknown;
  const all = parseScenarioPackage({
    manifest: data('scenario.json'),
    settlements: data('settlements.json'),
    routes: data('routes.json'),
    stops: data('stops.json'),
  });
  const asset = parseRoutePresentation(
    JSON.parse(
      readFileSync(
        join(
          root,
          '../../../route-presentation/torrevieja/torrevieja-route-presentation.v0.json',
        ),
        'utf8',
      ),
    ) as unknown,
    all,
  );
  const view = createRoutePresentationView(
    createTransportMapProjection(all),
    asset,
  );
  const props = {
    scenario: all,
    fleet,
    selection: null,
    onSelectionChange,
    routePresentation: view,
  };
  const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
  const rendered = render(<D3dMapRepresentation {...props} />);
  const materials = [...document.querySelectorAll('meshbasicmaterial')].filter(
    (m) => m.getAttribute('color') === '#D32F2F',
  );
  expect(materials[0]).toHaveAttribute('opacity', '0.8');
  const geometry = sceneProps(materials[0]!.parentElement!).geometry!;
  const positions = geometry.getAttribute('position');
  expect(positions.count).toBeGreaterThan(6 * 42);
  expect(positions.getY(0)).toBeCloseTo(0.1);
  rendered.rerender(
    <D3dMapRepresentation
      {...props}
      selection={selectRoute(all.routes.routes[0]!.routeId)}
    />,
  );
  expect(
    [...document.querySelectorAll('meshbasicmaterial')].find(
      (m) => m.getAttribute('color') === '#D32F2F',
    ),
  ).toHaveAttribute('opacity', '1');
  rendered.unmount();
  expect(dispose).toHaveBeenCalled();
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
  ] as {
    onClick?: (event: unknown) => void;
    raycast?: () => unknown;
    geometry?: BufferGeometry;
    material?: import('three').Material;
    onBeforeRender?: () => void;
  };

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
  expect(document.querySelectorAll('instancedmesh')).toHaveLength(1);
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
  const landscape = sceneProps(
    document.querySelector('mesh[name="research-landscape"]')!,
  ).geometry!;
  expect(landscape.getAttribute('position').count).toBeGreaterThan(0);
  expect(
    buildProceduralCity(model, population, readyView).landscapes!.some(
      (surface) => surface.kind === 'water',
    ),
  ).toBe(true);
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
  expect(
    document.querySelector('mesh[name="stop-selection-ring"]'),
  ).not.toBeNull();
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
  expect(document.querySelectorAll('instancedmesh')).toHaveLength(1);
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

it('uses a terrain-ready native scene while retaining entity selection and static geometry on fleet/selection updates', () => {
  const { setMatrixAt } = enableWorld();
  const f = terrainFixture();
  const resolved = resolveTerrainViewport(
    parseTerrainCatalog(f.catalog),
    'test',
    'a',
  )!;
  const terrain = terrainJsonDecoder.decode(f, resolved);
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
  const view = render(scene('normal'));
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-status',
    'ready',
  );
  expect(
    document.querySelectorAll('mesh[name="native-terrain-land"]'),
  ).toHaveLength(1);
  expect(
    document.querySelectorAll('mesh[name="native-terrain-water"]'),
  ).toHaveLength(1);
  expect(setMatrixAt).toHaveBeenCalled();
  for (const mesh of document.querySelectorAll('mesh[name^="native-terrain-"]'))
    sceneProps(mesh).onBeforeRender?.();
  const count = dispose.mock.calls.length;
  const builds = screen
    .getByTestId('d3d-map-representation')
    .getAttribute('data-terrain-geometry-builds');
  view.rerender(scene('normal', selectVehicle(fleet[0]!.vehicleId)));
  expect(dispose.mock.calls.length).toBe(count);
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-geometry-builds',
    builds,
  );
});

it('grounds transport and selection on ready terrain while preserving pan/focus and replacing the cheap mini plan', () => {
  const { setMatrixAt } = enableWorld();
  const f = terrainFixture();
  const b = f.catalog.settlements.test.viewports[0]!.rasterBounds3035;
  Object.assign(b, {
    west: 3300000,
    south: 1650000,
    east: 3450000,
    north: 1800000,
  });
  f.catalog.settlements.test.resolutionMeters = { x: 50000, y: 50000 };
  for (const product of [f.height, f.surfaceMask]) {
    product.resolutionMetersX = 50000;
    product.resolutionMetersY = 50000;
  }
  f.height.viewports[0]!.elevations.fill(10);
  f.surfaceMask.viewports[0]!.cells.fill(1);
  const terrain = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  const view = render(
    scene(
      'normal',
      selectStop(stop.stopPlaceId),
      undefined,
      scenario,
      population,
    ),
  );
  const initialBuilds = Number(
    screen
      .getByTestId('d3d-map-representation')
      .getAttribute('data-terrain-geometry-builds'),
  );
  const ground = 100 * d3dMetreScale(model).worldUnitsPerMetre;
  expect(
    setMatrixAt.mock.calls.some(
      ([, matrix]) => Math.abs(matrix.elements[13] - ground) < 1e-7,
    ),
  ).toBe(true);
  const ribbon = [...document.querySelectorAll('mesh')]
    .map((m) => sceneProps(m).geometry)
    .find(
      (g) =>
        g &&
        g.getAttribute('position')?.count &&
        !g.index &&
        !g.getAttribute('color'),
    )!;
  expect(ribbon.getAttribute('position').getY(0)).toBeGreaterThan(ground);
  expect(
    [...document.querySelectorAll('mesh')]
      .filter((m) => sceneProps(m).raycast)
      .every((m) => sceneProps(m).raycast?.() === null),
  ).toBe(true);
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 25, 25);
    pointer('pointerup', 25, 25);
  });
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-camera-mode',
    'manual',
  );
  view.rerender(
    scene(
      'normal',
      selectRoute(route.routeId),
      route.routeId,
      scenario,
      population,
    ),
  );
  expect(
    Number(
      screen
        .getByTestId('d3d-map-representation')
        .getAttribute('data-terrain-geometry-builds'),
    ),
  ).toBeGreaterThanOrEqual(initialBuilds);
  const focusedBuilds = screen
    .getByTestId('d3d-map-representation')
    .getAttribute('data-terrain-geometry-builds');
  view.rerender(
    scene(
      'normal',
      selectVehicle(fleet[0]!.vehicleId),
      route.routeId,
      scenario,
      population,
    ),
  );
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-geometry-builds',
    focusedBuilds,
  );
  const vehicleBody = [...document.querySelectorAll('mesh')].find(
    (m) => sceneProps(m).onClick,
  )!;
  const groupProps = sceneProps(vehicleBody.parentElement!) as unknown as {
    position: readonly number[];
  };
  expect(groupProps.position[1]).toBeGreaterThan(ground);
  view.rerender(
    scene('normal', null, undefined, scenario, population, [...fleet]),
  );
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-geometry-builds',
    String(initialBuilds + 2),
  );
  const fullBuilds = Number(
    screen
      .getByTestId('d3d-map-representation')
      .getAttribute('data-terrain-geometry-builds'),
  );
  view.rerender(scene('mini', null, undefined, scenario, population));
  expect(document.querySelector('mesh[name="research-landscape"]')).toBeNull();
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-geometry-builds',
    String(fullBuilds + 1),
  );
  view.unmount();
});
it('exposes optional terrain failure without removing transport selection', () => {
  vi.mocked(useTerrain).mockReturnValue({
    status: 'error',
    message: 'Terrain raster rejected',
  });
  render(scene('normal'));
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-error',
    'Terrain raster rejected',
  );
  expect(
    screen.getByRole('group', { name: /3D Map selection/ }),
  ).toBeInTheDocument();
});

it('retains canonical Vehicle pick priority over overlapping terrain-height Stop targets without mutating hit identities or distance order', () => {
  const stopHit = { object: { name: 'stop-hit-targets' }, distance: 1 };
  const hudHit = { object: { name: 'vehicle-hud' }, distance: 2 };
  const bodyHit = { object: { name: 'vehicle-body' }, distance: 3 };
  const stopPlatform = { object: { name: 'stop-platform' }, distance: 4 };
  const hits = [stopHit, hudHit, bodyHit, stopPlatform];
  expect(prioritiseD3dEntityHits(hits)).toEqual([
    hudHit,
    bodyHit,
    stopHit,
    stopPlatform,
  ]);
  expect(hits).toEqual([stopHit, hudHit, bodyHit, stopPlatform]);
  expect(prioritiseD3dEntityHits([])).toEqual([]);
});

it('preserves a manual camera and active drag across LOD, selection and fleet updates', () => {
  const view = render(scene('normal'));
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 30, 20);
  });
  const moved = cameraState();
  view.rerender(
    scene(
      'normal',
      selectVehicle(fleet[0]!.vehicleId),
      undefined,
      scenario,
      undefined,
      [...fleet],
    ),
  );
  expect(cameraState()).toEqual(moved);
  act(() => {
    pointer('pointermove', 50, 30);
    pointer('pointerup', 50, 30);
    fireEvent.wheel(controls.canvas, { deltaY: -1000 });
  });
  expect(cameraState().targetX).not.toBe(moved.targetX);
  expect(cameraState().zoom).toBeGreaterThan(moved.zoom);
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-camera-mode',
    'manual',
  );
  view.unmount();
});

it('retains manual terrain pan/zoom when the workspace viewport resizes after input', () => {
  const state = r3f.useThree();
  let height = state.size.height;
  vi.spyOn(r3f, 'useThree').mockImplementation((selector) => {
    const resized = { ...state, size: { ...state.size, height } };
    return selector ? selector(resized) : resized;
  });
  const view = render(scene('normal'));
  const automatic = cameraState();
  height += 20;
  view.rerender(scene('normal'));
  expect(cameraState().zoom).toBeLessThan(automatic.zoom);
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-camera-mode',
    'full',
  );
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 40, 25);
    pointer('pointerup', 40, 25);
    fireEvent.wheel(controls.canvas, { deltaY: -200 });
  });
  const manual = cameraState();
  height += 100;
  view.rerender(scene('normal'));
  expect(cameraState()).toEqual(manual);
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-camera-mode',
    'manual',
  );
  const f = terrainFixture();
  const terrain = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  view.rerender(scene('normal'));
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-camera-mode',
    'full',
  );
  expect(cameraState()).not.toEqual(manual);
  view.unmount();
});

it('publishes read-only completed-frame camera coordinates through the existing cadence', () => {
  onSelectionChange.mockClear();
  vi.useFakeTimers();
  render(scene('normal'));
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 40, 25);
    pointer('pointerup', 40, 25);
    fireEvent.wheel(controls.canvas, { deltaY: -200 });
    vi.advanceTimersByTime(1000 / 60 + 1);
  });
  const map = screen.getByTestId('d3d-map-representation');
  for (const coordinate of ['zoom', 'target-x', 'target-z'])
    expect(
      Number(map.getAttribute('data-rendered-camera-' + coordinate)),
    ).toBeCloseTo(Number(map.getAttribute('data-camera-' + coordinate)), 10);
  expect(onSelectionChange).not.toHaveBeenCalled();
});

it('replays camera diagnostics on the first frame after the DOM host is reattached, retaining manual intent', () => {
  vi.useFakeTimers();
  const view = render(scene('normal'));
  const map = screen.getByTestId('d3d-map-representation');
  map.removeAttribute('data-camera-mode');
  act(() => vi.advanceTimersByTime(1000 / 60 + 1));
  expect(map).toHaveAttribute('data-camera-mode', 'full');
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 40, 25);
    pointer('pointerup', 40, 25);
  });
  const manual = cameraState();
  map.removeAttribute('data-camera-mode');
  act(() => vi.advanceTimersByTime(1000 / 60 + 1));
  expect(map).toHaveAttribute('data-camera-mode', 'manual');
  expect(cameraState()).toEqual(manual);
  const detachedFrame = controls.frame;
  view.unmount();
  expect(() => detachedFrame?.()).not.toThrow();
});

it('acknowledges an attached or replaced host even when rendered camera coordinates stay unchanged', () => {
  const acknowledge = createD3dCameraAcknowledgement();
  const camera = { zoom: 2, position: { x: 10, z: 20 } };
  const first = document.createElement('section');
  const second = document.createElement('section');
  acknowledge(null, camera);
  acknowledge(first, camera);
  expect(first).toHaveAttribute('data-rendered-camera-zoom', '2');
  acknowledge(first, camera);
  expect(first).toHaveAttribute('data-rendered-camera-zoom', '2');
  camera.zoom = 3;
  acknowledge(first, camera);
  expect(first).toHaveAttribute('data-rendered-camera-zoom', '3');
  acknowledge(second, camera);
  expect(second).toHaveAttribute('data-rendered-camera-zoom', '3');
  acknowledge(null, camera);
  acknowledge(second, camera);
  expect(second).toHaveAttribute(
    'data-rendered-camera-target-x',
    first.getAttribute('data-rendered-camera-target-x'),
  );
});

it('reinitializes the Canvas only when native terrain replaces fallback, retaining canonical selection and static native geometry', () => {
  vi.mocked(useTerrain).mockReturnValue({ status: 'loading' });
  const view = render(scene('normal', selectVehicle(fleet[0]!.vehicleId)));
  const fallbackCanvas = screen.getByTestId('r3f-canvas');
  act(() => fireEvent.wheel(controls.canvas, { deltaY: -4000 }));
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-city-lod',
    'near',
  );
  const f = terrainFixture();
  Object.assign(f.catalog.settlements.test.viewports[0]!.rasterBounds3035, {
    west: 3300000,
    south: 1650000,
    east: 3450000,
    north: 1800000,
  });
  f.catalog.settlements.test.resolutionMeters = { x: 50000, y: 50000 };
  for (const product of [f.height, f.surfaceMask]) {
    product.resolutionMetersX = 50000;
    product.resolutionMetersY = 50000;
  }
  const terrain = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  view.rerender(scene('normal', selectVehicle(fleet[0]!.vehicleId)));
  const nativeCanvas = screen.getByTestId('r3f-canvas');
  expect(nativeCanvas).not.toBe(fallbackCanvas);
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-city-lod',
    'far',
  );
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-selected-kind',
    'vehicle',
  );
  const builds = screen
    .getByTestId('d3d-map-representation')
    .getAttribute('data-terrain-geometry-builds');
  view.rerender(scene('normal', selectStop(stop.stopPlaceId)));
  expect(screen.getByTestId('r3f-canvas')).toBe(nativeCanvas);
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-geometry-builds',
    builds,
  );
});

it('keeps CPU raycasting aligned with published Stop targets before the first draw and immediately after pan', () => {
  const state = r3f.useThree();
  const camera = new OrthographicCamera();
  vi.spyOn(r3f, 'useThree').mockImplementation((selector) => {
    const realCameraState = { ...state, camera };
    return selector ? selector(realCameraState) : realCameraState;
  });
  const view = render(scene('normal'));
  const stop = model.stops.at(-1)!;
  const map = screen.getByTestId('d3d-map-representation');
  const check = () => {
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      new Vector2(
        Number(map.getAttribute('data-pointer-stop-x')) / 500 - 1,
        1 - Number(map.getAttribute('data-pointer-stop-y')) / 330,
      ),
      camera,
    );
    expect(
      raycaster.ray.distanceToPoint(new Vector3(stop.x, 0.045, stop.z)),
    ).toBeLessThan(1e-8);
  };
  check();
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 40, 25);
    pointer('pointerup', 40, 25);
  });
  check();
  view.unmount();
});

it('marks a native terrain source only after its mesh draws and safely skips repeated or detached hosts', () => {
  enableWorld();
  const f = terrainFixture();
  const terrain = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  const view = render(scene('normal'));
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).not.toHaveAttribute('data-rendered-terrain-identity');
  const draw = sceneProps(
    document.querySelector('mesh[name="native-terrain-land"]')!,
  ) as unknown as { onAfterRender: () => void };
  draw.onAfterRender();
  draw.onAfterRender();
  expect(map).toHaveAttribute(
    'data-rendered-terrain-identity',
    terrain.identity,
  );
  expect(map).toHaveAttribute(
    'data-rendered-terrain-viewport',
    terrain.viewport.terrainViewportId,
  );
  writeD3dRenderedTerrain(map, 'replacement', 'another-viewport');
  expect(map).toHaveAttribute('data-rendered-terrain-identity', 'replacement');
  view.unmount();
  expect(() => draw.onAfterRender()).not.toThrow();
});

it('draws dirty visual updates and camera input but leaves a static scene idle', () => {
  vi.useFakeTimers();
  configureRepresentationProfiling(true);
  const mark = vi.spyOn(performance, 'mark');
  const view = render(scene('normal'));
  act(() => vi.advanceTimersByTime(18));
  const initial = mark.mock.calls.filter(
    ([name]) => name === representationProfilePrefix + 'r3f.frame',
  ).length;
  expect(initial).toBe(1);
  act(() => vi.advanceTimersByTime(1000));
  expect(
    mark.mock.calls.filter(
      ([name]) => name === representationProfilePrefix + 'r3f.frame',
    ),
  ).toHaveLength(initial);
  view.rerender(scene('normal', selectVehicle(fleet[0]!.vehicleId)));
  act(() => vi.advanceTimersByTime(18));
  expect(
    mark.mock.calls.filter(
      ([name]) => name === representationProfilePrefix + 'r3f.frame',
    ),
  ).toHaveLength(initial + 1);
  act(() => {
    fireEvent.wheel(controls.canvas, { deltaY: -1 });
    vi.advanceTimersByTime(18);
  });
  expect(
    mark.mock.calls.filter(
      ([name]) => name === representationProfilePrefix + 'r3f.frame',
    ),
  ).toHaveLength(initial + 2);
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-renderer-calls', '0');
  expect(map).toHaveAttribute('data-renderer-triangles', '0');
  expect(map).toHaveAttribute('data-renderer-geometries', '0');
});

it('safely finishes a dirty frame when its DOM host detaches during rendering', () => {
  vi.useFakeTimers();
  const state = r3f.useThree();
  let detach = () => {};
  vi.spyOn(r3f, 'useThree').mockImplementation((selector) => {
    const detachedState = { ...state, advance: () => detach() };
    return selector ? selector(detachedState) : detachedState;
  });
  const view = render(scene('normal'));
  detach = view.unmount;
  expect(() => act(() => vi.advanceTimersByTime(18))).not.toThrow();
  expect(screen.queryByTestId('d3d-map-representation')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('draws an accepted moving fleet pose above terrain without rebuilding its static buffers', () => {
  vi.useFakeTimers();
  enableWorld();
  const f = terrainFixture();
  Object.assign(f.catalog.settlements.test.viewports[0]!.rasterBounds3035, {
    west: 3300000,
    south: 1650000,
    east: 3450000,
    north: 1800000,
  });
  f.catalog.settlements.test.resolutionMeters = { x: 50000, y: 50000 };
  for (const p of [f.height, f.surfaceMask]) {
    p.resolutionMetersX = 50000;
    p.resolutionMetersY = 50000;
  }
  f.height.viewports[0]!.elevations.fill(10);
  f.surfaceMask.viewports[0]!.cells.fill(1);
  const terrain = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  const selected = selectVehicle(fleet[0]!.vehicleId);
  const view = render(scene('normal', selected));
  act(() => vi.advanceTimersByTime(18));
  const map = screen.getByTestId('d3d-map-representation');
  const builds = map.getAttribute('data-terrain-geometry-builds');
  const frames = Number(map.getAttribute('data-renderer-frames'));
  const pose = () =>
    (
      sceneProps(
        document.querySelector('mesh[name="vehicle-body"]')!.parentElement!,
      ) as unknown as { position: readonly number[] }
    ).position;
  const parked = [...pose()];
  const edge = buildDirectedScenarioGraph(scenario).edges.find(
    (e) => e.patternId === pattern.patternId,
  )!;
  const moving: VehicleState = {
    ...fleet[0]!,
    movement: {
      kind: 'running-on-edge',
      edgeId: edge.edgeId,
      edgeSequence: 0,
      fromStopNodeId: edge.fromStopNodeId,
      toStopNodeId: edge.toStopNodeId,
      progressTicks: 5,
      travelTicks: 10,
    },
  };
  view.rerender(
    scene('normal', selected, undefined, scenario, undefined, [moving]),
  );
  act(() => vi.advanceTimersByTime(40));
  expect(map).toHaveAttribute('data-vehicle-movement-kind', 'running-on-edge');
  expect(pose()).not.toEqual(parked);
  expect(pose()[1]).toBeGreaterThan(
    10 * d3dMetreScale(model).worldUnitsPerMetre,
  );
  expect(map).toHaveAttribute('data-terrain-geometry-builds', builds);
  expect(Number(map.getAttribute('data-renderer-frames'))).toBe(frames + 1);
});

it('uses native detail and a viewport grid only at the normal maximum zoom, updating it after pan', () => {
  enableWorld();
  const f = terrainFixture(),
    terrain = terrainJsonDecoder.decode(
      f,
      resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
    );
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  const view = render(scene('normal'));
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-terrain-elevation-scale', '10');
  expect(map).toHaveAttribute('data-terrain-grid-visible', 'false');
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  expect(map).toHaveAttribute('data-terrain-render-stride', '1');
  expect(map).toHaveAttribute('data-camera-maximum-zoom', 'true');
  expect(Number(map.getAttribute('data-camera-zoom'))).toBe(
    Number(map.getAttribute('data-camera-max-zoom')),
  );
  expect(map).toHaveAttribute('data-terrain-grid-visible', 'true');
  const grid = document.querySelector(
    'linesegments[name="native-terrain-grid"]',
  )!;
  expect(grid).not.toBeNull();
  expect(sceneProps(grid).raycast?.()).toBeNull();
  const builds = map.getAttribute('data-terrain-geometry-builds');
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 30, 40);
    pointer('pointerup', 30, 40);
  });
  expect(map).toHaveAttribute('data-terrain-geometry-builds', builds);
  view.rerender(scene('mini'));
  expect(map).toHaveAttribute('data-terrain-grid-visible', 'false');
  view.rerender(scene('normal'));
  expect(map).toHaveAttribute('data-terrain-grid-visible', 'true');
  fireEvent.wheel(controls.canvas, { deltaY: 100 });
  expect(map).toHaveAttribute('data-terrain-grid-visible', 'false');
});

it('updates stop pick floors for zoom changes inside one LOD without rebuilding terrain or disks', () => {
  const { setMatrixAt } = enableWorld();
  render(scene('normal'));
  const target = document.querySelector(
    'instancedmesh[name="stop-hit-targets"]',
  )!;
  const draw = sceneProps(target).onBeforeRender!;
  const disks = sceneProps(
    document.querySelector('mesh[name="stop-disks"]')!,
  ).geometry;
  const count = setMatrixAt.mock.calls.length;
  draw();
  expect(setMatrixAt.mock.calls.length).toBe(count);
  const state = r3f.useThree();
  state.camera.zoom *= 1.1;
  draw();
  expect(setMatrixAt.mock.calls.length).toBe(count + model.stops.length);
  expect(
    sceneProps(document.querySelector('mesh[name="stop-disks"]')!).geometry,
  ).toBe(disks);
  draw();
  expect(setMatrixAt.mock.calls.length).toBe(count + model.stops.length);
});

it('owns and disposes shared stop and grid materials once, independently of geometry swaps', () => {
  enableWorld();
  const f = terrainFixture(),
    terrain = terrainJsonDecoder.decode(
      f,
      resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
    );
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  const view = render(scene('normal', selectStop(stop.stopPlaceId)));
  const material = sceneProps(
    document.querySelector('mesh[name="stop-disks"]')!,
  ).material;
  expect(material).toBeDefined();
  expect(
    sceneProps(document.querySelector('mesh[name="stop-selection-ring"]')!)
      .material,
  ).toBe(material);
  const stopDispose = vi.spyOn(material!, 'dispose');
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  const gridMaterial = sceneProps(
    document.querySelector('linesegments[name="native-terrain-grid"]')!,
  ).material;
  expect(gridMaterial).toBeDefined();
  const gridDispose = vi.spyOn(gridMaterial!, 'dispose');
  fireEvent.wheel(controls.canvas, { deltaY: 100 });
  expect(gridDispose).not.toHaveBeenCalled();
  view.unmount();
  expect(stopDispose).toHaveBeenCalledTimes(1);
  expect(gridDispose).toHaveBeenCalledTimes(1);
});

it('retains an active drag across viewport listener rebinding and cancels it on mini transition', () => {
  const state = r3f.useThree();
  let height = state.size.height;
  vi.spyOn(r3f, 'useThree').mockImplementation((selector) => {
    const resized = { ...state, size: { ...state.size, height } };
    return selector ? selector(resized) : resized;
  });
  const view = render(scene('normal'));
  act(() => pointer('pointerdown', 10, 10));
  height += 100;
  view.rerender(scene('normal'));
  const before = cameraState();
  act(() => pointer('pointermove', 60, 30));
  expect(cameraState()).not.toEqual(before);
  act(() => pointer('pointerup', 60, 30));
  act(() => pointer('pointerdown', 10, 10));
  view.rerender(scene('mini'));
  view.rerender(scene('normal'));
  const restored = cameraState();
  act(() => pointer('pointermove', 100, 100));
  expect(cameraState()).toEqual(restored);
});
