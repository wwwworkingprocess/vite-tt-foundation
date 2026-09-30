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

type MapProps = Readonly<{
  scenario: CanonicalScenario;
  fleet: readonly VehicleState[];
  selection: GameSelection;
  onSelectionChange: (selection: GameSelection) => void;
  focusedRouteId?: RouteId | undefined;
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

function CameraController({
  model,
  vehicles,
  focusedRouteId,
  mode,
  wrapper,
  onLod,
}: Readonly<{
  model: D3dMapModel;
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
      ),
    [model, focusedRouteId, mode, size.width, size.height],
  );
  const fullFit = useMemo(
    () => fitD3dCamera(model, undefined, size.width, size.height),
    [model, size.width, size.height],
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
      const point = locate(stop.x, 0.65, stop.z);
      wrapper.current!.dataset.pointerStopId = stop.stopPlaceId;
      wrapper.current!.dataset.pointerStopX = String(point.x);
      wrapper.current!.dataset.pointerStopY = String(point.y);
    }
    if (vehicle) {
      const point = locate(vehicle.x, 0.8, vehicle.z);
      wrapper.current!.dataset.pointerVehicleId = vehicle.vehicleId;
      wrapper.current!.dataset.pointerVehicleX = String(point.x);
      wrapper.current!.dataset.pointerVehicleY = String(point.y);
    }
    if (edge) {
      const point = locate(
        (edge.from.x + edge.to.x) / 2,
        0.1,
        (edge.from.z + edge.to.z) / 2,
      );
      wrapper.current!.dataset.pointerRouteX = String(point.x);
      wrapper.current!.dataset.pointerRouteY = String(point.y);
    }
  }, [model, orthographic, size.width, size.height, wrapper]);
  const publish = useCallback(
    (kind: 'full' | 'route-fit' | 'manual') => {
      cameraKind.current = kind;
      wrapper.current!.dataset.cameraMode = kind;
      wrapper.current!.dataset.cameraZoom = String(orthographic.zoom);
      wrapper.current!.dataset.cameraTargetX = String(target.current.x);
      wrapper.current!.dataset.cameraTargetZ = String(target.current.z);
      publishTargets();
      const next = d3dLodBand(
        20 / (Math.max(1, size.height) * orthographic.zoom),
        mode,
        lod.current,
      );
      if (next !== lod.current) {
        lod.current = next;
        wrapper.current!.dataset.lod = next;
        onLod(next);
      }
    },
    [wrapper, orthographic, size.height, mode, onLod, publishTargets],
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
    const limit = fullFit.panBounds;
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
  }, [gl, mode, fullFit, size.height, orthographic, publish]);
  return null;
}

function Terrain({ model, lod }: { model: D3dMapModel; lod: D3dLodBand }) {
  const tiles = useRef<import('three').InstancedMesh>(null);
  useEffect(() => {
    const mesh = tiles.current!;
    const object = new Object3D();
    const tones = ['#d9d6c9', '#ddd9cb', '#d3d5c8', '#e1dccc'];
    for (let i = 0; i < model.tiles.length; i++) {
      const tile = model.tiles[i]!;
      object.position.set(tile.x, -0.2, tile.z);
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
      mesh.setColorAt(i, new Color(tones[tile.tone]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }, [model]);
  return (
    <group>
      <mesh position={[0, -0.5, 0]} raycast={() => null}>
        <boxGeometry
          args={[model.bounds.width * 1.04, 0.55, model.bounds.depth * 1.04]}
        />
        <meshLambertMaterial color="#b5beb1" />
      </mesh>
      <instancedMesh
        ref={tiles}
        args={[undefined, undefined, model.tiles.length]}
        raycast={() => null}
      >
        <boxGeometry
          args={[
            (model.bounds.width / 16) * (lod === 'far' ? 1 : 0.985),
            0.12,
            (model.bounds.depth / 16) * (lod === 'far' ? 1 : 0.985),
          ]}
        />
        <meshLambertMaterial color="#ffffff" />
      </instancedMesh>
    </group>
  );
}

export function createD3dRibbonGeometry(
  edges: readonly D3dMapModel['routes'][number][],
  width: number,
  arrows: boolean,
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
    const y = arrows ? 0.16 : 0.1;
    if (arrows) {
      const midX = (edge.from.x + edge.to.x) / 2;
      const midZ = (edge.from.z + edge.to.z) / 2;
      const length = Math.min(1.2, edge.length * 0.25);
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
}: {
  model: D3dMapModel;
  selection: GameSelection;
  lod: D3dLodBand;
}) {
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
      ribbon: createD3dRibbonGeometry(edges, 0.65, false),
      selected: createD3dRibbonGeometry(edges, 1.2, false),
      arrows: createD3dRibbonGeometry(edges, 0.9, true),
    }));
  }, [model]);
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
}: Readonly<{
  model: D3dMapModel;
  selection: GameSelection;
  onSelectionChange: MapProps['onSelectionChange'];
  lod: D3dLodBand;
  mode: RepresentationMode;
}>) {
  const platforms = useRef<import('three').InstancedMesh>(null);
  const posts = useRef<import('three').InstancedMesh>(null);
  useEffect(() => {
    const dummy = new Object3D();
    for (let i = 0; i < model.stops.length; i++) {
      const stop = model.stops[i]!;
      dummy.position.set(stop.x, 0.31, stop.z);
      dummy.updateMatrix();
      platforms.current?.setMatrixAt(i, dummy.matrix);
      dummy.position.set(stop.x, 0.65, stop.z);
      dummy.updateMatrix();
      posts.current?.setMatrixAt(i, dummy.matrix);
    }
    platforms.current!.instanceMatrix.needsUpdate = true;
    if (posts.current) posts.current.instanceMatrix.needsUpdate = true;
  }, [model, lod]);
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
          args={[
            lod === 'far' ? 0.95 : 1.25,
            0.24,
            lod === 'far' ? 0.95 : 1.25,
          ]}
        />
        <meshLambertMaterial color="#5a777c" />
      </instancedMesh>
      {lod !== 'far' ? (
        <instancedMesh
          ref={posts}
          args={[undefined, undefined, model.stops.length]}
          onClick={choose}
        >
          <boxGeometry args={[0.22, 0.58, 0.22]} />
          <meshLambertMaterial color="#f4f0e2" />
        </instancedMesh>
      ) : null}
      {selected ? (
        <mesh position={[selected.x, 0.17, selected.z]} raycast={() => null}>
          <cylinderGeometry args={[1.25, 1.25, 0.09, 8]} />
          <meshBasicMaterial color="#f2bc56" />
        </mesh>
      ) : null}
    </group>
  );
}

function Vehicles({
  vehicles,
  selection,
  onSelectionChange,
  lod,
  mode,
}: Readonly<{
  vehicles: readonly D3dVehicle[];
  selection: GameSelection;
  onSelectionChange: MapProps['onSelectionChange'];
  lod: D3dLodBand;
  mode: RepresentationMode;
}>) {
  const body = useMemo(() => new BoxGeometry(1.15, 0.7, 2.2), []);
  const windows = useMemo(() => new BoxGeometry(1.17, 0.3, 1.15), []);
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
            position={[vehicle.x, 0.8, vehicle.z]}
            rotation={[0, vehicle.headingRadians, 0]}
          >
            {chosen ? (
              <mesh position={[0, -0.45, 0]} raycast={() => null}>
                <cylinderGeometry args={[1.55, 1.55, 0.1, 8]} />
                <meshBasicMaterial color="#f2bc56" />
              </mesh>
            ) : null}
            <mesh geometry={body} dispose={null} onClick={choose}>
              <meshLambertMaterial color={vehicle.color} />
            </mesh>
            {lod !== 'far' ? (
              <mesh
                geometry={windows}
                dispose={null}
                position={[0, 0.39, 0]}
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
  vehicles,
  selection,
  onSelectionChange,
  lod,
  mode,
}: Readonly<{
  model: D3dMapModel;
  vehicles: readonly D3dVehicle[];
  selection: GameSelection;
  onSelectionChange: MapProps['onSelectionChange'];
  lod: D3dLodBand;
  mode: RepresentationMode;
}>) {
  return (
    <>
      <ambientLight intensity={1.7} />
      <directionalLight position={[50, 100, 30]} intensity={1.2} />
      <Terrain model={model} lod={lod} />
      <Routes model={model} selection={selection} lod={lod} />
      <Stops
        model={model}
        selection={selection}
        onSelectionChange={onSelectionChange}
        lod={lod}
        mode={mode}
      />
      <Vehicles
        vehicles={vehicles}
        selection={selection}
        onSelectionChange={onSelectionChange}
        lod={lod}
        mode={mode}
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
}: MapProps) {
  const mode = useRepresentationMode();
  const wrapper = useRef<HTMLElement>(null);
  const projection = useMemo(
    () => createTransportMapProjection(scenario),
    [scenario],
  );
  const model = useMemo(() => createD3dMapModel(projection), [projection]);
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
          vehicles={vehicles}
          focusedRouteId={focusedRouteId}
          mode={mode}
          wrapper={wrapper}
          onLod={setLod}
        />
        <D3dWorld
          model={model}
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
