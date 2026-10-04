import {
  Canvas,
  events as createPointerEvents,
  useThree,
  type ThreeEvent,
} from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Object3D,
  OrthographicCamera,
  Vector3,
} from 'three';
import {
  useCallback,
  useEffect,
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
  createRepresentationFrameDriver,
  representationCadence,
  type RepresentationMode,
} from './representation-cadence.js';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from '../performance/representation-profiler.js';
import {
  createTransportMapProjection,
  projectTransportMapVehicles,
} from './transport-map-projection.js';
import {
  createD3dMapModel,
  d3dKeyboardCandidates,
  d3dLodBand,
  fitD3dCamera,
  projectD3dVehicles,
  d3dSceneBounds,
  d3dMetreScale,
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
  buildingArchetypes,
  populationSpace,
  type ProceduralCity,
  type CityBuilding,
  type BuildingArchetype,
} from './d3d-city-model.js';
import {
  createCityPrototypeGeometry,
  createCitySurfaceGeometry,
} from './d3d-city-geometry.js';
import type { ScenarioPopulationView } from '../population/population-field-loader.js';
import { useSettlementMetadata } from '../settlement/use-settlement-metadata.js';

type MapProps = Readonly<{
  scenario: CanonicalScenario;
  fleet: readonly VehicleState[];
  selection: GameSelection;
  onSelectionChange: (selection: GameSelection) => void;
  focusedRouteId?: RouteId | undefined;
  population?: ScenarioPopulationView | undefined;
}>;

const d3dPointerEvents = (state: Parameters<typeof createPointerEvents>[0]) => {
  const pointerEvents = createPointerEvents(state);
  return {
    ...pointerEvents,
    connect: (element: HTMLElement) => {
      if (element) pointerEvents.connect?.(element);
    },
  };
};

function RepresentationFrameDriver({ mode }: { mode: RepresentationMode }) {
  const advance = useThree(({ advance }) => advance);
  useEffect(() => {
    const driver = createRepresentationFrameDriver({
      mode,
      now: () => performance.now(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
      frame: (time) => {
        const profile = beginRepresentationProfile('r3f.advance');
        advance(time);
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
    return () => driver.close();
  }, [advance, mode]);
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

function CameraController({
  model,
  sceneBounds,
  vehicles,
  focusedRouteId,
  mode,
  wrapper,
  onLod,
}: Readonly<{
  model: D3dMapModel;
  sceneBounds: ReturnType<typeof d3dSceneBounds>;
  vehicles: readonly D3dVehicle[];
  focusedRouteId?: RouteId | undefined;
  mode: RepresentationMode;
  wrapper: React.RefObject<HTMLElement | null>;
  onLod: (band: D3dLodBand) => void;
}>) {
  const { camera, size, gl } = useThree();
  const target = useRef(new Vector3());
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;
  const previous = useRef<
    | {
        model: D3dMapModel;
        route: RouteId | undefined;
        mode: RepresentationMode;
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
  const lod = useRef<D3dLodBand>('far');
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
      const point = locate(stop.x, 0.3, stop.z);
      writeD3dDiagnostics(wrapper.current, {
        pointerStopId: stop.stopPlaceId,
        pointerStopX: String(point.x),
        pointerStopY: String(point.y),
      });
    }
    if (vehicle) {
      const point = locate(vehicle.x, 0.8, vehicle.z);
      writeD3dDiagnostics(wrapper.current, {
        pointerVehicleId: vehicle.vehicleId,
        pointerVehicleX: String(point.x),
        pointerVehicleY: String(point.y),
      });
    }
    if (edge) {
      const point = locate(
        (edge.from.x + edge.to.x) / 2,
        0.1,
        (edge.from.z + edge.to.z) / 2,
      );
      writeD3dDiagnostics(wrapper.current, {
        pointerRouteX: String(point.x),
        pointerRouteY: String(point.y),
      });
    }
  }, [model, orthographic, size.width, size.height, wrapper]);
  const publish = useCallback(
    (kind: 'full' | 'route-fit' | 'manual') => {
      cameraKind.current = kind;
      writeD3dDiagnostics(wrapper.current, {
        cameraMode: kind,
        cameraZoom: String(orthographic.zoom),
        cameraTargetX: String(target.current.x),
        cameraTargetZ: String(target.current.z),
        cameraViewportWidth: String(size.width),
        cameraViewportHeight: String(size.height),
      });
      publishTargets();
      const next = d3dLodBand(
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
      publishTargets,
    ],
  );
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
    orthographic,
    publish,
  ]);

  const pan = (dx: number, dy: number) => {
    const limit = {
      minX: Math.min(fullFit.panBounds.minX, sceneBounds.minX * 1.4),
      maxX: Math.max(fullFit.panBounds.maxX, sceneBounds.maxX * 1.4),
      minZ: Math.min(fullFit.panBounds.minZ, sceneBounds.minZ * 1.4),
      maxZ: Math.max(fullFit.panBounds.maxZ, sceneBounds.maxZ * 1.4),
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
    if (mode === 'mini') return;
    const canvas = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    const down = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    const move = (event: PointerEvent) => {
      const previousPointer = pointers.get(event.pointerId);
      if (!previousPointer) return;
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
        if (before > 0) zoom(after / before);
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    const up = (event: PointerEvent) => pointers.delete(event.pointerId);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(Math.exp(-event.deltaY * 0.001));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [gl, mode, fullFit, sceneBounds, size.height, orthographic, publish]);
  return null;
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
      <meshLambertMaterial color="#a7b88d" />
    </mesh>
  );
}

function CityBatch({
  buildings,
  kind,
  layer,
  simple,
}: {
  buildings: readonly CityBuilding[];
  kind: BuildingArchetype;
  layer: 'body' | 'roof';
  simple: boolean;
}) {
  const instances = useRef<import('three').InstancedMesh>(null);
  const geometry = useMemo(
    () =>
      simple
        ? new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
        : createCityPrototypeGeometry(kind, layer),
    [kind, layer, simple],
  );
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
        simple && !b.buildingProfileId ? b.height * 0.35 : b.height,
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
  }, [buildings, layer, simple]);
  return (
    <instancedMesh
      name={'city-' + kind + '-' + layer}
      ref={instances}
      args={[geometry, undefined, buildings.length]}
      raycast={() => null}
    >
      <meshLambertMaterial color="#ffffff" />
    </instancedMesh>
  );
}

function City({
  city,
  lod,
  mode,
}: {
  city: ProceduralCity;
  lod: D3dLodBand;
  mode: RepresentationMode;
}) {
  const buildings = cityLodBuildings(city, lod, mode);
  const simple = mode === 'mini' || lod === 'far';
  const groups = useMemo(
    () =>
      simple
        ? buildings.length
          ? [{ kind: 'detached-house' as const, buildings }]
          : []
        : buildingArchetypes
            .map((kind) => ({
              kind,
              buildings: buildings.filter((b) => b.archetype === kind),
            }))
            .filter((group) => group.buildings.length > 0),
    [buildings, simple],
  );
  const surfaces = useMemo(
    () => ({
      street: createCitySurfaceGeometry(city, 'street'),
      ground: createCitySurfaceGeometry(city, 'ground'),
      landscape: createCitySurfaceGeometry(city, 'landscape'),
      reservation: createCitySurfaceGeometry(city, 'reservation'),
    }),
    [city],
  );
  useEffect(
    () => () => {
      surfaces.street.dispose();
      surfaces.ground.dispose();
      surfaces.landscape.dispose();
      surfaces.reservation.dispose();
    },
    [surfaces],
  );
  return (
    <group name="procedural-city">
      <mesh
        name="research-landscape"
        geometry={surfaces.landscape}
        raycast={() => null}
      >
        <meshLambertMaterial vertexColors side={DoubleSide} />
      </mesh>
      <mesh
        name="landmark-reservations"
        geometry={surfaces.reservation}
        raycast={() => null}
      >
        <meshLambertMaterial vertexColors side={DoubleSide} />
      </mesh>
      <mesh
        name="settlement-ground"
        geometry={surfaces.ground}
        raycast={() => null}
      >
        <meshLambertMaterial vertexColors side={DoubleSide} />
      </mesh>
      {mode === 'normal' ? (
        <mesh
          name="provisional-streets"
          geometry={surfaces.street}
          raycast={() => null}
        >
          <meshBasicMaterial vertexColors side={DoubleSide} />
        </mesh>
      ) : null}
      {groups.map((group) => (
        <group key={group.kind}>
          <CityBatch
            buildings={group.buildings}
            kind={group.kind}
            layer="body"
            simple={simple}
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
    'from' | 'to' | 'length'
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
  for (const edge of edges) {
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
        [midX - dx * length - sideX, y, midZ - dz * length - sideZ],
        [midX - dx * length + sideX, y, midZ - dz * length + sideZ],
      );
    } else {
      const a = [edge.from.x - sideX, y, edge.from.z - sideZ];
      const b = [edge.from.x + sideX, y, edge.from.z + sideZ];
      const c = [edge.to.x - sideX, y, edge.to.z - sideZ];
      const d = [edge.to.x + sideX, y, edge.to.z + sideZ];
      addTriangle(a, b, c);
      addTriangle(b, d, c);
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
  model,
  selection,
  lod,
  metre,
}: {
  model: D3dMapModel;
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
    return [...edgesByRoute].map(([routeId, edges]) => ({
      routeId,
      color: edges[0]!.color,
      ribbon: createD3dRibbonGeometry(
        edges,
        ribbonWidth,
        false,
        metre ? 0.052 : 0.1,
      ),
      selected: createD3dRibbonGeometry(
        edges,
        metre ? Math.max(6 * metre, ribbonWidth * 1.6) : 0.42,
        false,
        metre ? 0.052 : 0.1,
      ),
      arrows: createD3dRibbonGeometry(
        edges,
        metre ? 5 * metre : 0.36,
        true,
        metre ? 0.052 : 0.1,
      ),
    }));
  }, [model, metre, ribbonWidth]);
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
      {groups.map((route) => {
        const chosen =
          selection?.kind === 'route' && selection.routeId === route.routeId;
        return (
          <group key={route.routeId}>
            <mesh
              geometry={chosen ? route.selected : route.ribbon}
              dispose={null}
              raycast={() => null}
            >
              <meshBasicMaterial color={route.color} side={DoubleSide} />
            </mesh>
            {chosen ? (
              <mesh
                geometry={route.ribbon}
                dispose={null}
                raycast={() => null}
                position={[0, 0.022, 0]}
              >
                <meshBasicMaterial
                  color="#fff0bd"
                  side={DoubleSide}
                  transparent
                  opacity={0.7}
                />
              </mesh>
            ) : null}
            {lod !== 'far' ? (
              <mesh geometry={route.arrows} dispose={null} raycast={() => null}>
                <meshBasicMaterial color="#183842" side={DoubleSide} />
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
  selection,
  onSelectionChange,
  lod,
  mode,
  metre,
}: Readonly<{
  model: D3dMapModel;
  selection: GameSelection;
  onSelectionChange: MapProps['onSelectionChange'];
  lod: D3dLodBand;
  mode: RepresentationMode;
  metre: number | undefined;
}>) {
  const platforms = useRef<import('three').InstancedMesh>(null);
  const posts = useRef<import('three').InstancedMesh>(null);
  const targets = useRef<import('three').InstancedMesh>(null);
  useEffect(() => {
    const dummy = new Object3D();
    for (let i = 0; i < model.stops.length; i++) {
      const stop = model.stops[i]!;
      dummy.position.set(stop.x, metre ? 0.045 + 0.2 * metre : 0.14, stop.z);
      dummy.updateMatrix();
      platforms.current?.setMatrixAt(i, dummy.matrix);
      dummy.position.set(stop.x, metre ? 0.045 + 1.3 * metre : 0.3, stop.z);
      dummy.updateMatrix();
      posts.current?.setMatrixAt(i, dummy.matrix);
      dummy.position.set(stop.x, 0.3, stop.z);
      targets.current!.setMatrixAt(i, dummy.matrix);
    }
    platforms.current!.instanceMatrix.needsUpdate = true;
    platforms.current!.computeBoundingSphere();
    if (posts.current) {
      posts.current.instanceMatrix.needsUpdate = true;
      posts.current.computeBoundingSphere();
    }
    targets.current!.instanceMatrix.needsUpdate = true;
    targets.current!.computeBoundingSphere();
  }, [model, lod, metre]);
  const selected =
    selection?.kind === 'stop'
      ? model.stops.find((stop) => stop.stopPlaceId === selection.stopPlaceId)
      : undefined;
  const choose = (event: ThreeEvent<MouseEvent>) => {
    if (mode === 'mini' || event.instanceId === undefined || event.delta > 5)
      return;
    event.stopPropagation();
    const stop = model.stops[event.instanceId];
    if (stop) onSelectionChange(selectStop(stop.stopPlaceId));
  };
  return (
    <group>
      <instancedMesh
        ref={platforms}
        args={[undefined, undefined, model.stops.length]}
        onClick={choose}
      >
        <boxGeometry
          args={
            metre
              ? [7 * metre, 0.4 * metre, 3 * metre]
              : [lod === 'far' ? 0.5 : 0.65, 0.12, lod === 'far' ? 0.5 : 0.65]
          }
        />
        <meshLambertMaterial color="#5a777c" />
      </instancedMesh>
      {lod !== 'far' ? (
        <instancedMesh
          ref={posts}
          args={[undefined, undefined, model.stops.length]}
          onClick={choose}
        >
          <boxGeometry
            args={
              metre
                ? [0.45 * metre, 2.6 * metre, 0.45 * metre]
                : [0.12, 0.38, 0.12]
            }
          />
          <meshLambertMaterial color="#f4f0e2" />
        </instancedMesh>
      ) : null}
      {selected ? (
        <mesh
          position={[selected.x, metre ? 0.065 : 0.17, selected.z]}
          raycast={() => null}
        >
          <cylinderGeometry
            args={[metre ? 8 * metre : 0.65, metre ? 8 * metre : 0.65, 0.04, 8]}
          />
          <meshBasicMaterial color="#f2bc56" />
        </mesh>
      ) : null}
      <instancedMesh
        name="stop-hit-targets"
        ref={targets}
        args={[undefined, undefined, model.stops.length]}
        onClick={choose}
      >
        <boxGeometry args={[1.25, 0.8, 1.25]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

function Vehicles({
  vehicles,
  selection,
  onSelectionChange,
  lod,
  mode,
  metre,
}: Readonly<{
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
              metre ? 0.052 + 1.65 * metre : 0.32,
              vehicle.z,
            ]}
            rotation={[0, vehicle.headingRadians, 0]}
          >
            {chosen ? (
              <mesh
                position={[0, metre ? 0.016 - 1.65 * metre : -0.15, 0]}
                raycast={() => null}
              >
                <cylinderGeometry
                  args={[
                    metre ? 10 * metre : 0.8,
                    metre ? 10 * metre : 0.8,
                    0.04,
                    8,
                  ]}
                />
                <meshBasicMaterial color="#f2bc56" />
              </mesh>
            ) : null}
            <mesh geometry={body} dispose={null} onClick={choose}>
              <meshLambertMaterial color={vehicle.color} />
            </mesh>
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
  model,
  sceneBounds,
  city,
  vehicles,
  selection,
  onSelectionChange,
  lod,
  mode,
}: Readonly<{
  model: D3dMapModel;
  sceneBounds: ReturnType<typeof d3dSceneBounds>;
  city: ProceduralCity | undefined;
  vehicles: readonly D3dVehicle[];
  selection: GameSelection;
  onSelectionChange: MapProps['onSelectionChange'];
  lod: D3dLodBand;
  mode: RepresentationMode;
}>) {
  const metre = city?.settlement
    ? d3dMetreScale(model).worldUnitsPerMetre
    : undefined;
  return (
    <>
      <color attach="background" args={['#e3e9dc']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[-40, 80, 30]} intensity={1.6} />
      <Terrain sceneBounds={sceneBounds} />
      {city ? <City city={city} lod={lod} mode={mode} /> : null}
      <Routes model={model} selection={selection} lod={lod} metre={metre} />
      <Stops
        model={model}
        selection={selection}
        onSelectionChange={onSelectionChange}
        lod={lod}
        mode={mode}
        metre={metre}
      />
      <Vehicles
        vehicles={vehicles}
        selection={selection}
        onSelectionChange={onSelectionChange}
        lod={lod}
        mode={mode}
        metre={metre}
      />
    </>
  );
}

export default function D3dMapRepresentation({
  scenario,
  fleet,
  selection,
  onSelectionChange,
  focusedRouteId,
  population,
}: MapProps) {
  const mode = useRepresentationMode();
  const wrapper = useRef<HTMLElement>(null);
  const projection = useMemo(
    () => createTransportMapProjection(scenario),
    [scenario],
  );
  const model = useMemo(() => createD3dMapModel(projection), [projection]);
  const metadata = useSettlementMetadata(scenario.manifest.primarySettlementId);
  const city = useMemo(
    () =>
      population && metadata.status !== 'loading'
        ? buildProceduralCity(
            model,
            population,
            metadata.status === 'ready' ? metadata : undefined,
          )
        : undefined,
    [model, population, metadata],
  );
  const sceneBounds = useMemo(
    () =>
      d3dSceneBounds(
        model,
        population ? populationSpace(model, population).bounds : undefined,
      ),
    [model, population],
  );
  const acceptedFleet = useLatestRepresentationValue(fleet);
  const vehicles = useMemo(
    () =>
      projectD3dVehicles(
        model,
        projectTransportMapVehicles(projection, acceptedFleet),
      ),
    [model, projection, acceptedFleet],
  );
  const candidates = useMemo(
    () => d3dKeyboardCandidates(model, vehicles),
    [model, vehicles],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [lod, setLod] = useState<D3dLodBand>('far');
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
      aria-label="Three-dimensional transport Map"
      data-testid="d3d-map-representation"
      data-scenario-id={scenario.manifest.scenarioId}
      data-representation-mode={mode}
      data-target-frames-per-second={cadence.targetFramesPerSecond}
      data-route-count={
        new Set(model.routes.map((route) => route.routeId)).size
      }
      data-directed-edge-count={model.routes.length}
      data-stop-place-count={model.stops.length}
      data-vehicle-count={vehicles.length}
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
      data-focused-route-id={focusedRouteId ?? ''}
      data-lod="far"
    >
      <Canvas
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
        <RepresentationFrameDriver mode={mode} />
        <CameraController
          model={model}
          sceneBounds={sceneBounds}
          vehicles={vehicles}
          focusedRouteId={focusedRouteId}
          mode={mode}
          wrapper={wrapper}
          onLod={setLod}
        />
        <D3dWorld
          model={model}
          sceneBounds={sceneBounds}
          city={city}
          vehicles={vehicles}
          selection={selection}
          onSelectionChange={onSelectionChange}
          lod={lod}
          mode={mode}
        />
      </Canvas>
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
