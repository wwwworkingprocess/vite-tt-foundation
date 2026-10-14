import { useCityMaterialization } from './use-city-materialization.js';
import { createCityMaterializationLoader } from './city-materialization-loader.js';
import * as sitePlanning from './d3d-materialization.js';
import { createHash } from 'node:crypto';
vi.mock('./use-city-materialization.js', () => ({
  useCityMaterialization: vi.fn(() => ({ status: 'inactive' })),
}));
import * as appSettings from './d3d-app-settings.js';
const resolveSettings = appSettings.resolveD3dAppSettings;
import * as terrainGrid from './d3d-terrain-grid.js';
import * as terrainPlanning from './d3d-terrain-model.js';
import {
  buildStreetCellCity,
  streetCellLandmarkProtections,
} from './d3d-street-cell-city.js';
import {
  cellCityCells,
  cellCityPopulation,
  cellCityTerrain,
} from '../test/street-cell-city-fixture.js';
import { useStreetCells } from './use-street-cells.js';
import { decodeStreetCells, parseStreetCellCatalog } from './street-cells.js';
import {
  streetCellFixture,
  streetCellJson,
  withStreetCellZones,
} from '../test/street-cells-fixture.js';
vi.mock('./use-street-cells.js', () => ({
  useStreetCells: vi.fn(() => ({ status: 'inactive' })),
}));
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
  parseScenarioManifest,
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
import * as cityGeometry from './d3d-city-geometry.js';
import { buildProceduralCity } from './d3d-city-model.js';
import { useRoadNetwork } from './use-road-network.js';
import type { RoadNetwork } from './road-network.js';
vi.mock('./use-road-network.js', () => ({
  useRoadNetwork: vi.fn(() => ({ status: 'absent' })),
}));
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
  vi.mocked(useCityMaterialization).mockReturnValue({ status: 'inactive' });
  vi.mocked(useStreetCells).mockReturnValue({ status: 'inactive' });
  vi.mocked(useRoadNetwork).mockReturnValue({ status: 'absent' });
  controls.renderWorld = false;
  controls.frame = undefined;
  controls.eventConnect.mockClear();
  cleanup();
  for (const property of [
    'setMatrixAt',
    'setColorAt',
    'instanceMatrix',
    'instanceColor',
    'computeBoundingSphere',
    'dispose',
    'scale',
  ])
    Reflect.deleteProperty(HTMLElement.prototype, property);
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
    args?: readonly [BufferGeometry, import('three').Material, number];
    material?: import('three').Material;
    onBeforeRender?: () => void;
    onAfterRender?: () => void;
    children?: readonly Readonly<{
      props: {
        onLod?: (level: 'far' | 'medium' | 'near') => void;
        onRoadInvalidated?: () => void;
        onStreetCellsInvalidated?: () => void;
      };
    }>[];
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
  // The R3F test bridge uses DOM nodes for Three tags; ignore only this expected
  // React casing notice, forwarding all other errors unchanged.
  const error = console.error;
  vi.spyOn(console, 'error').mockImplementation(
    (message: unknown, ...args: unknown[]) => {
      if (
        typeof message === 'string' &&
        message.includes('is using incorrect casing.')
      )
        return;
      error(message, ...args);
    },
  );
  const setMatrixAt = vi.fn();
  const setColorAt = vi.fn();
  const computeBoundingSphere = vi.fn();
  Object.assign(HTMLElement.prototype, {
    setMatrixAt,
    setColorAt,
    computeBoundingSphere,
    dispose: vi.fn(),
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
    scene('normal', null, undefined, genericScenario, population),
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
  rerender(
    scene('normal', null, undefined, genericScenario, population, [...fleet]),
  );
  expect(setMatrixAt).toHaveBeenCalledTimes(staticCalls);
  expect(computeBoundingSphere).toHaveBeenCalledTimes(staticBounds);
  fireEvent.wheel(controls.canvas, { deltaY: 10000 });
  expect(map).toHaveAttribute('data-city-lod', 'far');
  expect(map).toHaveAttribute(
    'data-city-building-instances',
    String(city.far.length),
  );
  expect(map).toHaveAttribute('data-city-roof-instances', '0');
  rerender(scene('mini', null, undefined, genericScenario, population));
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
    ...genericScenario,
    manifest: {
      ...genericScenario.manifest,
      scenarioId: 'population-replacement',
    },
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
const cellOwnedPopulation = { ...population, ...cellCityPopulation };
// Shared real-data fixture preparation is outside individual interaction cases.
buildStreetCellCity(model, cellOwnedPopulation, readyView, cellCityCells);

it('exposes research diagnostics and keeps scaled city surfaces outside entity hit targets', () => {
  enableWorld();
  vi.mocked(useSettlementMetadata).mockReturnValue(readyView);
  const { unmount } = render(
    scene('normal', null, undefined, genericScenario, population),
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
  unmount();
});

it('preserves research surfaces through medium/near selection and mini lifecycle transitions', () => {
  enableWorld();
  vi.mocked(useSettlementMetadata).mockReturnValue(readyView);
  const { rerender, unmount } = render(
    scene('normal', null, undefined, scenario, population),
  );
  const map = screen.getByTestId('d3d-map-representation');
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
    scene('normal', null, undefined, genericScenario, population),
  );
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-city-building-count', '0');
  const camera = cameraState();
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'failed' });
  rerender(scene('normal', null, undefined, genericScenario, population));
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

it('pans with two fingers, ends lost capture, and suppresses gesture clicks while allowing taps', () => {
  render(scene('normal'));
  const clicked = vi.fn();
  controls.canvas.addEventListener('click', clicked);
  const initial = cameraState();
  pointer('pointerdown', 200, 200, 1);
  pointer('pointerdown', 300, 200, 2);
  pointer('pointermove', 220, 220, 1);
  pointer('pointermove', 320, 220, 2);
  expect(cameraState().targetX).not.toBe(initial.targetX);
  pointer('pointerup', 220, 220, 1);
  pointer('pointerup', 320, 220, 2);
  fireEvent.click(controls.canvas);
  expect(clicked).not.toHaveBeenCalled();
  pointer('pointerdown', 220, 220);
  pointer('pointerup', 220, 220);
  fireEvent.click(controls.canvas);
  expect(clicked).toHaveBeenCalledTimes(1);
  pointer('pointerdown', 220, 220);
  pointer('pointermove', 250, 250);
  pointer('lostpointercapture', 250, 250);
  const after = cameraState();
  pointer('pointermove', 400, 400);
  expect(cameraState()).toEqual(after);
  fireEvent.click(controls.canvas);
  expect(clicked).toHaveBeenCalledTimes(1);
  controls.canvas.removeEventListener('click', clicked);
});

it('advances without profile records when presentation profiling is disabled', () => {
  vi.useFakeTimers();
  const mark = vi.spyOn(performance, 'mark');
  render(scene('normal'));
  act(() => vi.advanceTimersByTime(1000 / 60 + 1));
  expect(mark).not.toHaveBeenCalled();
});

const genericScenario = {
  ...scenario,
  manifest: parseScenarioManifest({
    ...scenario.manifest,
    settlementIds: [...scenario.manifest.settlementIds, 'es-elche'],
    primarySettlementId: 'es-elche',
  }),
};

// Prewarm the exact generic research fixture, independently covered by model tests.
buildProceduralCity(
  createD3dMapModel(createTransportMapProjection(genericScenario)),
  population,
  readyView,
);

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

// Static fixture preparation is not an interaction or cold-composition benchmark.
// Keep it outside the timed assertion; the dedicated real-city benchmark remains cold.
const uniformGroundingTerrain = (() => {
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
  return terrain;
})();
const uniformGroundingModel = createD3dMapModel(
  createTransportMapProjection(genericScenario),
);
terrainPlanning.groundCity(
  buildProceduralCity(uniformGroundingModel, population),
  terrainPlanning.createD3dTerrain(
    uniformGroundingTerrain,
    uniformGroundingModel,
  ),
);

it('grounds transport and selection on ready terrain while preserving pan/focus and replacing the cheap mini plan', () => {
  const { setMatrixAt } = enableWorld();
  const generatedBefore = buildProceduralCity(model, population);
  const surfacePreparation = vi.spyOn(
    cityGeometry,
    'createCitySurfaceGeometry',
  );
  const terrain = uniformGroundingTerrain;
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  const view = render(
    scene(
      'normal',
      selectStop(stop.stopPlaceId),
      undefined,
      genericScenario,
      population,
    ),
  );
  const initialBuilds = Number(
    screen
      .getByTestId('d3d-map-representation')
      .getAttribute('data-terrain-geometry-builds'),
  );
  for (const layer of ['ground', 'landscape']) {
    expect(
      surfacePreparation.mock.calls.some(([, prepared]) => prepared === layer),
    ).toBe(false);
    expect(
      screen.getByTestId('d3d-map-representation').dataset[
        'city' + layer[0]!.toUpperCase() + layer.slice(1) + 'Triangles'
      ],
    ).toBe('0');
  }
  expect(document.querySelector('mesh[name="settlement-ground"]')).toBeNull();
  expect(document.querySelector('mesh[name="research-landscape"]')).toBeNull();
  const ground =
    10 *
    appSettings.d3dAppSettings.terrain.defaultVerticalExaggeration *
    d3dMetreScale(model).worldUnitsPerMetre;
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
      genericScenario,
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
      genericScenario,
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
    scene('normal', null, undefined, genericScenario, population, [...fleet]),
  );
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-geometry-builds',
    String(initialBuilds + 2),
  );
  expect(buildProceduralCity(model, population)).toBe(generatedBefore);
  const fullBuilds = Number(
    screen
      .getByTestId('d3d-map-representation')
      .getAttribute('data-terrain-geometry-builds'),
  );
  view.rerender(scene('mini', null, undefined, genericScenario, population));
  expect(document.querySelector('mesh[name="research-landscape"]')).toBeNull();
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-terrain-geometry-builds',
    String(fullBuilds + 1),
  );
  expect(
    surfacePreparation.mock.calls.some(
      ([, layer]) => layer === 'ground' || layer === 'landscape',
    ),
  ).toBe(false);
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
  expect(map).toHaveAttribute('data-terrain-elevation-scale', '5');
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

it('owns cached road buffers across fleet/focus/pan and swaps one product while suppressing provisional streets', () => {
  enableWorld();
  const road: RoadNetwork = {
    settlementId: 'es-torrevieja',
    level: 'A',
    sha256: 'a'.repeat(64),
    features: [
      {
        type: 'Feature',
        id: 'W1',
        properties: { highway: 'primary' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-0.7, 37.98],
            [-0.69, 37.98],
          ],
        },
      },
    ],
  };
  vi.mocked(useRoadNetwork).mockReturnValue({ status: 'ready', model: road });
  const { rerender, unmount } = render(
    scene('normal', null, undefined, genericScenario, population),
  );
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-road-network-level', 'A');
  expect(map).toHaveAttribute('data-road-network-features', '1');
  expect(document.querySelector('mesh[name="provisional-streets"]')).toBeNull();
  const mesh = document.querySelector('mesh[name="road-network-surface"]')!;
  sceneProps(mesh).onAfterRender!();
  expect(map).toHaveAttribute('data-rendered-road-network-level', 'A');
  expect(sceneProps(mesh).raycast?.()).toBeNull();
  const roadGeometry = sceneProps(mesh).geometry!;
  const roadDisposed = vi.spyOn(roadGeometry, 'dispose');
  const roadMaterial = sceneProps(mesh).material!;
  const materialDisposed = vi.spyOn(roadMaterial, 'dispose');
  expect(roadMaterial.side).toBe(0); // Three FrontSide, backed by winding tests.
  const builds = map.getAttribute('data-road-network-geometry-builds');
  rerender(
    scene(
      'normal',
      selectStop(stop.stopPlaceId),
      undefined,
      genericScenario,
      population,
      [...fleet],
    ),
  );
  expect(map).toHaveAttribute('data-road-network-geometry-builds', builds);
  rerender(scene('normal', null, route.routeId, genericScenario, population));
  expect(map).toHaveAttribute('data-road-network-geometry-builds', builds);
  act(() => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 120);
    pointer('pointerup', 140, 120);
  });
  expect(map).toHaveAttribute('data-road-network-geometry-builds', builds);
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  expect(useRoadNetwork).toHaveBeenLastCalledWith('es-elche', 'C');
  vi.mocked(useRoadNetwork).mockReturnValue({ status: 'loading' });
  rerender(scene('normal', null, undefined, genericScenario, population));
  expect(roadDisposed).toHaveBeenCalledTimes(1);
  expect(materialDisposed).not.toHaveBeenCalled();
  expect(map).toHaveAttribute('data-road-network-level', '');
  expect(
    document.querySelector('mesh[name="provisional-streets"]'),
  ).not.toBeNull();
  vi.mocked(useRoadNetwork).mockReturnValue({
    status: 'ready',
    model: { ...road, level: 'C' },
  });
  rerender(scene('normal', null, undefined, genericScenario, population));
  expect(map).toHaveAttribute('data-road-network-level', 'C');
  expect(document.querySelectorAll('mesh[name^="road-network-"]')).toHaveLength(
    1,
  );
  vi.mocked(useRoadNetwork).mockReturnValue({
    status: 'error',
    message: 'corrupt road',
  });
  rerender(scene('normal', null, undefined, genericScenario, population));
  expect(map).toHaveAttribute('data-road-network-error', 'corrupt road');
  expect(
    document.querySelector('mesh[name="provisional-streets"]'),
  ).not.toBeNull();
  vi.mocked(useRoadNetwork).mockReturnValue({
    status: 'ready',
    model: {
      ...road,
      features: [
        {
          ...road.features[0]!,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-180, -90],
              [180, 90],
            ],
          },
        },
      ],
    },
  });
  rerender(scene('normal', null, undefined, genericScenario, population));
  expect(map).toHaveAttribute('data-road-network-status', 'error');
  expect(map.getAttribute('data-road-network-error')).toContain(
    'support budget exceeded',
  );
  unmount();
  expect(materialDisposed).toHaveBeenCalledTimes(1);
  expect(roadDisposed).toHaveBeenCalledTimes(1);
});

it('acknowledges only the active actually drawn road product once and invalidates old batches across transitions', () => {
  enableWorld();
  const road: RoadNetwork = {
    settlementId: 'es-torrevieja',
    level: 'A',
    sha256: 'a'.repeat(64),
    features: ['surface', 'bridge'].map((kind) => ({
      type: 'Feature',
      id: kind,
      properties: {
        highway: 'primary',
        ...(kind === 'bridge' ? { bridge: 'yes' } : {}),
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.7, 37.98],
          [-0.69, 37.98],
        ],
      },
    })),
  };
  vi.mocked(useRoadNetwork).mockReturnValue({ status: 'ready', model: road });
  const view = render(
    scene('normal', null, undefined, genericScenario, population),
  );
  const map = screen.getByTestId('d3d-map-representation');
  const acknowledgement = () =>
    map.getAttribute('data-rendered-road-network-level');
  const callbacks = () =>
    [...document.querySelectorAll('mesh[name^="road-network-"]')].map(
      (mesh) => sceneProps(mesh).onAfterRender!,
    );
  const old = callbacks();
  const oldInvalidation = sceneProps(
    screen.getByTestId('r3f-canvas'),
  ).children!.find((child) => child.props.onRoadInvalidated)!.props
    .onRoadInvalidated!;
  expect(map).toHaveAttribute('data-road-network-level', 'A');
  expect(acknowledgement()).toBe('');
  const observer = new MutationObserver(() => {});
  observer.observe(map, {
    attributes: true,
    attributeFilter: ['data-rendered-road-network-level'],
  });
  old[0]!();
  expect(acknowledgement()).toBe('A');
  expect(observer.takeRecords()).toHaveLength(1);
  old.forEach((draw) => draw());
  expect(observer.takeRecords()).toHaveLength(0);
  vi.mocked(useRoadNetwork).mockReturnValue({ status: 'loading' });
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  view.rerender(scene('normal', null, undefined, genericScenario, population));
  expect(map).toHaveAttribute('data-road-network-requested-level', 'C');
  expect(acknowledgement()).toBe('');
  expect(
    document.querySelector('mesh[name="provisional-streets"]'),
  ).not.toBeNull();
  observer.takeRecords();
  old.forEach((draw) => draw());
  expect(acknowledgement()).toBe('');
  expect(observer.takeRecords()).toHaveLength(0);
  vi.mocked(useRoadNetwork).mockReturnValue({
    status: 'ready',
    model: { ...road, level: 'C' },
  });
  view.rerender(scene('normal', null, undefined, genericScenario, population));
  expect(acknowledgement()).toBe('');
  const current = callbacks()[0]!;
  old[0]!();
  expect(acknowledgement()).toBe('');
  current();
  expect(acknowledgement()).toBe('C');
  observer.takeRecords();
  oldInvalidation();
  expect(acknowledgement()).toBe('C');
  current();
  expect(observer.takeRecords()).toHaveLength(0);
  vi.mocked(useRoadNetwork).mockReturnValue({
    status: 'error',
    message: 'Required archive unavailable',
  });
  view.rerender(scene('normal', null, undefined, genericScenario, population));
  expect(acknowledgement()).toBe('');
  current();
  expect(acknowledgement()).toBe('');
  expect(
    document.querySelector('mesh[name="provisional-streets"]'),
  ).not.toBeNull();
  vi.mocked(useRoadNetwork).mockReturnValue({ status: 'ready', model: road });
  view.rerender(scene('normal', null, undefined, genericScenario, population));
  const normal = callbacks()[0]!;
  normal();
  expect(acknowledgement()).toBe('A');
  view.rerender(scene('mini', null, undefined, genericScenario, population));
  expect(acknowledgement()).toBe('');
  normal();
  expect(acknowledgement()).toBe('');
  const mini = callbacks()[0]!;
  mini();
  expect(acknowledgement()).toBe('A');
  vi.mocked(useRoadNetwork).mockReturnValue({
    status: 'ready',
    model: { ...road, sha256: 'b'.repeat(64) },
  });
  view.rerender(scene('mini', null, undefined, genericScenario, population));
  expect(acknowledgement()).toBe('');
  mini();
  expect(acknowledgement()).toBe('');
  const replaced = callbacks()[0]!;
  replaced();
  expect(acknowledgement()).toBe('A');
  controls.renderWorld = false;
  view.rerender(scene('mini', null, undefined, genericScenario, population));
  expect(acknowledgement()).toBe('');
  replaced();
  expect(acknowledgement()).toBe('');
  controls.renderWorld = true;
  view.rerender(scene('mini', null, undefined, genericScenario, population));
  expect(acknowledgement()).toBe('');
  const remounted = callbacks()[0]!;
  remounted();
  expect(acknowledgement()).toBe('A');
  vi.mocked(useRoadNetwork).mockReturnValue({ status: 'absent' });
  view.rerender(
    scene(
      'normal',
      null,
      undefined,
      {
        ...genericScenario,
        manifest: parseScenarioManifest({
          ...scenario.manifest,
          settlementIds: [...scenario.manifest.settlementIds, 'es-alicante'],
          primarySettlementId: 'es-alicante',
        }),
      },
      population,
    ),
  );
  expect(useRoadNetwork).toHaveBeenLastCalledWith(
    'es-alicante',
    expect.any(String),
  );
  expect(acknowledgement()).toBe('');
  remounted();
  expect(acknowledgement()).toBe('');
  vi.mocked(useRoadNetwork).mockReturnValue({ status: 'ready', model: road });
  view.rerender(scene('normal', null, undefined, genericScenario, population));
  const detached = callbacks()[0]!;
  detached();
  expect(acknowledgement()).toBe('A');
  view.unmount();
  expect(acknowledgement()).toBe('');
  expect(() => detached()).not.toThrow();
  observer.disconnect();
});

function readyCellTerrain() {
  const f = terrainFixture();
  Object.assign(f.catalog.settlements.test.viewports[0]!.rasterBounds3035, {
    west: 3375000,
    south: 1720000,
    east: 3376500,
    north: 1721500,
  });
  f.catalog.settlements.test.resolutionMeters = { x: 500, y: 500 };
  for (const product of [f.height, f.surfaceMask]) {
    product.resolutionMetersX = 500;
    product.resolutionMetersY = 500;
  }
  const resolution = resolveTerrainViewport(
    parseTerrainCatalog(f.catalog),
    'test',
    'a',
  )!;
  const terrain = terrainJsonDecoder.decode(f, resolution);
  vi.mocked(useTerrain).mockReturnValue({ status: 'ready', terrain });
  return terrain;
}
const cellModel = withStreetCellZones(
  decodeStreetCells(streetCellFixture(), 'es-torrevieja', {
    ...parseStreetCellCatalog(streetCellJson('catalog.json')).settlements[
      'es-torrevieja'
    ]!.products[2]!,
    featureCount: 2,
  }),
);
it('preserves non-drawable C authority without empty GPU geometry or fake acknowledgement', () => {
  vi.spyOn(appSettings, 'resolveD3dAppSettings').mockImplementation((city) =>
    resolveSettings(city, {
      ...appSettings.d3dAppSettings,
      streetCells: {
        ...appSettings.d3dAppSettings.streetCells,
        showBoundaries: true,
      },
    }),
  );
  enableWorld();
  readyCellTerrain();
  const one = {
    ...cellModel,
    features: [cellModel.features[0]!],
    annotations: {
      ...cellModel.annotations!,
      cells: {
        'es-torrevieja-sc-1': {
          ...cellModel.annotations!.cells['es-torrevieja-sc-1']!,
          classification: 'non-drawable' as const,
          safeZoneCoordinates: null,
          safeAreaSqm: 0,
        },
      },
    },
  };
  vi.mocked(useStreetCells).mockReturnValue({ status: 'ready', model: one });
  const view = render(scene('normal'));
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  const map = screen.getByTestId('d3d-map-representation');
  expect(map).toHaveAttribute('data-street-cells-count', '1');
  expect(map).toHaveAttribute('data-street-cells-displayed-count', '0');
  expect(map).toHaveAttribute('data-street-cells-nondrawable-count', '1');
  expect(
    JSON.parse(map.getAttribute('data-street-cells-nondrawable-cells')!),
  ).toEqual([{ id: 'es-torrevieja-sc-1', reason: 'non-drawable' }]);
  expect(map).toHaveAttribute('data-street-cells-level', '');
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  expect(map).toHaveAttribute('data-street-cells-geometry-builds', '0');
  expect(
    document.querySelector('linesegments[name="street-cells-boundaries"]'),
  ).toBeNull();
  view.unmount();
});
it('presents only near normal C lines with native terrain, safe depth style, stable GPU buffers and actual-draw acknowledgement', () => {
  vi.spyOn(appSettings, 'resolveD3dAppSettings').mockImplementation((city) =>
    resolveSettings(city, {
      ...appSettings.d3dAppSettings,
      streetCells: {
        ...appSettings.d3dAppSettings.streetCells,
        showBoundaries: true,
      },
    }),
  );
  enableWorld();
  readyCellTerrain();
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: cellModel,
  });
  const view = render(scene('normal'));
  const map = screen.getByTestId('d3d-map-representation');
  fireEvent.wheel(controls.canvas, { deltaY: 10000 });
  expect(map).toHaveAttribute('data-street-cells-level', '');
  expect(
    document.querySelector('linesegments[name="street-cells-boundaries"]'),
  ).toBeNull();
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  expect(map).toHaveAttribute('data-street-cells-level', 'C');
  expect(map).toHaveAttribute('data-street-cells-count', '2');
  expect(map).toHaveAttribute('data-street-cells-unique-edges', '10');
  const line = () =>
    document.querySelector('linesegments[name="street-cells-boundaries"]')!;
  const props = sceneProps(line()),
    geometry = props.geometry!,
    material = props.material!;
  expect(props.raycast?.()).toBeNull();
  expect(props.onClick).toBeUndefined();
  expect(material.depthTest).toBe(true);
  expect(material.depthWrite).toBe(false);
  expect(material.opacity).toBe(0.88);
  expect(material.toneMapped).toBe(false);
  const disposed = vi.spyOn(geometry, 'dispose'),
    materialDisposed = vi.spyOn(material, 'dispose');
  const ack = () => map.getAttribute('data-rendered-street-cells-level');
  expect(ack()).toBe('');
  const observer = new MutationObserver(() => {});
  observer.observe(map, {
    attributes: true,
    attributeFilter: ['data-rendered-street-cells-level'],
  });
  const draw = props.onAfterRender!;
  draw();
  expect(ack()).toBe('C');
  expect(observer.takeRecords()).toHaveLength(1);
  draw();
  expect(observer.takeRecords()).toHaveLength(0);
  const builds = map.getAttribute('data-street-cells-geometry-builds');
  view.rerender(
    scene(
      'normal',
      selectVehicle(fleet[0]!.vehicleId),
      undefined,
      scenario,
      undefined,
      [{ ...fleet[0]!, label: 'Updated fleet' }],
    ),
  );
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 104, 104);
  pointer('pointerup', 104, 104);
  expect(sceneProps(line()).geometry).toBe(geometry);
  expect(map).toHaveAttribute('data-street-cells-geometry-builds', builds);
  expect(disposed).not.toHaveBeenCalled();
  fireEvent.wheel(controls.canvas, { deltaY: 10000 });
  expect(ack()).toBe('');
  expect(line()).toBeNull();
  draw();
  expect(ack()).toBe('');
  expect(disposed).toHaveBeenCalledTimes(1);
  view.rerender(scene('mini'));
  expect(map).toHaveAttribute('data-street-cells-status', 'inactive');
  view.rerender(scene('normal'));
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  sceneProps(line()).onAfterRender!();
  expect(ack()).toBe('C');
  view.unmount();
  expect(ack()).toBe('');
  draw();
  expect(ack()).toBe('');
  expect(materialDisposed).toHaveBeenCalledTimes(1);
  observer.disconnect();
});
it('clears cells immediately on loading/error/absence, terrain and scene changes, rejecting stale batch callbacks', () => {
  vi.spyOn(appSettings, 'resolveD3dAppSettings').mockImplementation((city) =>
    resolveSettings(city, {
      ...appSettings.d3dAppSettings,
      streetCells: {
        ...appSettings.d3dAppSettings.streetCells,
        showBoundaries: true,
      },
    }),
  );
  enableWorld();
  readyCellTerrain();
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: cellModel,
  });
  const view = render(scene('normal'));
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  const map = screen.getByTestId('d3d-map-representation');
  const line = () =>
    document.querySelector('linesegments[name="street-cells-boundaries"]')!;
  const draw = () => sceneProps(line()).onAfterRender!;
  const old = draw();
  old();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', 'C');
  for (const status of ['loading', 'error', 'absent'] as const) {
    vi.mocked(useStreetCells).mockReturnValue(
      status === 'error' ? { status, message: 'corrupt cells' } : { status },
    );
    view.rerender(scene('normal'));
    expect(map).toHaveAttribute('data-street-cells-status', status);
    expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
    old();
    expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
    expect(line()).toBeNull();
  }
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: cellModel,
  });
  view.rerender(scene('normal'));
  const detached = draw();
  detached();
  const invalidate = sceneProps(
    screen.getByTestId('r3f-canvas'),
  ).children!.find((c) => c.props.onStreetCellsInvalidated)!.props
    .onStreetCellsInvalidated!;
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: { ...cellModel },
  });
  view.rerender(scene('normal'));
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  draw()();
  invalidate();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', 'C');
  detached();
  controls.renderWorld = false;
  view.rerender(scene('normal'));
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  detached();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  controls.renderWorld = true;
  view.rerender(scene('normal'));
  const current = draw();
  current();
  vi.mocked(useTerrain).mockReturnValue({ status: 'unavailable' });
  view.rerender(scene('normal'));
  expect(map).toHaveAttribute('data-street-cells-status', 'inactive');
  expect(line()).toBeNull();
  current();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  view.unmount();
  current();
});

it('keeps StreetCell preparation guard failures diagnostic and rejects old city/terrain acknowledgements', () => {
  vi.spyOn(appSettings, 'resolveD3dAppSettings').mockImplementation((city) =>
    resolveSettings(city, {
      ...appSettings.d3dAppSettings,
      streetCells: {
        ...appSettings.d3dAppSettings.streetCells,
        showBoundaries: true,
      },
    }),
  );
  enableWorld();
  readyCellTerrain();
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: cellModel,
  });
  const view = render(scene('normal'));
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  const map = screen.getByTestId('d3d-map-representation');
  const old = sceneProps(
    document.querySelector('linesegments[name="street-cells-boundaries"]')!,
  ).onAfterRender!;
  old();
  const city = {
    ...scenario,
    manifest: parseScenarioManifest({
      ...scenario.manifest,
      settlementIds: [...scenario.manifest.settlementIds, 'es-elche'],
      primarySettlementId: 'es-elche',
    }),
  };
  vi.mocked(useStreetCells).mockReturnValue({ status: 'absent' });
  view.rerender(scene('normal', null, undefined, city));
  old();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: {
      ...cellModel,
      level: 'A',
      annotations: undefined,
      features: [
        {
          ...cellModel.features[0]!,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-180, -90],
                [180, 90],
                [180, -90],
                [-180, -90],
              ],
            ],
          },
        },
      ],
    },
  });
  view.rerender(scene('normal'));
  publishCellLod('far');
  expect(map).toHaveAttribute('data-street-cells-status', 'error');
  expect(map.getAttribute('data-street-cells-error')).toContain('budget');
  expect(map).toHaveAttribute('data-street-cells-count', '0');
  expect(
    document.querySelector('linesegments[name="street-cells-boundaries"]'),
  ).toBeNull();
  view.unmount();
});

it('uses existing far/medium/near demand and rejects stale rendered levels during A/B/C transitions', () => {
  vi.spyOn(appSettings, 'resolveD3dAppSettings').mockImplementation((city) =>
    resolveSettings(city, {
      ...appSettings.d3dAppSettings,
      streetCells: {
        ...appSettings.d3dAppSettings.streetCells,
        showBoundaries: true,
      },
    }),
  );
  enableWorld();
  readyCellTerrain();
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: { ...cellModel, level: 'A', annotations: undefined },
  });
  const view = render(scene('normal')),
    map = screen.getByTestId('d3d-map-representation');
  publishCellLod('far');
  expect(useStreetCells).toHaveBeenLastCalledWith(
    'es-torrevieja',
    true,
    undefined,
    'A',
  );
  const line = () =>
    document.querySelector('linesegments[name="street-cells-boundaries"]')!;
  const old = sceneProps(line()).onAfterRender!;
  old();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', 'A');
  vi.mocked(useStreetCells).mockReturnValue({ status: 'loading' });
  publishCellLod('medium');
  expect(useStreetCells).toHaveBeenLastCalledWith(
    'es-torrevieja',
    true,
    undefined,
    'B',
  );
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  old();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: { ...cellModel, level: 'B', annotations: undefined },
  });
  view.rerender(scene('normal'));
  expect(map).toHaveAttribute('data-street-cells-level', 'B');
  sceneProps(line()).onAfterRender!();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', 'B');
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: cellModel,
  });
  view.rerender(scene('normal'));
  sceneProps(line()).onAfterRender!();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', 'C');
  view.rerender(scene('mini'));
  expect(map).toHaveAttribute('data-street-cells-status', 'inactive');
  expect(line()).toBeNull();
  old();
  expect(map).toHaveAttribute('data-rendered-street-cells-level', '');
  view.unmount();
});

function publishCellLod(level: 'far' | 'medium' | 'near') {
  act(() =>
    sceneProps(screen.getByTestId('r3f-canvas')).children!.find(
      (c) => c.props.onLod,
    )!.props.onLod!(level),
  );
}

it('requires independent Torrevieja C for ordinary buildings at every camera LOD, with no old-grid fallback', () => {
  enableWorld();
  vi.mocked(useSettlementMetadata).mockReturnValue(readyView);
  const view = render(scene('normal', null, undefined, scenario, population));
  const host = screen.getByTestId('d3d-map-representation');
  expect(useStreetCells).toHaveBeenCalledWith(
    'es-torrevieja',
    true,
    undefined,
    'C',
  );
  expect(host).toHaveAttribute('data-cell-buildings-status', 'inactive');
  expect(host).toHaveAttribute('data-city-building-count', '0');
  for (const state of [
    { status: 'loading' },
    { status: 'absent' },
    { status: 'error', message: 'broken required C' },
  ] as const) {
    vi.mocked(useStreetCells).mockReturnValue(state);
    view.rerender(scene('normal', null, undefined, scenario, population));
    expect(host).toHaveAttribute('data-city-building-count', '0');
    expect(host).toHaveAttribute('data-cell-buildings-status', state.status);
    expect(
      document.querySelector('mesh[name="landmark-reservations"]'),
    ).not.toBeNull();
  }
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  expect(useStreetCells).toHaveBeenCalledWith(
    'es-torrevieja',
    true,
    undefined,
    'C',
  );
  view.rerender(scene('mini', null, undefined, scenario, population));
  expect(useStreetCells).toHaveBeenCalledWith(
    'es-torrevieja',
    true,
    undefined,
    'C',
  );
  expect(host).toHaveAttribute('data-city-building-count', '0');
});

const lifecycleCells = {
  ...cellCityCells,
  features: cellCityCells.features.filter((f) =>
    ['es-torrevieja-sc-123', 'es-torrevieja-sc-1'].includes(f.id),
  ),
};

// Cold C planning/grounding is measured by real-data model tests. This scene case
// deliberately times cache/lifecycle behavior using the same immutable identities.
const lifecycleWorld = terrainPlanning.createD3dTerrain(
  cellCityTerrain.terrain,
  model,
);
const lifecycleCity = buildStreetCellCity(
  model,
  cellOwnedPopulation,
  readyView,
  lifecycleCells,
  lifecycleWorld,
  streetCellLandmarkProtections(model, readyView),
);
terrainPlanning.groundCity(lifecycleCity, lifecycleWorld);
terrainPlanning.planD3dTerrain(lifecycleWorld, {
  representationMode: 'normal',
  lod: 'far',
});

it('batches cell-owned Torrevieja buildings once and keeps their static plan through fleet, pan, selection and LOD', () => {
  enableWorld();
  // Native-ground queries remain real; full terrain mesh LOD has independent model/E2E coverage.
  // This case measures city lifecycle, so avoid materializing the entire native mesh here.
  // Native grid is independently covered; this case asserts city buffers, not grid materialization.
  vi.spyOn(terrainGrid, 'terrainGridWindow').mockReturnValue(undefined);
  const terrainPlanner = terrainPlanning.planD3dTerrain;
  vi.spyOn(terrainPlanning, 'planD3dTerrain').mockImplementation(
    (terrain, policy) => terrainPlanner(terrain, { ...policy, lod: 'far' }),
  );
  vi.mocked(useTerrain).mockReturnValue({
    status: 'ready',
    terrain: cellCityTerrain.terrain,
  });
  vi.mocked(useSettlementMetadata).mockReturnValue(readyView);
  vi.mocked(useStreetCells).mockImplementation(
    (_city, _active, _loader, level) =>
      level === 'C'
        ? { status: 'ready', model: lifecycleCells }
        : { status: 'loading' },
  );
  const realPopulation = cellOwnedPopulation;
  const view = render(
    scene('normal', null, undefined, scenario, realPopulation),
  );
  const host = screen.getByTestId('d3d-map-representation');
  expect(Number(host.dataset.cityBuildingCount)).toBeGreaterThan(0);
  expect(Number(host.dataset.cellBuildingsUrban)).toBeGreaterThan(0);
  expect(Number(host.dataset.cellBuildingsSuburban)).toBeGreaterThan(0);
  expect(host).toHaveAttribute('data-cell-buildings-source-cells', '2');
  expect(host).toHaveAttribute('data-street-cells-status', 'hidden');
  expect(host).toHaveAttribute('data-street-cells-batches', '0');
  expect(host).toHaveAttribute('data-rendered-street-cells-level', '');
  expect(
    document.querySelector('linesegments[name="street-cells-boundaries"]'),
  ).toBeNull();
  expect(useStreetCells).toHaveBeenCalledWith(
    'es-torrevieja',
    true,
    undefined,
    'C',
  );
  expect(useStreetCells).toHaveBeenCalledWith(
    'es-torrevieja',
    false,
    undefined,
    'A',
  );
  expect(document.querySelector('mesh[name="provisional-streets"]')).toBeNull();
  const builds = host.dataset.cityLayoutBuilds;
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  expect(host.dataset.cityLayoutBuilds).toBe(builds);
  const geometries = [
    ...document.querySelectorAll('instancedmesh[name^="city-"]'),
  ].map((node) => sceneProps(node).args![0]);
  const staticGeometry = vi.spyOn(cityGeometry, 'createCityPrototypeGeometry');
  view.rerender(
    scene(
      'normal',
      selectStop(stop.stopPlaceId),
      undefined,
      scenario,
      realPopulation,
      [...fleet],
    ),
  );
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 12, 12);
    pointer('pointerup', 12, 12);
  });
  expect(host.dataset.cityLayoutBuilds).toBe(builds);
  expect(
    [...document.querySelectorAll('instancedmesh[name^="city-"]')].map(
      (node) => sceneProps(node).args![0],
    ),
  ).toEqual(geometries);
  expect(staticGeometry).not.toHaveBeenCalled();
  const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
  view.unmount();
  expect(dispose).toHaveBeenCalled();
});
it('reports repeated skipped-cell causes separately from candidate rejections', () => {
  enableWorld();
  vi.mocked(useTerrain).mockReturnValue({
    status: 'ready',
    terrain: cellCityTerrain.terrain,
  });
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: {
      ...cellCityCells,
      features: cellCityCells.features.filter((f) =>
        ['es-torrevieja-sc-8', 'es-torrevieja-sc-12'].includes(f.id),
      ),
    },
  });
  render(scene('normal', null, undefined, scenario, cellOwnedPopulation));
  const host = screen.getByTestId('d3d-map-representation');
  expect(host).toHaveAttribute('data-cell-buildings-source-cells', '2');
  expect(host).toHaveAttribute('data-street-cells-status', 'hidden');
  expect(host).toHaveAttribute('data-street-cells-batches', '0');
  expect(host).toHaveAttribute('data-rendered-street-cells-level', '');
  expect(
    document.querySelector('linesegments[name="street-cells-boundaries"]'),
  ).toBeNull();
  expect(useStreetCells).toHaveBeenCalledWith(
    'es-torrevieja',
    true,
    undefined,
    'C',
  );
  expect(useStreetCells).toHaveBeenCalledWith(
    'es-torrevieja',
    false,
    undefined,
    'A',
  );
  expect(host).toHaveAttribute('data-city-building-count', '0');
  expect(JSON.parse(host.dataset.cellBuildingsSkipped!)).toEqual({
    'safe-zone-footprint': 2,
  });
  expect(
    JSON.parse(host.dataset.cellBuildingsRejected!)['safe-zone-footprint'],
  ).toBeGreaterThan(2);
});
it('fails a foreign C composition safely, reports its error and retains research reservations', () => {
  enableWorld();
  vi.mocked(useSettlementMetadata).mockReturnValue(readyView);
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: { ...cellCityCells, settlementId: 'es-alicante' },
  });
  const view = render(scene('normal', null, undefined, scenario, population));
  const host = screen.getByTestId('d3d-map-representation');
  expect(host).toHaveAttribute('data-cell-buildings-status', 'error');
  expect(host.dataset.cellBuildingsError).toContain(
    'StreetCell C settlement mismatch',
  );
  expect(host).toHaveAttribute('data-city-building-count', '0');
  expect(
    document.querySelector('mesh[name="landmark-reservations"]'),
  ).not.toBeNull();
  vi.mocked(useSettlementMetadata).mockReturnValue({
    status: 'failed',
  });
  view.rerender(scene('normal', null, undefined, scenario, population));
  expect(host).toHaveAttribute('data-cell-buildings-status', 'error');
  expect(host).toHaveAttribute('data-city-building-count', '0');
  expect(
    sceneProps(
      document.querySelector('mesh[name="landmark-reservations"]')!,
    ).geometry!.getAttribute('position').count,
  ).toBe(0);
});

it('reports C buildings ready with absent/error/loading optional research and reuses unchanged slots', () => {
  enableWorld();
  vi.mocked(useTerrain).mockReturnValue({
    status: 'ready',
    terrain: cellCityTerrain.terrain,
  });
  const one = {
    ...cellCityCells,
    features: cellCityCells.features.filter(
      (f) => f.id === 'es-torrevieja-sc-1',
    ),
  };
  vi.mocked(useStreetCells).mockReturnValue({ status: 'ready', model: one });
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'failed' });
  const view = render(
    scene('normal', null, undefined, scenario, cellOwnedPopulation),
  );
  const host = screen.getByTestId('d3d-map-representation');
  expect(host).toHaveAttribute('data-cell-buildings-status', 'ready');
  expect(Number(host.dataset.cityBuildingCount)).toBeGreaterThan(0);
  const count = host.dataset.cityBuildingCount,
    builds = host.dataset.cityLayoutBuilds;
  vi.mocked(useSettlementMetadata).mockReturnValue({ status: 'loading' });
  view.rerender(
    scene('normal', null, undefined, scenario, cellOwnedPopulation),
  );
  expect(host).toHaveAttribute('data-cell-buildings-status', 'ready');
  expect(host.dataset.cityBuildingCount).toBe(count);
  expect(host.dataset.cityLayoutBuilds).toBe(builds);
});

it('disposes enabled outline resources on hidden settings and rejects delayed draw callbacks', () => {
  enableWorld();
  readyCellTerrain();
  const setting = vi
    .spyOn(appSettings, 'resolveD3dAppSettings')
    .mockImplementation((city) =>
      resolveSettings(city, {
        ...appSettings.d3dAppSettings,
        streetCells: {
          ...appSettings.d3dAppSettings.streetCells,
          showBoundaries: true,
        },
      }),
    );
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: cellModel,
  });
  const v = render(scene('normal'));
  fireEvent.wheel(controls.canvas, { deltaY: -10000 });
  const node = document.querySelector(
    'linesegments[name="street-cells-boundaries"]',
  )!;
  expect(node).not.toBeNull();
  const props = sceneProps(node);
  const dispose = vi.spyOn(props.material!, 'dispose');
  const drawn = props.onAfterRender!;
  act(() => drawn());
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-rendered-street-cells-level',
    'C',
  );
  setting.mockImplementation((city) => resolveSettings(city));
  v.rerender(scene('normal'));
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(
    document.querySelector('linesegments[name="street-cells-boundaries"]'),
  ).toBeNull();
  act(() => drawn());
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-rendered-street-cells-level',
    '',
  );
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-street-cells-status',
    'hidden',
  );
});

const installedSites = createCityMaterializationLoader({
  baseUrl: '/',
  digestSha256: async (text) => createHash('sha256').update(text).digest('hex'),
  fetchText: async (url) => ({
    ok: true,
    text: async () =>
      readFileSync(join(import.meta.dirname, '../../public', url), 'utf8'),
  }),
});
it('presents verified native-ground sites, preserves static GPU geometry through fleet/selection/pan and clears removed acknowledgements', async () => {
  enableWorld();
  vi.mocked(useTerrain).mockReturnValue({
    status: 'ready',
    terrain: cellCityTerrain.terrain,
  });
  const state = {
    status: 'ready' as const,
    model: (await installedSites.resolve('es-torrevieja', 'far'))!,
  };
  vi.mocked(useCityMaterialization).mockReturnValue(state);
  const view = render(scene('normal', null, undefined, scenario, population));
  const host = screen.getByTestId('d3d-map-representation');
  expect(host).toHaveAttribute('data-materialization-status', 'ready');
  expect(Number(host.dataset.materializationTriangles)).toBeGreaterThan(0);
  expect(host.dataset.materializationOverlaps).not.toBe('');
  expect(host).toHaveAttribute('data-rendered-materialization-level', '');
  const node = document.querySelector('mesh[name^="materialization-"]')!;
  const props = sceneProps(node);
  act(() => props.onAfterRender!());
  expect(host).toHaveAttribute('data-rendered-materialization-level', 'A');
  view.rerender(
    scene(
      'normal',
      selectStop(stop.stopPlaceId),
      undefined,
      scenario,
      population,
      [...fleet],
    ),
  );
  pointer('pointerdown', 10, 10);
  pointer('pointermove', 12, 12);
  pointer('pointerup', 12, 12);
  expect(
    sceneProps(document.querySelector('mesh[name^="materialization-"]')!)
      .geometry,
  ).toBe(props.geometry);
  vi.mocked(useCityMaterialization).mockReturnValue({ status: 'absent' });
  view.rerender(scene('normal'));
  expect(host).toHaveAttribute('data-rendered-materialization-level', '');
  expect(
    document.querySelector('group[name="city-materialization"]'),
  ).toBeNull();
  act(() => props.onAfterRender!());
  expect(host).toHaveAttribute('data-rendered-materialization-level', '');
});
it('keeps unavailable, mini and corrupt site inputs usable and diagnoses preparation failures', async () => {
  const state = {
    status: 'ready' as const,
    model: (await installedSites.resolve('es-torrevieja', 'far'))!,
  };
  vi.mocked(useCityMaterialization).mockReturnValue(state);
  const view = render(scene('normal'));
  expect(useCityMaterialization).toHaveBeenLastCalledWith(
    'es-torrevieja',
    screen.getByTestId('d3d-map-representation').dataset.cityLod,
    false,
  );
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-materialization-sites',
    '0',
  );
  vi.mocked(useTerrain).mockReturnValue({
    status: 'ready',
    terrain: cellCityTerrain.terrain,
  });
  view.rerender(scene('mini'));
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-materialization-sites',
    '0',
  );
  view.rerender(scene('normal'));
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-materialization-overlaps',
    '[]',
  );
  const fail = vi
    .spyOn(sitePlanning, 'prepareCityMaterialization')
    .mockImplementation(() => {
      throw new Error('Site preparation budget');
    });
  vi.mocked(useCityMaterialization).mockReturnValue({ ...state });
  view.rerender(scene('normal'));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Site preparation budget',
  );
  expect(screen.getByTestId('d3d-map-representation')).toHaveAttribute(
    'data-materialization-status',
    'error',
  );
  fail.mockRestore();
  vi.mocked(useCityMaterialization).mockReturnValue({
    status: 'error',
    message: 'Site checksum mismatch',
  });
  view.rerender(scene('normal'));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Site checksum mismatch',
  );
});

it('shares near-only wall facade parameters, keeps roofs plain, and releases static resources', () => {
  enableWorld();
  vi.spyOn(terrainGrid, 'terrainGridWindow').mockReturnValue(undefined);
  const planner = terrainPlanning.planD3dTerrain;
  vi.spyOn(terrainPlanning, 'planD3dTerrain').mockImplementation(
    (terrain, policy) => planner(terrain, { ...policy, lod: 'far' }),
  );
  vi.mocked(useTerrain).mockReturnValue({
    status: 'ready',
    terrain: cellCityTerrain.terrain,
  });
  vi.mocked(useStreetCells).mockImplementation(
    (_city, _active, _loader, level) =>
      level === 'C'
        ? { status: 'ready', model: lifecycleCells }
        : { status: 'loading' },
  );
  const view = render(
    scene('normal', null, undefined, scenario, cellOwnedPopulation),
  );
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  const bodies = [
    ...document.querySelectorAll('instancedmesh[name^="city-"][name$="-body"]'),
  ];
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.length).toBeLessThanOrEqual(14);
  const resources = bodies.map((node) => sceneProps(node).args!);
  for (const [geometry, material, count] of resources) {
    expect(geometry.getAttribute('cityFacade').count).toBe(count);
    expect(geometry.getAttribute('cityFacade').itemSize).toBe(4);
    expect(geometry.getAttribute('uv')).toBeUndefined();
    expect(material.customProgramCacheKey()).toBe('city-wall-facade-v0');
  }
  for (const node of document.querySelectorAll(
    'instancedmesh[name^="city-"][name$="-roof"]',
  ))
    expect(
      sceneProps(node).args![0].getAttribute('cityFacade'),
    ).toBeUndefined();
  const disposals = resources.flatMap(([geometry, material]) => [
    vi.spyOn(geometry, 'dispose'),
    vi.spyOn(material, 'dispose'),
  ]);
  act(() => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 12, 12);
    pointer('pointerup', 12, 12);
  });
  expect(
    [
      ...document.querySelectorAll(
        'instancedmesh[name^="city-"][name$="-body"]',
      ),
    ].map((n) => sceneProps(n).args),
  ).toEqual(resources);
  expect(disposals.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  view.unmount();
  for (const spy of disposals) expect(spy).toHaveBeenCalled();
});
it('disables facade GPU attributes by checked-in policy without suppressing the C-owned city', () => {
  enableWorld();
  // Facade policy is independent of native terrain tessellation, covered separately.
  vi.spyOn(terrainGrid, 'terrainGridWindow').mockReturnValue(undefined);
  const planner = terrainPlanning.planD3dTerrain;
  vi.spyOn(terrainPlanning, 'planD3dTerrain').mockImplementation(
    (terrain, policy) => planner(terrain, { ...policy, lod: 'far' }),
  );

  vi.spyOn(appSettings, 'resolveD3dAppSettings').mockImplementation(
    (city, settings) => {
      const resolved = resolveSettings(city, settings);
      return { ...resolved, city: { ...resolved.city, nearFacades: false } };
    },
  );
  vi.mocked(useTerrain).mockReturnValue({
    status: 'ready',
    terrain: cellCityTerrain.terrain,
  });
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: lifecycleCells,
  });
  const view = render(
    scene('normal', null, undefined, scenario, cellOwnedPopulation),
  );
  fireEvent.wheel(controls.canvas, { deltaY: -3000 });
  expect(
    Number(
      screen.getByTestId('d3d-map-representation').dataset.cityBuildingCount,
    ),
  ).toBeGreaterThan(0);
  for (const node of document.querySelectorAll('instancedmesh[name^="city-"]'))
    expect(
      sceneProps(node).args![0].getAttribute('cityFacade'),
    ).toBeUndefined();
  view.rerender(scene('mini', null, undefined, scenario, cellOwnedPopulation));
  for (const node of document.querySelectorAll('instancedmesh[name^="city-"]'))
    expect(
      sceneProps(node).args![0].getAttribute('cityFacade'),
    ).toBeUndefined();
});

it('uploads transforms again when facade resources replace a batch with unchanged physical slots', () => {
  const { setMatrixAt } = enableWorld();
  vi.spyOn(terrainGrid, 'terrainGridWindow').mockReturnValue(undefined);
  const planner = terrainPlanning.planD3dTerrain;
  vi.spyOn(terrainPlanning, 'planD3dTerrain').mockImplementation(
    (terrain, policy) => planner(terrain, { ...policy, lod: 'far' }),
  );
  let enabled = true;
  vi.spyOn(appSettings, 'resolveD3dAppSettings').mockImplementation(
    (city, settings) => {
      const resolved = resolveSettings(city, settings);
      return { ...resolved, city: { ...resolved.city, nearFacades: enabled } };
    },
  );
  vi.mocked(useTerrain).mockReturnValue({
    status: 'ready',
    terrain: cellCityTerrain.terrain,
  });
  vi.mocked(useStreetCells).mockReturnValue({
    status: 'ready',
    model: lifecycleCells,
  });
  const view = render(
    scene('normal', null, undefined, scenario, cellOwnedPopulation),
  );
  publishCellLod('near');
  const body = () =>
    document.querySelector('instancedmesh[name^="city-"][name$="-body"]')!;
  const before = sceneProps(body()).args!;
  expect(before[0].getAttribute('cityFacade')).toBeDefined();
  setMatrixAt.mockClear();
  enabled = false;
  view.rerender(
    scene('normal', null, undefined, scenario, cellOwnedPopulation),
  );
  const after = sceneProps(body()).args!;
  expect(after[0]).not.toBe(before[0]);
  expect(after[2]).toBe(before[2]);
  expect(after[0].getAttribute('cityFacade')).toBeUndefined();
  expect(setMatrixAt).toHaveBeenCalled();
});
