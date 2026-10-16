import { facadeParameters, patchCityFacadeShader } from './d3d-city-facade.js';
import {
  d3dMaterialPresets,
  resolveTerrainMaterials,
} from './d3d-material-presets.js';
import { useCityMaterialization } from './use-city-materialization.js';
import {
  prepareCityMaterialization,
  diagnoseMaterializationOverlaps,
  type MaterializationPlan,
} from './d3d-materialization.js';
import { D3dMaterialization } from './D3dMaterialization.js';
import { D3dTypedLandCovers } from './D3dTypedLandCovers.js';
import {
  prepareD3dTypedLandCovers,
  type TypedLandCoverPlan,
} from './d3d-typed-land-covers.js';
import { resolveD3dAppSettings } from './d3d-app-settings.js';
import {
  buildStreetCellCity,
  streetCellLandmarkProtections,
} from './d3d-street-cell-city.js';
import { useStreetCells } from './use-street-cells.js';
import {
  prepareD3dStreetCells,
  createStreetCellGeometry,
} from './d3d-street-cells.js';
import { useRoadNetwork } from './use-road-network.js';
import { roadNetworkLevel } from './road-network.js';
import {
  prepareD3dRoads,
  createRoadGeometry,
  type RoadBatch,
} from './d3d-road-geometry.js';
type RoadMeshes = readonly Readonly<{
  kind: RoadBatch['kind'];
  geometry: BufferGeometry;
}>[];
import {
  createD3dStopGeometry,
  d3dStopColors,
  d3dStopRadius,
} from './d3d-stop-geometry.js';
import {
  createTerrainGridGeometry,
  terrainGridWindow,
  maximumD3dZoom,
  type TerrainGridWindow,
} from './d3d-terrain-grid.js';
import { d3dDrapePolicy } from './d3d-presentation-policy.js';
import { createD3dDirtyFrameDriver } from './d3d-dirty-frame.js';
import { projectTransportMapVehicles } from './transport-map-projection.js';
import {
  Canvas,
  events as createPointerEvents,
  useThree,
  useFrame,
  type ThreeEvent,
} from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshLambertMaterial,
  MeshBasicMaterial,
  LineBasicMaterial,
  Object3D,
  OrthographicCamera,
  Vector3,
} from 'three';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { VehicleState } from '@torrevieja-tycoon/simulation';
import type {
  CanonicalScenario,
  RouteId,
} from '@torrevieja-tycoon/transport-domain';
import {
  useRepresentationMode,
  useLatestRepresentationValue,
} from './RepresentationModeContext.js';
import {
  representationCadence,
  type RepresentationMode,
} from './representation-cadence.js';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from '../performance/representation-profiler.js';
import { createTransportMapProjection } from './transport-map-projection.js';
import {
  createD3dMapModel,
  d3dKeyboardCandidates,
  d3dLodBand,
  fitD3dCamera,
  projectD3dVehicles,
  d3dSceneBounds,
  d3dMetreScale,
  d3dStopHitScale,
  selectD3dCandidate,
  type D3dLodBand,
  type D3dMapModel,
  type D3dVehicle,
} from './d3d-map-model.js';
import {
  selectStop,
  selectVehicle,
  type GameSelection,
} from '../ui/game-selection.js';
import {
  buildProceduralCity,
  cityLodBuildings,
  buildingPrototypeKinds,
  populationSpace,
  type ProceduralCity,
  type CityBuilding,
  type BuildingPrototypeKind,
} from './d3d-city-model.js';
import {
  createCityPrototypeGeometry,
  createCitySurfaceGeometry,
} from './d3d-city-geometry.js';
import type { ScenarioPopulationView } from '../population/population-field-loader.js';
import { useSettlementMetadata } from '../settlement/use-settlement-metadata.js';
import { useRoutePresentation } from './use-route-presentation.js';
import {
  createRoutePresentationView,
  projectRoutePresentationVehicles,
  type RoutePresentationView,
} from './route-presentation-view.js';

import { useTerrain } from '../terrain/use-terrain.js';
import {
  createD3dTerrain,
  planD3dTerrain,
  groundCity,
  terrainLayerOffsets,
  type D3dTerrain,
} from './d3d-terrain-model.js';
import {
  createD3dTerrainGeometry,
  drapeD3dGeometry,
} from './d3d-terrain-geometry.js';

type MapProps = Readonly<{
  routePresentation?: RoutePresentationView | undefined;
  scenario: CanonicalScenario;
  fleet: readonly VehicleState[];
  selection: GameSelection;
  onSelectionChange: (selection: GameSelection) => void;
  focusedRouteId?: RouteId | undefined;
  population?: ScenarioPopulationView | undefined;
}>;

/** Visible Vehicle units keep pick priority over broad Stop targets at overlaps.
 * Stable ordering within each tier preserves R3F's distance/instance ordering. */
export function prioritiseD3dEntityHits<T extends { object: { name: string } }>(
  hits: readonly T[],
): T[] {
  return [...hits].sort(
    (a, b) =>
      Number(!a.object.name.startsWith('vehicle-')) -
      Number(!b.object.name.startsWith('vehicle-')),
  );
}
const d3dPointerEvents = (state: Parameters<typeof createPointerEvents>[0]) => {
  const pointerEvents = createPointerEvents(state);
  return {
    ...pointerEvents,
    filter: prioritiseD3dEntityHits,
    connect: (element: HTMLElement) => {
      if (element) pointerEvents.connect?.(element);
    },
  };
};

export function RepresentationFrameDriver({
  mode,
  wrapper,
  driverRef,
  visualState,
}: {
  mode: RepresentationMode;
  wrapper: React.RefObject<HTMLElement | null>;
  driverRef: React.RefObject<ReturnType<
    typeof createD3dDirtyFrameDriver
  > | null>;
  visualState: readonly unknown[];
}) {
  const gl = useThree(({ gl }) => gl);
  const camera = useThree(({ camera }) => camera) as OrthographicCamera;
  const advance = useThree(({ advance }) => advance);
  useEffect(() => {
    const acknowledgeCamera = createD3dCameraAcknowledgement();
    const driver = createD3dDirtyFrameDriver({
      mode,
      now: () => performance.now(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
      frame: (time) => {
        const profile = beginRepresentationProfile('r3f.advance');
        writeD3dDiagnostics(wrapper.current, { terrainRenderedPatches: '0' });
        advance(time);
        writeD3dDiagnostics(wrapper.current, {
          rendererFrames: String(
            Number(wrapper.current?.dataset.rendererFrames ?? 0) + 1,
          ),
          terrainVisiblePatches:
            wrapper.current?.dataset.terrainRenderedPatches ?? '0',
          rendererCalls: String(gl.info.render.calls),
          rendererTriangles: String(gl.info.render.triangles),
          rendererGeometries: String(gl.info.memory.geometries),
        });
        acknowledgeCamera(wrapper.current, camera);
        if (profile) {
          const detail = {
            targetFramesPerSecond:
              representationCadence(mode).targetFramesPerSecond,
          };
          finishRepresentationProfile(profile, detail);
          recordRepresentationProfile('r3f.frame', detail);
        }
      },
    });
    driverRef.current = driver;
    driver.request();
    return () => {
      driver.close();
      // Detached Canvas cleanup must not revoke a replacement root's driver.
      if (driverRef.current === driver) driverRef.current = null;
    };
  }, [advance, mode, camera, wrapper, gl, driverRef]);
  useEffect(() => {
    driverRef.current?.request();
  }, [visualState, driverRef]);
  return null;
}

const cameraDirection = [
  Math.cos((Math.PI * 35) / 180) * Math.SQRT1_2,
  Math.sin((Math.PI * 35) / 180),
  Math.cos((Math.PI * 35) / 180) * Math.SQRT1_2,
] as const;

/** Read-only diagnostics can be published while R3F is detaching its host. */
export function writeD3dDiagnostics(
  element: HTMLElement | null,
  values: Record<string, string>,
) {
  if (element) Object.assign(element.dataset, values);
}

/** Cache belongs to the diagnostic publisher; a newly attached host must receive
 * the current camera even when its coordinates did not change. */
export function createD3dCameraAcknowledgement() {
  let coordinates = '';
  let host: HTMLElement | null = null;
  return (
    element: HTMLElement | null,
    camera: Readonly<{
      zoom: number;
      position: Readonly<{ x: number; z: number }>;
    }>,
  ) => {
    const next =
      camera.zoom + ':' + camera.position.x + ':' + camera.position.z;
    if (next !== coordinates || element !== host) {
      writeD3dDiagnostics(element, {
        renderedCameraZoom: String(camera.zoom),
        renderedCameraTargetX: String(
          camera.position.x - cameraDirection[0] * 150,
        ),
        renderedCameraTargetZ: String(
          camera.position.z - cameraDirection[2] * 150,
        ),
      });
      coordinates = next;
      host = element;
    }
  };
}

/** A native source is ready for visual acceptance only after a terrain mesh draws. */
export function writeD3dRenderedTerrain(
  element: HTMLElement | null,
  identity: string,
  viewportId: string,
) {
  if (element && element.dataset.renderedTerrainIdentity !== identity)
    writeD3dDiagnostics(element, {
      renderedTerrainIdentity: identity,
      renderedTerrainViewport: viewportId,
    });
}

function CameraController({
  model,
  sceneBounds,
  vehicles,
  focusedRouteId,
  mode,
  wrapper,
  onLod,
  onGridWindow,
  initialLod,
  terrain,
  requestFrame,
}: Readonly<{
  model: D3dMapModel;
  sceneBounds: ReturnType<typeof d3dSceneBounds>;
  vehicles: readonly D3dVehicle[];
  focusedRouteId?: RouteId | undefined;
  mode: RepresentationMode;
  wrapper: React.RefObject<HTMLElement | null>;
  onLod: (band: D3dLodBand) => void;
  onGridWindow: (window: TerrainGridWindow | undefined) => void;
  initialLod: D3dLodBand;
  requestFrame: () => void;
  terrain?: D3dTerrain | undefined;
}>) {
  const { camera, size, gl } = useThree();
  const target = useRef(new Vector3());
  // A viewport change rebinds listeners without ending an active gesture.
  const pointers = useRef(new Map<number, { x: number; y: number }>()).current;
  const gesture = useRef({ suppressClick: false, x: 0, y: 0 }).current;
  useEffect(() => () => pointers.clear(), [pointers]);
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;
  const previous = useRef<
    | {
        model: D3dMapModel;
        route: RouteId | undefined;
        mode: RepresentationMode;
        sceneBounds: ReturnType<typeof d3dSceneBounds>;
        width: number;
        height: number;
      }
    | undefined
  >(undefined);
  const normalCamera = useRef<
    | {
        model: D3dMapModel;
        route: RouteId | undefined;
        width: number;
        height: number;
        targetX: number;
        targetZ: number;
        zoom: number;
        kind: 'full' | 'route-fit' | 'manual';
      }
    | undefined
  >(undefined);
  const cameraKind = useRef<'full' | 'route-fit' | 'manual'>('full');
  const lod = useRef<D3dLodBand>(initialLod);
  const fit = useMemo(
    () =>
      fitD3dCamera(
        model,
        mode === 'mini' ? undefined : focusedRouteId,
        size.width,
        size.height,
        sceneBounds,
      ),
    [model, focusedRouteId, mode, size.width, size.height, sceneBounds],
  );
  const fullFit = useMemo(
    () => fitD3dCamera(model, undefined, size.width, size.height, sceneBounds),
    [model, size.width, size.height, sceneBounds],
  );
  const orthographic = camera as OrthographicCamera;
  const publishTargets = useCallback(() => {
    const scale = (Math.max(1, size.height) * orthographic.zoom) / 20;
    const locate = (x: number, y: number, z: number) => {
      const dx = x - target.current.x;
      const dz = z - target.current.z;
      return {
        x: size.width / 2 + (dx - dz) * Math.SQRT1_2 * scale,
        y:
          size.height / 2 -
          (y * Math.cos((Math.PI * 35) / 180) -
            (dx + dz) * Math.SQRT1_2 * Math.sin((Math.PI * 35) / 180)) *
            scale,
      };
    };
    const stop = model.stops.at(-1);
    const vehicle = vehiclesRef.current[0];
    const edge = model.routes[0];
    if (stop) {
      const point = locate(
        stop.x,
        (terrain?.ground(stop.x, stop.z).y ?? 0) +
          (terrain ? terrainLayerOffsets.stop * terrain.metre : 0.045),
        stop.z,
      );
      writeD3dDiagnostics(wrapper.current, {
        pointerStopId: stop.stopPlaceId,
        pointerStopX: String(point.x),
        pointerStopY: String(point.y),
      });
    }
    if (vehicle) {
      const point = locate(
        vehicle.x,
        (terrain?.ground(vehicle.x, vehicle.z).y ?? 0) + 0.8,
        vehicle.z,
      );
      writeD3dDiagnostics(wrapper.current, {
        pointerVehicleId: vehicle.vehicleId,
        pointerVehicleX: String(point.x),
        pointerVehicleY: String(point.y),
      });
    }
    if (edge) {
      const point = locate(
        (edge.from.x + edge.to.x) / 2,
        (terrain?.ground(
          (edge.from.x + edge.to.x) / 2,
          (edge.from.z + edge.to.z) / 2,
        ).y ?? 0) + 0.1,
        (edge.from.z + edge.to.z) / 2,
      );
      writeD3dDiagnostics(wrapper.current, {
        pointerRouteX: String(point.x),
        pointerRouteY: String(point.y),
      });
    }
  }, [model, orthographic, size.width, size.height, wrapper, terrain]);
  const publish = useCallback(
    (kind: 'full' | 'route-fit' | 'manual') => {
      const maximum = maximumD3dZoom(mode, orthographic.zoom, fullFit.maxZoom);
      onGridWindow(
        terrain && maximum
          ? terrainGridWindow(terrain, model, {
              x: target.current.x,
              z: target.current.z,
              zoom: orthographic.zoom,
              width: size.width,
              height: size.height,
            })
          : undefined,
      );
      cameraKind.current = kind;
      requestFrame();
      writeD3dDiagnostics(wrapper.current, {
        cameraMode: kind,
        cameraZoom: String(orthographic.zoom),
        cameraMaxZoom: String(fullFit.maxZoom),
        cameraMaximumZoom: String(maximum),
        cameraTargetX: String(target.current.x),
        cameraTargetZ: String(target.current.z),
        cameraViewportWidth: String(size.width),
        cameraViewportHeight: String(size.height),
      });
      publishTargets();
      const next = maximum
        ? 'near'
        : d3dLodBand(
            20 / (Math.max(1, size.height) * orthographic.zoom),
            mode,
            lod.current,
          );
      if (next !== lod.current) {
        lod.current = next;
        writeD3dDiagnostics(wrapper.current, { lod: next });
        onLod(next);
      }
    },
    [
      wrapper,
      orthographic,
      size.width,
      size.height,
      mode,
      onLod,
      onGridWindow,
      fullFit.maxZoom,
      terrain,
      model,
      publishTargets,
      requestFrame,
    ],
  );
  // R3F may commit while the DOM host is detached during a slot swap.
  useFrame(() => {
    if (
      wrapper.current &&
      wrapper.current.dataset.cameraMode !== cameraKind.current
    )
      publish(cameraKind.current);
  });
  useEffect(() => publishTargets(), [vehicles, publishTargets]);
  const apply = (
    targetX: number,
    targetZ: number,
    zoom: number,
    kind: 'full' | 'route-fit' | 'manual',
  ) => {
    target.current.set(targetX, 0, targetZ);
    orthographic.position.set(
      targetX + cameraDirection[0] * 150,
      cameraDirection[1] * 150,
      targetZ + cameraDirection[2] * 150,
    );
    orthographic.zoom = zoom;
    orthographic.updateProjectionMatrix();
    orthographic.lookAt(target.current);
    orthographic.updateMatrixWorld();
    publish(kind);
  };
  useEffect(() => {
    const aspect = Math.max(1, size.width) / Math.max(1, size.height);
    orthographic.left = -10 * aspect;
    orthographic.right = 10 * aspect;
    orthographic.top = 10;
    orthographic.bottom = -10;
    orthographic.updateProjectionMatrix();
    const prior = previous.current;
    const changedModel = prior?.model !== model;
    const changedMode = prior?.mode !== mode;
    if (prior?.mode === 'normal' && mode === 'mini')
      normalCamera.current = {
        model: prior.model,
        route: prior.route,
        width: prior.width,
        height: prior.height,
        targetX: target.current.x,
        targetZ: target.current.z,
        zoom: orthographic.zoom,
        kind: cameraKind.current,
      };
    if (changedModel) normalCamera.current = undefined;
    if (
      mode === 'normal' &&
      changedMode &&
      normalCamera.current?.model === model &&
      normalCamera.current.route === focusedRouteId &&
      normalCamera.current.width === size.width &&
      normalCamera.current.height === size.height
    )
      apply(
        normalCamera.current.targetX,
        normalCamera.current.targetZ,
        normalCamera.current.zoom,
        normalCamera.current.kind === 'manual'
          ? 'manual'
          : focusedRouteId
            ? 'route-fit'
            : 'full',
      );
    else if (
      prior &&
      !changedModel &&
      !changedMode &&
      prior.route === focusedRouteId &&
      prior.sceneBounds === sceneBounds &&
      cameraKind.current === 'manual'
    )
      apply(target.current.x, target.current.z, orthographic.zoom, 'manual');
    else
      apply(
        fit.targetX,
        fit.targetZ,
        fit.zoom,
        mode === 'mini' || !focusedRouteId ? 'full' : 'route-fit',
      );
    previous.current = {
      model,
      route: focusedRouteId,
      mode,
      sceneBounds,
      width: size.width,
      height: size.height,
    };
  }, [
    model,
    focusedRouteId,
    mode,
    size.width,
    size.height,
    fit,
    sceneBounds,
    orthographic,
    publish,
  ]);

  const pan = (dx: number, dy: number) => {
    const limit = {
      minX: terrain
        ? terrain.bounds.minX
        : Math.min(fullFit.panBounds.minX, sceneBounds.minX * 1.4),
      maxX: terrain
        ? terrain.bounds.maxX
        : Math.max(fullFit.panBounds.maxX, sceneBounds.maxX * 1.4),
      minZ: terrain
        ? terrain.bounds.minZ
        : Math.min(fullFit.panBounds.minZ, sceneBounds.minZ * 1.4),
      maxZ: terrain
        ? terrain.bounds.maxZ
        : Math.max(fullFit.panBounds.maxZ, sceneBounds.maxZ * 1.4),
    };
    const units = 20 / (Math.max(1, size.height) * orthographic.zoom);
    const x = Math.max(
      limit.minX,
      Math.min(
        limit.maxX,
        target.current.x -
          units *
            (dx * Math.SQRT1_2 +
              (dy * Math.SQRT1_2) / Math.sin((Math.PI * 35) / 180)),
      ),
    );
    const z = Math.max(
      limit.minZ,
      Math.min(
        limit.maxZ,
        target.current.z +
          units *
            (dx * Math.SQRT1_2 -
              (dy * Math.SQRT1_2) / Math.sin((Math.PI * 35) / 180)),
      ),
    );
    orthographic.position.x += x - target.current.x;
    orthographic.position.z += z - target.current.z;
    target.current.set(x, 0, z);
    orthographic.lookAt(target.current);
    orthographic.updateMatrixWorld();
    publish('manual');
  };
  const zoom = (factor: number) => {
    orthographic.zoom = Math.max(
      fullFit.minZoom,
      Math.min(fullFit.maxZoom, orthographic.zoom * factor),
    );
    orthographic.updateProjectionMatrix();
    publish('manual');
  };
  useEffect(() => {
    if (mode === 'mini') {
      pointers.clear();
      return;
    }
    const canvas = gl.domElement;
    const down = (event: PointerEvent) => {
      if (pointers.size === 0) {
        gesture.suppressClick = false;
        gesture.x = event.clientX;
        gesture.y = event.clientY;
      } else gesture.suppressClick = true;
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    const move = (event: PointerEvent) => {
      const previousPointer = pointers.get(event.pointerId);
      if (!previousPointer) return;
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4)
        gesture.suppressClick = true;
      if (pointers.size === 1)
        pan(
          event.clientX - previousPointer.x,
          event.clientY - previousPointer.y,
        );
      else {
        const other = [...pointers].find(([id]) => id !== event.pointerId)![1];
        const before = Math.hypot(
          previousPointer.x - other.x,
          previousPointer.y - other.y,
        );
        const after = Math.hypot(
          event.clientX - other.x,
          event.clientY - other.y,
        );
        // Moving either contact moves the pair's midpoint by half its delta.
        pan(
          (event.clientX - previousPointer.x) / 2,
          (event.clientY - previousPointer.y) / 2,
        );
        if (before > 0) zoom(after / before);
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    const up = (event: PointerEvent) => pointers.delete(event.pointerId);
    const click = (event: MouseEvent) => {
      if (gesture.suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(Math.exp(-event.deltaY * 0.001));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('click', click, true);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('click', click, true);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [
    gl,
    mode,
    fullFit,
    sceneBounds,
    size.height,
    orthographic,
    publish,
    terrain,
    pointers,
    gesture,
  ]);
  return null;
}

type D3dTerrainMeshes = readonly Readonly<{
  id: string;
  kind: 'land' | 'water';
  geometry: BufferGeometry;
}>[];
function NativeTerrain({
  onNativeDraw,
  settlementId,
  meshes,
  source,
  wrapper,
  renderLod,
}: {
  onNativeDraw: () => boolean;
  settlementId: string;
  meshes: D3dTerrainMeshes;
  source: D3dTerrain['terrain'];
  renderLod: D3dLodBand;
  wrapper: React.RefObject<HTMLElement | null>;
}) {
  const materials = useMemo(
    () => ({
      land: new MeshLambertMaterial({
        color: resolveTerrainMaterials(settlementId).land,
        vertexColors: true,
      }),
      water: new MeshLambertMaterial({
        color: resolveTerrainMaterials(settlementId).water,
        vertexColors: true,
      }),
    }),
    [settlementId],
  );
  useEffect(
    () => () => {
      materials.land.dispose();
      materials.water.dispose();
    },
    [materials],
  );
  return (
    <group name="native-terrain">
      {meshes.map((p) => (
        <mesh
          key={p.id}
          name={'native-terrain-' + p.kind}
          renderOrder={-20}
          material={materials[p.kind]}
          onAfterRender={() => {
            if (!onNativeDraw()) return;
            // The active presentation token exists only while this host is mounted.
            // Detached callbacks return above, before accessing its ref.
            const element = wrapper.current!;
            element.dataset.terrainRenderedPatches = String(
              Number(element.dataset.terrainRenderedPatches ?? 0) + 1,
            );
            element.dataset.renderedTerrainLod = renderLod;
            writeD3dRenderedTerrain(
              element,
              source.identity,
              source.viewport.terrainViewportId,
            );
          }}
          geometry={p.geometry}
          dispose={null}
          raycast={() => null}
        />
      ))}
    </group>
  );
}

function Terrain({
  sceneBounds,
}: {
  sceneBounds: ReturnType<typeof d3dSceneBounds>;
}) {
  return (
    <mesh
      position={[
        (sceneBounds.minX + sceneBounds.maxX) / 2,
        -0.18,
        (sceneBounds.minZ + sceneBounds.maxZ) / 2,
      ]}
      raycast={() => null}
    >
      <boxGeometry
        args={[
          (sceneBounds.maxX - sceneBounds.minX) * 1.04,
          0.36,
          (sceneBounds.maxZ - sceneBounds.minZ) * 1.04,
        ]}
      />
      <meshLambertMaterial color={d3dMaterialPresets.terrain.land} />
    </mesh>
  );
}

function CityBatch({
  buildings,
  kind,
  layer,
  simple,
  facade = false,
  metre = 1,
}: {
  buildings: readonly CityBuilding[];
  kind: BuildingPrototypeKind;
  layer: 'body' | 'roof';
  simple: boolean;
  facade?: boolean;
  metre?: number;
}) {
  const instances = useRef<import('three').InstancedMesh>(null);
  const geometry = useMemo(() => {
    const value = simple
      ? new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
      : createCityPrototypeGeometry(kind, layer);
    if (facade)
      value.setAttribute('cityFacade', facadeParameters(buildings, metre));
    return value;
  }, [kind, layer, simple, facade, buildings, metre]);
  const material = useMemo(() => {
    const value = new MeshLambertMaterial({ color: '#ffffff' });
    if (facade) {
      value.onBeforeCompile = patchCityFacadeShader;
      value.customProgramCacheKey = () => 'city-wall-facade-v0';
    }
    return value;
  }, [facade]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    const mesh = instances.current!;
    const object = new Object3D();
    const walls = [
      '#d6cbb4',
      '#c8bca6',
      '#e2d8c0',
      '#c7b6a3',
      '#bfa998',
      '#d9c5a6',
    ];
    const roofs = ['#a97559', '#986653', '#b28666', '#727b79', '#9b9180'];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]!;
      object.position.set(b.x, b.baseY, b.z);
      object.rotation.set(0, b.rotation, 0);
      object.scale.set(
        b.width,
        simple && !b.buildingProfileId && !b.cellId
          ? b.height * 0.35
          : b.height,
        b.depth,
      );
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
      mesh.setColorAt(
        i,
        new Color(
          layer === 'roof'
            ? (b.roofColor ?? roofs[b.roofVariant]!)
            : (b.wallColor ?? walls[b.wallVariant]!),
        ),
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [buildings, layer, simple, geometry, material]);
  return (
    <instancedMesh
      name={'city-' + kind + '-' + layer}
      ref={instances}
      args={[geometry, material, buildings.length]}
      raycast={() => null}
    ></instancedMesh>
  );
}

function City({
  facadeEnabled,
  roadsPresented,
  wrapper,
  city,
  lod,
  mode,
  terrain,
}: {
  terrain?: D3dTerrain | undefined;
  facadeEnabled: boolean;
  roadsPresented: boolean;
  city: ProceduralCity;
  wrapper: React.RefObject<HTMLElement | null>;
  lod: D3dLodBand;
  mode: RepresentationMode;
}) {
  const effectiveLod = mode === 'mini' ? 'far' : lod;
  const policy = d3dDrapePolicy(mode, effectiveLod);
  const omitStreets =
    roadsPresented ||
    city.buildingSource === 'street-cells-C' ||
    (terrain !== undefined && !policy.streets);
  const omitGroundOverlays = terrain !== undefined;
  const buildings = cityLodBuildings(city, lod, mode);
  const simple = mode === 'mini' || lod === 'far';
  const groups = useMemo(
    () =>
      simple
        ? buildings.length
          ? [{ kind: 'detached-house' as const, buildings }]
          : []
        : buildingPrototypeKinds
            .map((kind) => ({
              kind,
              buildings: buildings.filter(
                (b) => (b.prototype ?? b.archetype) === kind,
              ),
            }))
            .filter((group) => group.buildings.length > 0),
    [buildings, simple],
  );
  const surfaces = useMemo(
    () => ({
      street: omitStreets
        ? new BufferGeometry()
        : createCitySurfaceGeometry(city, 'street', terrain, effectiveLod),
      ground: omitGroundOverlays
        ? undefined
        : createCitySurfaceGeometry(city, 'ground'),
      landscape: omitGroundOverlays
        ? undefined
        : createCitySurfaceGeometry(city, 'landscape'),
      reservation: createCitySurfaceGeometry(
        city,
        'reservation',
        terrain,
        effectiveLod,
      ),
    }),
    [city, terrain, omitGroundOverlays, omitStreets, effectiveLod],
  );
  useEffect(() => {
    const values: Record<string, string> = {};
    for (const [layer, geometry] of Object.entries(surfaces)) {
      const vertices = geometry?.getAttribute('position')?.count ?? 0;
      values['city' + layer[0]!.toUpperCase() + layer.slice(1) + 'Vertices'] =
        String(vertices);
      values[
        'city' + layer[0]!.toUpperCase() + layer.slice(1) + 'DrapeLimited'
      ] = String(geometry?.userData.drapeLimited === true);
      values['city' + layer[0]!.toUpperCase() + layer.slice(1) + 'Triangles'] =
        String(vertices / 3);
    }
    writeD3dDiagnostics(wrapper.current, values);
  }, [surfaces, wrapper]);
  useEffect(
    () => () => {
      surfaces.street.dispose();
      surfaces.ground?.dispose();
      surfaces.landscape?.dispose();
      surfaces.reservation.dispose();
    },
    [surfaces],
  );
  return (
    <group name="procedural-city">
      {surfaces.landscape ? (
        <mesh
          name="research-landscape"
          geometry={surfaces.landscape}
          raycast={() => null}
        >
          <meshLambertMaterial vertexColors />
        </mesh>
      ) : null}
      <mesh
        name="landmark-reservations"
        geometry={surfaces.reservation}
        raycast={() => null}
      >
        <meshLambertMaterial vertexColors />
      </mesh>
      {surfaces.ground ? (
        <mesh
          name="settlement-ground"
          geometry={surfaces.ground}
          raycast={() => null}
        >
          <meshLambertMaterial vertexColors />
        </mesh>
      ) : null}
      {mode === 'normal' && !omitStreets ? (
        <mesh
          name="provisional-streets"
          geometry={surfaces.street}
          raycast={() => null}
        >
          <meshBasicMaterial vertexColors />
        </mesh>
      ) : null}
      {groups.map((group) => (
        <group key={group.kind}>
          <CityBatch
            buildings={group.buildings}
            kind={group.kind}
            layer="body"
            simple={simple}
            facade={lod === 'near' && !simple && facadeEnabled}
            metre={terrain?.metre ?? 1}
          />
          {!simple && lod === 'near' ? (
            <CityBatch
              buildings={group.buildings}
              kind={group.kind}
              layer="roof"
              simple={false}
            />
          ) : null}
        </group>
      ))}
    </group>
  );
}

export function createD3dRibbonGeometry(
  edges: readonly Pick<
    D3dMapModel['routes'][number],
    'from' | 'to' | 'length' | 'points'
  >[],
  width: number,
  arrows: boolean,
  surfaceY = 0.1,
) {
  const vertices: number[] = [];
  const addTriangle = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
  ) => vertices.push(...a, ...b, ...c);
  const segments = edges.flatMap((edge) =>
    edge.points
      ? edge.points.slice(1).map((to, i) => {
          const from = edge.points![i]!;
          return { from, to, length: Math.hypot(to.x - from.x, to.z - from.z) };
        })
      : [edge],
  );
  for (const edge of segments) {
    if (edge.length < 0.00001) continue;
    const dx = (edge.to.x - edge.from.x) / edge.length;
    const dz = (edge.to.z - edge.from.z) / edge.length;
    const sideX = (dz * width) / 2;
    const sideZ = (-dx * width) / 2;
    const y = arrows ? surfaceY + Math.min(0.06, width * 0.2) : surfaceY;
    if (arrows) {
      const midX = (edge.from.x + edge.to.x) / 2;
      const midZ = (edge.from.z + edge.to.z) / 2;
      const length = Math.min(width * 1.6, edge.length * 0.25);
      addTriangle(
        [midX + dx * length, y, midZ + dz * length],
        [midX - dx * length + sideX, y, midZ - dz * length + sideZ],
        [midX - dx * length - sideX, y, midZ - dz * length - sideZ],
      );
    } else {
      const a = [edge.from.x - sideX, y, edge.from.z - sideZ];
      const b = [edge.from.x + sideX, y, edge.from.z + sideZ];
      const c = [edge.to.x - sideX, y, edge.to.z - sideZ];
      const d = [edge.to.x + sideX, y, edge.to.z + sideZ];
      addTriangle(a, c, b);
      addTriangle(b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(vertices), 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

function Routes({
  wrapper,
  model,
  selection,
  lod,
  metre,
  terrain,
}: {
  terrain?: D3dTerrain | undefined;
  model: D3dMapModel;
  wrapper: React.RefObject<HTMLElement | null>;
  selection: GameSelection;
  lod: D3dLodBand;
  metre: number | undefined;
}) {
  const ribbonWidth = metre
    ? Math.max(3 * metre, lod === 'far' ? 0.24 : lod === 'medium' ? 0.09 : 0)
    : 0.22;
  const groups = useMemo(() => {
    const edgesByRoute = new Map<RouteId, D3dMapModel['routes'][number][]>();
    for (const edge of model.routes) {
      const list = edgesByRoute.get(edge.routeId) ?? [];
      list.push(edge);
      edgesByRoute.set(edge.routeId, list);
    }
    const drape = (
      geometry: BufferGeometry,
      offset: number = terrainLayerOffsets.route,
    ) =>
      terrain
        ? drapeD3dGeometry(
            geometry,
            terrain,
            offset,
            false,
            d3dDrapePolicy('normal', lod).routeMetres * terrain.metre,
          )
        : geometry;
    return [...edgesByRoute].map(([routeId, edges]) => ({
      routeId,
      color: edges[0]!.color,
      enriched: edges[0]!.enriched,
      ribbon: drape(
        createD3dRibbonGeometry(edges, ribbonWidth, false, metre ? 0.052 : 0.1),
      ),
      selected: drape(
        createD3dRibbonGeometry(
          edges,
          edges[0]!.enriched
            ? ribbonWidth * 1.2
            : metre
              ? Math.max(6 * metre, ribbonWidth * 1.6)
              : 0.42,
          false,
          metre ? 0.052 : 0.1,
        ),
      ),
      arrows:
        lod === 'far' || edges[0]!.enriched
          ? new BufferGeometry()
          : drape(
              createD3dRibbonGeometry(
                edges,
                metre ? 5 * metre : 0.36,
                true,
                metre ? 0.052 : 0.1,
              ),
              terrainLayerOffsets.selection,
            ),
    }));
  }, [model, metre, ribbonWidth, terrain, lod]);
  useEffect(() => {
    const vertices = groups.reduce(
      (n, group) =>
        n +
        [group.ribbon, group.selected, group.arrows].reduce(
          (n, g) => n + (g.getAttribute('position')?.count ?? 0),
          0,
        ),
      0,
    );
    writeD3dDiagnostics(wrapper.current, {
      routeDrapeVertices: String(vertices),
      routeDrapeTriangles: String(vertices / 3),
      routeDrapeLimitedGeometryCount: String(
        groups.reduce(
          (n, group) =>
            n +
            [group.ribbon, group.selected, group.arrows].filter(
              (g) => g.userData.drapeLimited === true,
            ).length,
          0,
        ),
      ),
    });
  }, [groups, wrapper]);
  useEffect(
    () => () => {
      for (const group of groups) {
        group.ribbon.dispose();
        group.selected.dispose();
        group.arrows.dispose();
      }
    },
    [groups],
  );
  return (
    <group>
      {[...groups]
        .sort(
          (a, b) =>
            Number(
              selection?.kind === 'route' && selection.routeId === a.routeId,
            ) -
            Number(
              selection?.kind === 'route' && selection.routeId === b.routeId,
            ),
        )
        .map((route) => {
          const chosen =
            selection?.kind === 'route' && selection.routeId === route.routeId;
          return (
            <group key={route.routeId}>
              <mesh
                geometry={chosen ? route.selected : route.ribbon}
                dispose={null}
                raycast={() => null}
                renderOrder={chosen ? 2 : 1}
              >
                <meshBasicMaterial
                  // Thin network overlays stay readable above reduced city drapes;
                  // their world-space heights still use native terrain queries.
                  depthTest={false}
                  color={route.color}
                  transparent={route.enriched === true}
                  opacity={route.enriched && !chosen ? 0.8 : 1}
                  depthWrite={!route.enriched}
                />
              </mesh>
              {chosen && !route.enriched ? (
                <mesh
                  geometry={route.ribbon}
                  dispose={null}
                  raycast={() => null}
                  position={[
                    0,
                    terrain
                      ? (terrainLayerOffsets.selection -
                          terrainLayerOffsets.route) *
                        terrain.metre
                      : 0.022,
                    0,
                  ]}
                >
                  <meshBasicMaterial
                    depthTest={false}
                    color="#fff0bd"
                    transparent
                    opacity={0.7}
                  />
                </mesh>
              ) : null}
              {lod !== 'far' && !route.enriched ? (
                <mesh
                  geometry={route.arrows}
                  dispose={null}
                  raycast={() => null}
                >
                  <meshBasicMaterial color="#183842" depthTest={false} />
                </mesh>
              ) : null}
            </group>
          );
        })}
    </group>
  );
}

function Stops({
  model,
  colors,
  selection,
  onSelectionChange,
  lod,
  mode,
  metre,
  terrain,
}: Readonly<{
  terrain?: D3dTerrain | undefined;
  model: D3dMapModel;
  colors: readonly string[];
  selection: GameSelection;
  onSelectionChange: MapProps['onSelectionChange'];
  lod: D3dLodBand;
  mode: RepresentationMode;
  metre: number | undefined;
}>) {
  const targets = useRef<import('three').InstancedMesh>(null);
  const { camera, size } = useThree();
  const material = useMemo(
    () => new MeshBasicMaterial({ vertexColors: true }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const radius = d3dStopRadius(metre);
  const disks = useMemo(
    () => createD3dStopGeometry(model.stops, colors, radius, terrain),
    [model, colors, radius, terrain],
  );
  useEffect(() => () => disks.dispose(), [disks]);
  const selected =
    selection?.kind === 'stop'
      ? model.stops.find((stop) => stop.stopPlaceId === selection.stopPlaceId)
      : undefined;
  const ring = useMemo(
    () =>
      selected
        ? createD3dStopGeometry(
            [selected],
            ['#f2bc56'],
            radius * 2,
            terrain,
            true,
          )
        : undefined,
    [selected, radius, terrain],
  );
  useEffect(() => () => ring?.dispose(), [ring]);
  const hitZoom = useRef<number | undefined>(undefined);
  const updateTargets = useCallback(() => {
    hitZoom.current = (camera as OrthographicCamera).zoom;
    const dummy = new Object3D();
    for (let i = 0; i < model.stops.length; i++) {
      const stop = model.stops[i]!;
      const ground = terrain?.ground(stop.x, stop.z).y ?? 0;
      dummy.position.set(
        stop.x,
        ground + (terrain ? terrainLayerOffsets.stop * terrain.metre : 0.045),
        stop.z,
      );
      const hitScale = d3dStopHitScale(
        20 / (Math.max(1, size.height) * (camera as OrthographicCamera).zoom),
        metre,
      );
      dummy.scale.set(hitScale.x, hitScale.y, hitScale.z);
      dummy.updateMatrix();
      targets.current!.setMatrixAt(i, dummy.matrix);
    }
    targets.current!.instanceMatrix.needsUpdate = true;
    targets.current!.computeBoundingSphere();
  }, [model, metre, terrain, camera, size.height]);
  useEffect(() => updateTargets(), [updateTargets, lod]);
  const choose = (event: ThreeEvent<MouseEvent>) => {
    if (mode === 'mini' || event.instanceId === undefined || event.delta > 5)
      return;
    event.stopPropagation();
    const stop = model.stops[event.instanceId];
    if (stop) onSelectionChange(selectStop(stop.stopPlaceId));
  };
  return (
    <group>
      <mesh
        name="stop-disks"
        geometry={disks}
        material={material}
        raycast={() => null}
        dispose={null}
      />
      {ring ? (
        <mesh
          name="stop-selection-ring"
          geometry={ring}
          material={material}
          raycast={() => null}
          dispose={null}
        />
      ) : null}
      <instancedMesh
        name="stop-hit-targets"
        ref={targets}
        onBeforeRender={() => {
          if (hitZoom.current !== (camera as OrthographicCamera).zoom)
            updateTargets();
        }}
        args={[undefined, undefined, model.stops.length]}
        onClick={choose}
      >
        <boxGeometry args={[1.25, 0.8, 1.25]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

function VehicleHud({
  color,
  lod,
  mode,
  height,
  choose,
}: Readonly<{
  color: string;
  lod: D3dLodBand;
  mode: RepresentationMode;
  height: number;
  choose: (event: ThreeEvent<MouseEvent>) => void;
}>) {
  const hud = useRef<import('three').Sprite>(null);
  const cssHeight = useThree(({ size }) => size.height);
  return (
    <sprite
      ref={hud}
      name="vehicle-hud"
      position={[0, height, 0]}
      onBeforeRender={(_renderer, _scene, camera) => {
        const orthographic = camera as OrthographicCamera;
        const unit =
          (orthographic.top - orthographic.bottom) /
          orthographic.zoom /
          Math.max(1, cssHeight);
        const pixels =
          mode === 'mini' || lod === 'far' ? 6 : lod === 'medium' ? 12 : 14;
        hud.current!.scale.set(
          pixels * unit,
          pixels * unit * (lod === 'far' ? 1 : 0.7),
          1,
        );
      }}
      onClick={choose}
      renderOrder={3}
    >
      <spriteMaterial color={color} depthTest={false} depthWrite={false} />
    </sprite>
  );
}

function Vehicles({
  vehicles,
  selection,
  onSelectionChange,
  lod,
  mode,
  metre,
  terrain,
}: Readonly<{
  terrain?: D3dTerrain | undefined;
  vehicles: readonly D3dVehicle[];
  selection: GameSelection;
  onSelectionChange: MapProps['onSelectionChange'];
  lod: D3dLodBand;
  mode: RepresentationMode;
  metre: number | undefined;
}>) {
  const body = useMemo(
    () =>
      metre
        ? new BoxGeometry(2.8 * metre, 3.3 * metre, 11 * metre)
        : new BoxGeometry(0.42, 0.3, 0.95),
    [metre],
  );
  const windows = useMemo(
    () =>
      metre
        ? new BoxGeometry(2.82 * metre, 1.1 * metre, 8 * metre)
        : new BoxGeometry(0.43, 0.12, 0.65),
    [metre],
  );
  useEffect(
    () => () => {
      body.dispose();
      windows.dispose();
    },
    [body, windows],
  );
  return (
    <group>
      {vehicles.map((vehicle) => {
        const chosen =
          selection?.kind === 'vehicle' &&
          selection.vehicleId === vehicle.vehicleId;
        const choose = (event: ThreeEvent<MouseEvent>) => {
          if (mode === 'mini' || event.delta > 5) return;
          event.stopPropagation();
          onSelectionChange(selectVehicle(vehicle.vehicleId));
        };
        return (
          <group
            key={vehicle.vehicleId}
            position={[
              vehicle.x,
              terrain
                ? terrain.ground(vehicle.x, vehicle.z).y +
                  (terrainLayerOffsets.vehicle + 1.65) * terrain.metre
                : metre
                  ? 0.052 + 1.65 * metre
                  : 0.32,
              vehicle.z,
            ]}
            rotation={[0, vehicle.headingRadians, 0]}
          >
            {chosen ? (
              <mesh
                position={[
                  0,
                  terrain
                    ? (terrainLayerOffsets.selection -
                        terrainLayerOffsets.vehicle -
                        1.65) *
                      terrain.metre
                    : metre
                      ? 0.016 - 1.65 * metre
                      : -0.15,
                  0,
                ]}
                raycast={() => null}
              >
                <cylinderGeometry
                  args={[
                    metre ? 10 * metre : 0.8,
                    metre ? 10 * metre : 0.8,
                    terrain ? 0.1 * terrain.metre : 0.04,
                    8,
                  ]}
                />
                <meshBasicMaterial color="#f2bc56" />
              </mesh>
            ) : null}
            <mesh
              name="vehicle-body"
              geometry={body}
              dispose={null}
              onClick={choose}
            >
              <meshLambertMaterial color={vehicle.color} />
            </mesh>
            <VehicleHud
              color={vehicle.color}
              lod={lod}
              mode={mode}
              height={metre ? 5 * metre + 0.12 : 0.7}
              choose={choose}
            />
            <mesh
              name="vehicle-hit-target"
              position={[0, 0.48, 0]}
              onClick={choose}
            >
              <boxGeometry args={[1.15, 0.7, 2.2]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {lod !== 'far' ? (
              <mesh
                name="vehicle-windows"
                geometry={windows}
                dispose={null}
                position={[0, metre ? 1.1 * metre : 0.13, 0]}
                onClick={choose}
              >
                <meshLambertMaterial color="#183842" />
              </mesh>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

function D3dWorld({
  onNativeDraw,
  typedCoverPlan,
  onTypedCoversRendered,
  facadeEnabled,
  settlementId,
  materializationPlan,
  streetCellGeometry,
  onStreetCellsInvalidated,
  onStreetCellsRendered,
  onRoadInvalidated,
  onRoadRendered,
  roadMeshes,
  model,
  stopColors,
  sceneBounds,
  city,
  vehicles,
  selection,
  onSelectionChange,
  lod,
  mode,
  terrain,
  terrainMeshes,
  gridGeometry,
  wrapper,
}: Readonly<{
  onNativeDraw: () => boolean;
  typedCoverPlan: TypedLandCoverPlan | undefined;
  onTypedCoversRendered: () => void;
  facadeEnabled: boolean;
  settlementId: string;
  materializationPlan: MaterializationPlan | undefined;
  wrapper: React.RefObject<HTMLElement | null>;
  terrain?: D3dTerrain | undefined;
  streetCellGeometry: BufferGeometry | undefined;
  onStreetCellsInvalidated: () => void;
  onStreetCellsRendered: () => void;
  onRoadInvalidated: () => void;
  onRoadRendered: () => void;
  roadMeshes: RoadMeshes | undefined;
  terrainMeshes: D3dTerrainMeshes | undefined;
  gridGeometry: BufferGeometry | undefined;
  model: D3dMapModel;
  stopColors: readonly string[];
  sceneBounds: ReturnType<typeof d3dSceneBounds>;
  city: ProceduralCity | undefined;
  vehicles: readonly D3dVehicle[];
  selection: GameSelection;
  onSelectionChange: MapProps['onSelectionChange'];
  lod: D3dLodBand;
  mode: RepresentationMode;
}>) {
  // Scene-local identity also rejects callbacks from a detached Canvas root.
  const roadPresentation = useMemo(() => ({}), [roadMeshes, onRoadRendered]);
  const activeRoadPresentation = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeRoadPresentation.current = roadPresentation;
    onRoadInvalidated();
    return () => {
      activeRoadPresentation.current = null;
      onRoadInvalidated();
    };
  }, [roadPresentation, onRoadInvalidated]);
  const cellPresentation = useMemo(
    () => ({}),
    [streetCellGeometry, onStreetCellsRendered],
  );
  const activeCellPresentation = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeCellPresentation.current = cellPresentation;
    onStreetCellsInvalidated();
    return () => {
      activeCellPresentation.current = null;
      onStreetCellsInvalidated();
    };
  }, [cellPresentation, onStreetCellsInvalidated]);
  const cellMaterial = useMemo(
    () =>
      streetCellGeometry
        ? new LineBasicMaterial({
            color: '#7833b2',
            toneMapped: false,
            transparent: true,
            opacity: 0.88,
            depthTest: true,
            depthWrite: false,
          })
        : undefined,
    [streetCellGeometry],
  );
  useEffect(() => () => cellMaterial?.dispose(), [cellMaterial]);
  const roadMaterials = useMemo(
    () => ({
      surface: new MeshBasicMaterial({
        color: '#777a70',
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      bridge: new MeshBasicMaterial({
        color: '#918b73',
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      tunnel: new MeshBasicMaterial({
        color: '#98918c',
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const material of Object.values(roadMaterials)) material.dispose();
    },
    [roadMaterials],
  );
  const gridMaterial = useMemo(
    () =>
      new LineBasicMaterial({
        color: '#53665c',
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => gridMaterial.dispose(), [gridMaterial]);
  const metre =
    terrain?.metre ??
    (city?.settlement ? d3dMetreScale(model).worldUnitsPerMetre : undefined);
  return (
    <>
      <color attach="background" args={['#e3e9dc']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[-40, 80, 30]} intensity={1.6} />
      {terrainMeshes ? (
        <NativeTerrain
          onNativeDraw={onNativeDraw}
          settlementId={settlementId}
          meshes={terrainMeshes}
          source={terrain!.terrain}
          wrapper={wrapper}
          renderLod={mode === 'mini' ? 'far' : lod}
        />
      ) : (
        <Terrain sceneBounds={sceneBounds} />
      )}
      {gridGeometry ? (
        <lineSegments
          name="native-terrain-grid"
          geometry={gridGeometry}
          material={gridMaterial}
          raycast={() => null}
          dispose={null}
        />
      ) : null}
      {typedCoverPlan && typedCoverPlan.batches.length > 0 ? (
        <D3dTypedLandCovers
          plan={typedCoverPlan}
          onDraw={onTypedCoversRendered}
        />
      ) : null}
      {city ? (
        <City
          facadeEnabled={facadeEnabled}
          roadsPresented={roadMeshes !== undefined}
          city={city}
          lod={lod}
          mode={mode}
          terrain={terrain}
          wrapper={wrapper}
        />
      ) : null}
      {roadMeshes?.map((batch) => (
        <mesh
          key={batch.kind}
          name={'road-network-' + batch.kind}
          geometry={batch.geometry}
          material={roadMaterials[batch.kind]}
          raycast={() => null}
          dispose={null}
          onAfterRender={() => {
            if (activeRoadPresentation.current === roadPresentation)
              onRoadRendered();
          }}
        />
      ))}
      {streetCellGeometry && cellMaterial ? (
        <lineSegments
          name="street-cells-boundaries"
          renderOrder={2}
          geometry={streetCellGeometry}
          material={cellMaterial}
          raycast={() => null}
          dispose={null}
          onAfterRender={() => {
            if (activeCellPresentation.current === cellPresentation)
              onStreetCellsRendered();
          }}
        />
      ) : null}
      {materializationPlan ? (
        <D3dMaterialization
          plan={materializationPlan}
          lod={lod}
          wrapper={wrapper}
        />
      ) : null}
      <Routes
        wrapper={wrapper}
        model={model}
        selection={selection}
        lod={lod}
        metre={metre}
        terrain={terrain}
      />
      <Stops
        model={model}
        colors={stopColors}
        selection={selection}
        onSelectionChange={onSelectionChange}
        lod={lod}
        mode={mode}
        metre={metre}
        terrain={terrain}
      />
      <Vehicles
        vehicles={vehicles}
        selection={selection}
        onSelectionChange={onSelectionChange}
        lod={lod}
        mode={mode}
        metre={metre}
        terrain={terrain}
      />
    </>
  );
}

export default function D3dMapRepresentation({
  routePresentation,
  scenario,
  fleet,
  selection,
  onSelectionChange,
  focusedRouteId,
  population,
}: MapProps) {
  const mode = useRepresentationMode();
  const wrapper = useRef<HTMLElement>(null);
  const [lod, setLod] = useState<D3dLodBand>('far');
  const driverRef = useRef<ReturnType<typeof createD3dDirtyFrameDriver> | null>(
    null,
  );
  const requestFrame = useCallback(() => driverRef.current?.request(), []);
  const projection = useMemo(
    () => createTransportMapProjection(scenario),
    [scenario],
  );
  const model = useMemo(() => createD3dMapModel(projection), [projection]);
  const routeAsset = useRoutePresentation(scenario);
  const view =
    routePresentation ??
    createRoutePresentationView(
      createTransportMapProjection(scenario),
      routeAsset,
    );
  const transportModel = useMemo(() => createD3dMapModel(view.map), [view]);
  const settings = resolveD3dAppSettings(scenario.manifest.primarySettlementId);
  const terrainState = useTerrain(
    scenario.manifest.primarySettlementId,
    scenario.manifest.scenarioId,
  );
  const terrain = useMemo(
    () =>
      terrainState.status === 'ready'
        ? createD3dTerrain(
            terrainState.terrain,
            model,
            settings.verticalExaggeration,
          )
        : undefined,
    [terrainState, model, settings.verticalExaggeration],
  );
  // Let the real native surface present before synchronous cold C composition.
  // This schedules presentation only: model inputs and all physical rules stay fixed.
  const [drawnTerrain, setDrawnTerrain] = useState<D3dTerrain>();
  const firstNativeDraw = useRef<D3dTerrain | undefined>(undefined);
  const nativePresentation = useMemo(() => ({}), [terrain, scenario]);
  const activeNativePresentation = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeNativePresentation.current = nativePresentation;
    return () => {
      activeNativePresentation.current = null;
    };
  }, [nativePresentation]);
  const onNativeDraw = useCallback(() => {
    if (activeNativePresentation.current !== nativePresentation) return false;
    if (firstNativeDraw.current !== terrain) {
      firstNativeDraw.current = terrain;
      setDrawnTerrain(terrain);
    }
    return true;
  }, [terrain, nativePresentation]);
  const materializationState = useCityMaterialization(
    scenario.manifest.primarySettlementId,
    lod,
    mode === 'normal' && terrain !== undefined,
  );
  const roadState = useRoadNetwork(
    scenario.manifest.primarySettlementId,
    roadNetworkLevel(mode, lod),
  );
  const roadPreparation = useMemo(() => {
    if (roadState.status !== 'ready') return undefined;
    try {
      const profile = beginRepresentationProfile('road.prepare');
      const plan = prepareD3dRoads(roadState.model, model, terrain);
      finishRepresentationProfile(profile, {
        level: roadState.model.level,
        features: roadState.model.features.length,
        triangles: plan.triangles,
      });
      return {
        status: 'ready' as const,
        plan,
        meshes: plan.batches.map((batch) => ({
          kind: batch.kind,
          geometry: createRoadGeometry(batch),
        })),
      };
    } catch (error) {
      return { status: 'error' as const, message: String(error) };
    }
  }, [roadState, model, terrain]);
  const roadMeshes =
    roadPreparation?.status === 'ready' ? roadPreparation.meshes : undefined;
  const roadLevel =
    roadMeshes && roadState.status === 'ready'
      ? roadState.model.level
      : undefined;
  const roadRequestKey =
    scenario.manifest.primarySettlementId +
    ':' +
    roadNetworkLevel(mode, lod) +
    ':' +
    mode;
  // Parent commit invalidates immediately, even before the independent Canvas
  // root commits its replacement. Acknowledgement is never a load/render-state value.
  const roadPresentation = useMemo(() => ({}), [roadMeshes, roadRequestKey]);
  const activeRoadPresentation = useRef<object | null>(null);
  useLayoutEffect(() => {
    const element = wrapper.current;
    const clear = () => {
      if (element && element.dataset.renderedRoadNetworkLevel !== '')
        writeD3dDiagnostics(element, { renderedRoadNetworkLevel: '' });
    };
    activeRoadPresentation.current = roadPresentation;
    clear();
    return () => {
      activeRoadPresentation.current = null;
      clear();
    };
  }, [roadPresentation]);
  const onRoadInvalidated = useCallback(() => {
    const element = wrapper.current;
    if (
      activeRoadPresentation.current === roadPresentation &&
      element &&
      element.dataset.renderedRoadNetworkLevel !== ''
    )
      writeD3dDiagnostics(element, { renderedRoadNetworkLevel: '' });
  }, [roadPresentation]);
  const onRoadRendered = useCallback(() => {
    const element = wrapper.current;
    if (
      activeRoadPresentation.current === roadPresentation &&
      element &&
      element.dataset.renderedRoadNetworkLevel !== roadLevel
    )
      writeD3dDiagnostics(element, { renderedRoadNetworkLevel: roadLevel! });
  }, [roadPresentation, roadLevel]);
  const [roadBuilds, setRoadBuilds] = useState(0);
  useEffect(() => {
    if (!roadMeshes) return;
    setRoadBuilds((n) => n + 1);
    return () => {
      for (const mesh of roadMeshes) mesh.geometry.dispose();
    };
  }, [roadMeshes]);
  // Building composition requires C independently of camera/slot outline demand.
  // Both hooks share the revision-bound loader's catalog/product promises.
  const buildingCellState = useStreetCells(
    scenario.manifest.primarySettlementId,
    population !== undefined,
    undefined,
    'C',
  );
  const cellOwnedCity =
    ['es-torrevieja', 'es-alicante'].includes(
      scenario.manifest.primarySettlementId,
    ) ||
    (buildingCellState.status !== 'absent' &&
      buildingCellState.status !== 'inactive');
  const buildingCells =
    buildingCellState.status === 'ready' &&
    buildingCellState.model.level === 'C'
      ? buildingCellState.model
      : undefined;
  const typedCoverPreparation = useMemo(() => {
    if (
      !settings.typedLandCovers.visible ||
      mode !== 'normal' ||
      !terrain ||
      drawnTerrain !== terrain ||
      !buildingCells?.masks ||
      materializationState.status === 'loading'
    )
      return undefined;
    try {
      const plan = prepareD3dTypedLandCovers(
        buildingCells.masks,
        model,
        terrain,
        lod,
        materializationState.status === 'ready'
          ? materializationState.model
          : undefined,
      );
      return { status: 'ready' as const, plan };
    } catch (error) {
      return { status: 'error' as const, message: String(error) };
    }
  }, [
    settings.typedLandCovers.visible,
    mode,
    terrain,
    drawnTerrain,
    buildingCells,
    model,
    lod,
    materializationState,
  ]);
  const typedCoverPlan =
    typedCoverPreparation?.status === 'ready'
      ? typedCoverPreparation.plan
      : undefined;
  const typedCoverToken = useMemo(
    () => ({}),
    [typedCoverPlan, scenario, mode, terrain],
  );
  const activeTypedCovers = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeTypedCovers.current = typedCoverToken;
    const element = wrapper.current;
    if (element && element.dataset.renderedTypedCoversIdentity !== '')
      element.dataset.renderedTypedCoversIdentity = '';
    return () => {
      activeTypedCovers.current = null;
      if (element && element.dataset.renderedTypedCoversIdentity !== '')
        element.dataset.renderedTypedCoversIdentity = '';
    };
  }, [typedCoverToken]);
  const onTypedCoversRendered = useCallback(() => {
    const element = wrapper.current;
    if (
      activeTypedCovers.current === typedCoverToken &&
      typedCoverPlan &&
      element &&
      element.dataset.renderedTypedCoversIdentity !== typedCoverPlan.identity
    )
      element.dataset.renderedTypedCoversIdentity = typedCoverPlan.identity;
  }, [typedCoverToken, typedCoverPlan]);
  const [typedCoverBuilds, setTypedCoverBuilds] = useState(0);
  useEffect(() => {
    if (typedCoverPlan?.batches.length) setTypedCoverBuilds((n) => n + 1);
  }, [typedCoverPlan]);
  const typedCoverFailures = useMemo(
    () => JSON.stringify(typedCoverPlan?.failures ?? []),
    [typedCoverPlan],
  );
  const streetCellActive =
    settings.streetCells.showBoundaries &&
    mode === 'normal' &&
    terrain !== undefined;
  const streetCellLevel = lod === 'far' ? 'A' : lod === 'medium' ? 'B' : 'C';
  const streetCellState = useStreetCells(
    scenario.manifest.primarySettlementId,
    streetCellActive,
    undefined,
    streetCellLevel,
  );
  const streetCellModel =
    streetCellState.status === 'ready' &&
    streetCellState.model.level === streetCellLevel
      ? streetCellState.model
      : undefined;
  const streetCellPreparation = useMemo(() => {
    if (!streetCellActive || !streetCellModel) return undefined;
    try {
      const profile = beginRepresentationProfile('street-cells.prepare');
      const plan = prepareD3dStreetCells(streetCellModel, model, terrain);
      finishRepresentationProfile(profile, {
        cells: plan.cells,
        segments: plan.segments,
      });
      return {
        status: 'ready' as const,
        plan,
        geometry: plan.vertices ? createStreetCellGeometry(plan) : undefined,
      };
    } catch (error) {
      return { status: 'error' as const, message: String(error) };
    }
  }, [streetCellActive, streetCellModel, model, terrain]);
  const streetCellGeometry =
    streetCellPreparation?.status === 'ready'
      ? streetCellPreparation.geometry
      : undefined;
  const cellPlan =
    streetCellPreparation?.status === 'ready'
      ? streetCellPreparation.plan
      : undefined;
  const cellRejections = useMemo(
    () => JSON.stringify(cellPlan?.rejectedCells ?? []),
    [cellPlan],
  );
  const [streetCellBuilds, setStreetCellBuilds] = useState(0);
  useEffect(() => {
    if (!streetCellGeometry) return;
    setStreetCellBuilds((n) => n + 1);
    return () => streetCellGeometry.dispose();
  }, [streetCellGeometry]);
  const cellPresentation = useMemo(
    () => ({}),
    [streetCellGeometry, scenario, mode, lod, terrain],
  );
  const activeCellPresentation = useRef<object | null>(null);
  useLayoutEffect(() => {
    const element = wrapper.current;
    const clear = () => {
      if (element && element.dataset.renderedStreetCellsLevel !== '')
        writeD3dDiagnostics(element, { renderedStreetCellsLevel: '' });
    };
    activeCellPresentation.current = cellPresentation;
    clear();
    return () => {
      activeCellPresentation.current = null;
      clear();
    };
  }, [cellPresentation]);
  const onStreetCellsInvalidated = useCallback(() => {
    const element = wrapper.current;
    if (
      activeCellPresentation.current === cellPresentation &&
      element &&
      element.dataset.renderedStreetCellsLevel !== ''
    )
      writeD3dDiagnostics(element, { renderedStreetCellsLevel: '' });
  }, [cellPresentation]);
  const onStreetCellsRendered = useCallback(() => {
    const element = wrapper.current;
    if (
      streetCellGeometry &&
      activeCellPresentation.current === cellPresentation &&
      element &&
      element.dataset.renderedStreetCellsLevel !== streetCellLevel
    )
      writeD3dDiagnostics(element, {
        renderedStreetCellsLevel: streetCellLevel,
      });
  }, [cellPresentation, streetCellGeometry, streetCellLevel]);
  const preferredStopRoute =
    focusedRouteId ??
    (selection?.kind === 'route' ? selection.routeId : undefined);
  const stopColors = useMemo(
    () => d3dStopColors(transportModel, scenario, preferredStopRoute),
    [transportModel, scenario, preferredStopRoute],
  );
  const [gridView, setGridView] = useState<
    Readonly<{ terrain: D3dTerrain; window: TerrainGridWindow }> | undefined
  >();
  const onGridWindow = useCallback(
    (window: TerrainGridWindow | undefined) => {
      setGridView((previous) => {
        if (!terrain || !window) return undefined;
        if (
          previous?.terrain === terrain &&
          previous.window.col === window.col &&
          previous.window.row === window.row &&
          previous.window.endCol === window.endCol &&
          previous.window.endRow === window.endRow
        )
          return previous;
        return { terrain, window };
      });
    },
    [terrain],
  );
  const gridGeometry = useMemo(
    () =>
      gridView?.terrain === terrain && gridView
        ? createTerrainGridGeometry(gridView.terrain, gridView.window)
        : undefined,
    [gridView, terrain],
  );
  const [gridBuilds, setGridBuilds] = useState(0);
  useEffect(() => {
    if (!gridGeometry) return;
    setGridBuilds((n) => n + 1);
    return () => gridGeometry.dispose();
  }, [gridGeometry]);
  const terrainPlan = terrain
    ? planD3dTerrain(terrain, { representationMode: mode, lod })
    : undefined;
  const terrainMeshes = useMemo(
    () =>
      terrainPlan?.patches.map((p) => ({
        id: p.id,
        kind: p.kind,
        geometry: createD3dTerrainGeometry(p),
      })),
    [terrainPlan],
  );
  const [terrainGeometryBuilds, setTerrainGeometryBuilds] = useState(0);
  useEffect(() => {
    if (!terrainMeshes) return;
    setTerrainGeometryBuilds((count) => count + 1);
    return () => {
      for (const mesh of terrainMeshes) mesh.geometry.dispose();
    };
  }, [terrainMeshes]);
  const metadata = useSettlementMetadata(scenario.manifest.primarySettlementId);
  const cellProtections = useMemo(
    () =>
      metadata.status === 'ready'
        ? streetCellLandmarkProtections(model, metadata)
        : undefined,
    [model, metadata],
  );
  const cellCityPreparation = useMemo(() => {
    if (!cellOwnedCity || !population || (terrain && drawnTerrain !== terrain))
      return undefined;
    try {
      if (
        buildingCells &&
        buildingCells.settlementId !== scenario.manifest.primarySettlementId
      )
        throw new Error('StreetCell C settlement mismatch');
      const profile = beginRepresentationProfile('street-cell-city.prepare');
      const city = buildStreetCellCity(
        model,
        population,
        metadata.status === 'ready' ? metadata : undefined,
        buildingCells,
        terrain,
        cellProtections,
      );
      finishRepresentationProfile(profile, {
        buildings: city.buildings.length,
      });
      return { status: 'ready' as const, city };
    } catch (error) {
      return {
        status: 'error' as const,
        message: String(error),
        city: buildStreetCellCity(
          model,
          population,
          metadata.status === 'ready' ? metadata : undefined,
        ),
      };
    }
  }, [
    cellOwnedCity,
    drawnTerrain,
    model,
    population,
    metadata,
    buildingCells,
    terrain,
    cellProtections,
    scenario.manifest.primarySettlementId,
  ]);
  const generatedCity = useMemo(
    () =>
      cellOwnedCity
        ? cellCityPreparation?.city
        : population && metadata.status !== 'loading'
          ? buildProceduralCity(
              model,
              population,
              metadata.status === 'ready' ? metadata : undefined,
            )
          : undefined,
    [cellOwnedCity, cellCityPreparation, model, population, metadata],
  );
  const [cityLayoutBuilds, setCityLayoutBuilds] = useState(0);
  // Publish the committed-plan counter before observers can capture its baseline.
  useLayoutEffect(() => {
    if (generatedCity) setCityLayoutBuilds((n) => n + 1);
  }, [generatedCity]);
  const cellLayout = generatedCity?.streetCellLayout;
  const cellSkipped = useMemo(
    () =>
      JSON.stringify(
        cellLayout?.skippedCells.reduce<Record<string, number>>(
          (counts, cell) => {
            counts[cell.reason] = (counts[cell.reason] ?? 0) + 1;
            return counts;
          },
          {},
        ) ?? {},
      ),
    [cellLayout],
  );
  const city = useMemo(
    () =>
      generatedCity && terrain
        ? groundCity(generatedCity, terrain)
        : generatedCity,
    [generatedCity, terrain],
  );
  const sceneBounds = useMemo(
    () =>
      terrain
        ? terrain.bounds
        : d3dSceneBounds(
            model,
            population ? populationSpace(model, population).bounds : undefined,
          ),
    [model, population, terrain],
  );
  const acceptedFleet = useLatestRepresentationValue(fleet);
  const vehicles = useMemo(
    () =>
      projectD3dVehicles(
        model,
        projectRoutePresentationVehicles(
          view,
          projectTransportMapVehicles(view.source, acceptedFleet),
        ),
      ),
    [model, view, acceptedFleet],
  );
  const candidates = useMemo(
    () => d3dKeyboardCandidates(model, vehicles),
    [model, vehicles],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const materializationPreparation = useMemo(() => {
    if (
      materializationState.status !== 'ready' ||
      !terrain ||
      mode !== 'normal'
    )
      return undefined;
    try {
      const plan = prepareCityMaterialization(
        materializationState.model,
        model,
        terrain,
        lod,
      );
      const overlaps = city
        ? diagnoseMaterializationOverlaps(
            materializationState.model,
            model,
            city,
          )
        : [];
      return { status: 'ready' as const, plan, overlaps };
    } catch (error) {
      return { status: 'error' as const, message: String(error) };
    }
  }, [materializationState, model, terrain, lod, city, mode]);
  const materializationError =
    materializationPreparation?.status === 'error'
      ? materializationPreparation.message
      : materializationState.status === 'error'
        ? materializationState.message
        : undefined;
  const materializationPlan =
    materializationPreparation?.status === 'ready'
      ? materializationPreparation.plan
      : undefined;
  useLayoutEffect(() => {
    // This layout effect always commits with the root host mounted.
    wrapper.current!.dataset.renderedMaterializationLevel = '';
  }, [materializationPlan, lod, scenario, mode]);
  const visualState = useMemo(
    () => [
      transportModel,
      sceneBounds,
      city,
      terrainMeshes,
      gridGeometry,
      roadMeshes,
      streetCellGeometry,
      typedCoverPlan,
      materializationPlan,
      vehicles,
      selection,
      focusedRouteId,
      lod,
      mode,
    ],
    [
      transportModel,
      sceneBounds,
      city,
      terrainMeshes,
      gridGeometry,
      roadMeshes,
      streetCellGeometry,
      typedCoverPlan,
      materializationPlan,
      vehicles,
      selection,
      focusedRouteId,
      lod,
      mode,
    ],
  );
  const currentCandidate =
    candidates[Math.min(candidateIndex, candidates.length - 1)];
  const cadence = representationCadence(mode);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (candidates.length === 0) return;
    const last = candidates.length - 1;
    let next: number;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
      next = (candidateIndex + 1) % candidates.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
      next = (candidateIndex - 1 + candidates.length) % candidates.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectionChange(selectD3dCandidate(currentCandidate!));
      return;
    } else return;
    event.preventDefault();
    setCandidateIndex(next);
  };
  return (
    <section
      ref={wrapper}
      className="scene d3d-map-representation"
      data-typed-masks-status={
        buildingCellState.status === 'ready'
          ? buildingCells?.masks
            ? 'ready'
            : 'legacy'
          : buildingCellState.status
      }
      data-typed-masks-availability={buildingCells?.masks?.availability ?? ''}
      data-typed-masks-count={buildingCells?.masks?.features.length ?? 0}
      data-typed-masks-omitted-capacity={
        buildingCells?.masks?.omittedCapacity ?? 0
      }
      data-typed-masks-missing-selectors={JSON.stringify(
        buildingCells?.masks?.missingSelectors ?? [],
      )}
      data-typed-mask-rejections={cellLayout?.maskRejections ?? 0}
      data-typed-mask-conflicts={cellLayout?.maskConflicts ?? 0}
      data-typed-covers-status={
        typedCoverPreparation?.status === 'error'
          ? 'error'
          : typedCoverPlan
            ? typedCoverPlan.failures.length
              ? 'partial'
              : 'ready'
            : 'inactive'
      }
      data-typed-covers-error={
        typedCoverPreparation?.status === 'error'
          ? typedCoverPreparation.message
          : ''
      }
      data-typed-covers-identity={typedCoverPlan?.identity ?? ''}
      data-typed-covers-failures={typedCoverFailures}
      data-typed-covers-features={typedCoverPlan?.features ?? 0}
      data-typed-covers-outside-support-triangles={
        typedCoverPlan?.outsideSupportTriangles ?? 0
      }
      data-typed-covers-native-water-land-cover-triangles={
        typedCoverPlan?.nativeWaterLandCoverTriangles ?? 0
      }
      data-typed-covers-triangles={typedCoverPlan?.triangles ?? 0}
      data-typed-covers-bytes={typedCoverPlan?.bytes ?? 0}
      data-typed-covers-batches={typedCoverPlan?.batches.length ?? 0}
      data-typed-covers-plan-builds={typedCoverBuilds}
      aria-label="Three-dimensional transport Map"
      data-testid="d3d-map-representation"
      data-materialization-status={
        materializationPreparation?.status === 'error'
          ? 'error'
          : materializationState.status
      }
      data-materialization-error={materializationError ?? ''}
      data-materialization-sites={materializationPlan?.diagnostics.length ?? 0}
      data-materialization-triangles={materializationPlan?.triangles ?? 0}
      data-materialization-instances={
        materializationPlan?.instances.length ?? 0
      }
      data-materialization-overlaps={
        materializationPreparation?.status === 'ready'
          ? JSON.stringify(materializationPreparation.overlaps)
          : ''
      }
      data-materialization-diagnostics={
        materializationPlan
          ? JSON.stringify(materializationPlan.diagnostics)
          : ''
      }
      data-scenario-id={scenario.manifest.scenarioId}
      data-representation-mode={mode}
      data-target-frames-per-second={cadence.targetFramesPerSecond}
      data-route-count={
        new Set(model.routes.map((route) => route.routeId)).size
      }
      data-directed-edge-count={model.routes.length}
      data-stop-place-count={model.stops.length}
      data-vehicle-count={vehicles.length}
      data-vehicle-movement-kind={acceptedFleet[0]?.movement.kind ?? ''}
      data-enriched-edge-count={
        view.map.edges.filter((edge) => edge.enriched).length
      }
      data-vehicle-hud-count={vehicles.length}
      data-street-cells-status={
        !settings.streetCells.showBoundaries
          ? 'hidden'
          : !streetCellActive
            ? 'inactive'
            : streetCellPreparation?.status === 'error'
              ? 'error'
              : streetCellState.status
      }
      data-street-cells-level={streetCellGeometry ? streetCellLevel : ''}
      data-rendered-street-cells-level=""
      data-street-cells-count={cellPlan?.cells ?? 0}
      data-street-cells-displayed-count={cellPlan?.displayedCells ?? 0}
      data-street-cells-nondrawable-count={cellPlan?.rejectedCells.length ?? 0}
      data-street-cells-nondrawable-cells={cellRejections}
      data-street-cells-display-edges={cellPlan?.displayEdges ?? 0}
      data-street-cells-unique-edges={cellPlan?.uniqueEdges ?? 0}
      data-street-cells-raw-edges={cellPlan?.rawEdges ?? 0}
      data-street-cells-segments={cellPlan?.segments ?? 0}
      data-street-cells-supports={cellPlan?.supports ?? 0}
      data-street-cells-vertices={cellPlan?.vertices ?? 0}
      data-street-cells-geometry-bytes={cellPlan?.positions.byteLength ?? 0}
      data-street-cells-batches={streetCellGeometry ? 1 : 0}
      data-street-cells-geometry-builds={streetCellBuilds}
      data-street-cells-error={
        streetCellPreparation?.status === 'error'
          ? streetCellPreparation.message
          : streetCellState.status === 'error'
            ? streetCellState.message
            : ''
      }
      data-road-network-status={
        roadPreparation?.status === 'error' ? 'error' : roadState.status
      }
      data-road-network-requested-level={roadNetworkLevel(mode, lod)}
      data-road-network-level={roadLevel ?? ''}
      data-rendered-road-network-level=""
      data-road-network-features={
        roadLevel && roadState.status === 'ready'
          ? roadState.model.features.length
          : 0
      }
      data-road-network-error={
        roadPreparation?.status === 'error'
          ? roadPreparation.message
          : roadState.status === 'error'
            ? roadState.message
            : ''
      }
      data-road-network-geometry-builds={roadBuilds}
      data-road-network-batches={roadMeshes?.length ?? 0}
      data-road-network-vertices={
        roadPreparation?.status === 'ready' ? roadPreparation.plan.vertices : 0
      }
      data-road-network-triangles={
        roadPreparation?.status === 'ready' ? roadPreparation.plan.triangles : 0
      }
      data-road-network-fallback-supports={
        roadPreparation?.status === 'ready'
          ? roadPreparation.plan.fallbackSupports
          : 0
      }
      data-terrain-geometry-builds={terrainGeometryBuilds}
      data-terrain-elevation-scale={
        terrain?.verticalExaggeration ?? settings.verticalExaggeration
      }
      data-terrain-grid-visible={Boolean(gridGeometry)}
      data-terrain-grid-window={
        gridGeometry ? JSON.stringify(gridView!.window) : ''
      }
      data-terrain-grid-segments={
        gridGeometry ? gridGeometry.getAttribute('position').count / 2 : 0
      }
      data-terrain-grid-builds={gridBuilds}
      data-terrain-status={terrainState.status}
      data-terrain-error={
        terrainState.status === 'error' ? terrainState.message : ''
      }
      data-terrain-identity={terrain?.terrain.identity ?? ''}
      data-terrain-viewport={terrain?.terrain.viewport.terrainViewportId ?? ''}
      data-terrain-width={terrain?.terrain.viewport.width ?? 0}
      data-terrain-height={terrain?.terrain.viewport.height ?? 0}
      data-terrain-resolution-x={terrain?.terrain.resolution.x ?? 0}
      data-terrain-resolution-y={terrain?.terrain.resolution.y ?? 0}
      data-terrain-min-elevation={
        terrain?.terrain.statistics.minElevation ?? ''
      }
      data-terrain-max-elevation={
        terrain?.terrain.statistics.maxElevation ?? ''
      }
      data-terrain-native-samples={
        terrain?.terrain.statistics.nativeSamples ?? 0
      }
      data-terrain-land-samples={terrain?.terrain.statistics.landSamples ?? 0}
      data-terrain-water-samples={terrain?.terrain.statistics.waterSamples ?? 0}
      data-terrain-vertices={terrainPlan?.vertices ?? 0}
      data-terrain-triangles={terrainPlan?.triangles ?? 0}
      data-terrain-meshes={terrainPlan?.patches.length ?? 0}
      data-terrain-render-lod={terrainPlan?.lod ?? ''}
      data-terrain-render-stride={terrainPlan?.stride ?? 0}
      data-settlement-metadata-status={metadata.status}
      data-settlement-metadata-version={
        city?.settlement?.metadata.schemaVersion ?? ''
      }
      data-research-district-count={
        city?.settlement?.metadata.districts.length ?? 0
      }
      data-morphology-zone-count={city?.settlement?.metadata.zones.length ?? 0}
      data-population-cells-with-zone={
        city?.settlement?.diagnostics.cellsWithZone ?? 0
      }
      data-population-cells-without-zone={
        city?.settlement?.diagnostics.cellsWithoutZone ?? 0
      }
      data-population-cells-with-zone-overlap={
        city?.settlement?.diagnostics.cellsWithZoneOverlap ?? 0
      }
      data-landscape-suppressed-count={
        city?.settlement?.diagnostics.landscapeSuppressedCells ?? 0
      }
      data-landmark-zone-mismatch-count={
        city?.settlement?.diagnostics.landmarkZoneMismatches.length ?? 0
      }
      data-cell-buildings-awaiting-terrain-draw={Boolean(
        terrain && drawnTerrain !== terrain,
      )}
      data-cell-buildings-status={
        cellOwnedCity
          ? cellCityPreparation?.status === 'error'
            ? 'error'
            : buildingCellState.status
          : 'inactive'
      }
      data-cell-buildings-error={
        cellCityPreparation?.status === 'error'
          ? cellCityPreparation.message
          : buildingCellState.status === 'error'
            ? buildingCellState.message
            : ''
      }
      data-city-layout-builds={cityLayoutBuilds}
      data-cell-buildings-source-cells={cellLayout?.sourceCells ?? 0}
      data-cell-buildings-empty={cellLayout?.empty ?? 0}
      data-cell-buildings-road-crossed={cellLayout?.roadCrossed ?? 0}
      data-cell-buildings-non-drawable={cellLayout?.nonDrawable ?? 0}
      data-cell-buildings-usable-empty={cellLayout?.usableEmptyCells ?? 0}
      data-cell-buildings-pass1={JSON.stringify(cellLayout?.pass1 ?? {})}
      data-cell-buildings-pass2={JSON.stringify(cellLayout?.pass2 ?? {})}
      data-cell-buildings-urban={cellLayout?.urbanBuildings ?? 0}
      data-cell-buildings-suburban={cellLayout?.suburbanBuildings ?? 0}
      data-cell-buildings-frontage={cellLayout?.frontageBuildings ?? 0}
      data-cell-buildings-interior={cellLayout?.interiorBuildings ?? 0}
      data-cell-buildings-skipped={cellSkipped}
      data-cell-buildings-samples={JSON.stringify(cellLayout?.samples ?? {})}
      data-cell-buildings-rejected={JSON.stringify(
        cellLayout?.rejectedCandidates ?? {},
      )}
      data-cell-buildings-outside-safe-zone={cellLayout?.outsideSafeZone ?? 0}
      data-cell-buildings-ineligible={cellLayout?.ineligible ?? 0}
      data-city-component-count={city?.components.length ?? 0}
      data-city-block-count={city?.blocks.length ?? 0}
      data-city-building-count={city?.buildings.length ?? 0}
      data-city-archetype-count={
        new Set(city?.buildings.map((b) => b.archetype)).size
      }
      data-city-lod={mode === 'mini' ? 'far' : lod}
      data-city-building-instances={
        city ? cityLodBuildings(city, lod, mode).length : 0
      }
      data-city-mesh-instances={
        city
          ? cityLodBuildings(city, lod, mode).length *
            (mode === 'normal' && lod === 'near' ? 2 : 1)
          : 0
      }
      data-city-roof-instances={
        city && mode === 'normal' && lod === 'near' ? city.buildings.length : 0
      }
      data-selected-kind={selection?.kind ?? ''}
      data-selected-stop-id={
        selection?.kind === 'stop' ? selection.stopPlaceId : ''
      }
      data-focused-route-id={focusedRouteId ?? ''}
      data-lod="far"
    >
      <Canvas
        key={terrain?.terrain.identity ?? 'fallback'}
        frameloop="never"
        events={d3dPointerEvents}
        orthographic
        camera={{
          position: [100, 100, 100],
          left: -10,
          right: 10,
          top: 10,
          bottom: -10,
          near: 0.1,
          far: 1000,
        }}
        fallback={
          <p>
            3D renderer unavailable. Choose another representation using the
            mini view.
          </p>
        }
      >
        <RepresentationFrameDriver
          mode={mode}
          wrapper={wrapper}
          driverRef={driverRef}
          visualState={visualState}
        />
        <CameraController
          model={transportModel}
          sceneBounds={sceneBounds}
          vehicles={vehicles}
          focusedRouteId={focusedRouteId}
          mode={mode}
          wrapper={wrapper}
          onLod={setLod}
          onGridWindow={onGridWindow}
          initialLod={lod}
          requestFrame={requestFrame}
          terrain={terrain}
        />
        <D3dWorld
          onNativeDraw={onNativeDraw}
          typedCoverPlan={typedCoverPlan}
          onTypedCoversRendered={onTypedCoversRendered}
          facadeEnabled={settings.city.nearFacades}
          settlementId={scenario.manifest.primarySettlementId}
          materializationPlan={materializationPlan}
          streetCellGeometry={streetCellGeometry}
          onStreetCellsInvalidated={onStreetCellsInvalidated}
          onStreetCellsRendered={onStreetCellsRendered}
          onRoadInvalidated={onRoadInvalidated}
          onRoadRendered={onRoadRendered}
          roadMeshes={roadMeshes}
          model={transportModel}
          stopColors={stopColors}
          sceneBounds={sceneBounds}
          city={city}
          terrain={terrain}
          terrainMeshes={terrainMeshes}
          gridGeometry={gridGeometry}
          wrapper={wrapper}
          vehicles={vehicles}
          selection={selection}
          onSelectionChange={onSelectionChange}
          lod={lod}
          mode={mode}
        />
      </Canvas>
      {mode === 'normal' && materializationError !== undefined ? (
        <p role="status">City sites unavailable: {materializationError}</p>
      ) : null}
      {mode === 'normal' && buildingCellState.status === 'error' ? (
        <p role="status">City cells unavailable: {buildingCellState.message}</p>
      ) : null}
      {mode === 'normal' && typedCoverPreparation?.status === 'error' ? (
        <p role="status">
          Land covers unavailable: {typedCoverPreparation.message}
        </p>
      ) : null}
      {mode === 'normal' ? (
        <div
          className="d3d-keyboard-control"
          role="group"
          tabIndex={0}
          aria-label="3D Map selection. Use arrow keys to choose a stop or vehicle, then Enter to select."
          aria-describedby="d3d-selection-status"
          onKeyDown={onKeyDown}
        >
          <span id="d3d-selection-status" aria-live="polite">
            {currentCandidate
              ? `${currentCandidate.kind === 'stop' ? 'StopPlace' : 'Vehicle'}: ${currentCandidate.label}`
              : 'No selectable objects'}
          </span>
        </div>
      ) : null}
    </section>
  );
}
