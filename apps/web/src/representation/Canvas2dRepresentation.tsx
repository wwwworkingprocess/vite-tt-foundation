import type {
  PassengerDemandProjection,
  PassengerOriginStopArrivalEvent,
  VehiclePassengerLoadProjection,
  VehicleState,
} from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from '../performance/representation-profiler.js';
import {
  selectStop,
  selectVehicle,
  type GameSelection,
} from '../ui/game-selection.js';
import {
  canvas2dPointerPosition,
  createCanvas2dSelectionIndex,
  createCanvas2dSelectionSnapshot,
  hitTestCanvas2dSelection,
  projectCanvas2dPosition,
  type Canvas2dSelectablePoint,
  type Canvas2dSelectionSnapshot,
} from './canvas2d-selection-model.js';
import { useRepresentationMode } from './RepresentationModeContext.js';
import {
  createRepresentationFrameDriver,
  representationCadence,
} from './representation-cadence.js';
import { projectTransportMapPoint } from './transport-map-projection.js';
import type { ScenarioPopulationView } from '../population/population-field-loader.js';
import {
  passengerWaitingTotals,
  updatePassengerArrivalTicks,
} from './passenger-map-diagnostics.js';

const validDpr = () =>
  Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;

const matchesSelection = (
  point: Canvas2dSelectablePoint,
  selection: GameSelection,
) =>
  selection?.kind === point.kind &&
  (point.kind === 'stop'
    ? selection.kind === 'stop' && selection.stopPlaceId === point.stopPlaceId
    : selection.kind === 'vehicle' && selection.vehicleId === point.vehicleId);

const candidateLabel = (point: Canvas2dSelectablePoint | undefined) =>
  point
    ? `${point.kind === 'stop' ? 'StopPlace' : 'Vehicle'}: ${point.label}`
    : '';

type Canvas2dPopulationCell = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}>;

export function materializeCanvas2dPopulationCells(
  populationCells: readonly Canvas2dPopulationCell[],
  width: number,
  height: number,
  previous?: Readonly<{
    populationCells: readonly Canvas2dPopulationCell[];
    width: number;
    height: number;
    rectangles: readonly Canvas2dPopulationCell[];
  }>,
) {
  if (
    previous?.populationCells === populationCells &&
    previous.width === width &&
    previous.height === height
  )
    return previous;
  return Object.freeze({
    populationCells,
    width,
    height,
    rectangles: Object.freeze(
      populationCells.map((cell) => {
        const northWest = projectCanvas2dPosition(cell, width, height);
        const southEast = projectCanvas2dPosition(
          { x: cell.x + cell.width, y: cell.y + cell.height },
          width,
          height,
        );
        return Object.freeze({
          x: Math.min(northWest.x, southEast.x),
          y: Math.min(northWest.y, southEast.y),
          width: Math.abs(southEast.x - northWest.x),
          height: Math.abs(southEast.y - northWest.y),
          opacity: cell.opacity,
        });
      }),
    ),
  });
}

export function Canvas2dRepresentation({
  scenario,
  fleet,
  selection,
  onSelectionChange,
  population,
  populationVisible = true,
  passengerDemand,
  vehiclePassengerLoads = [],
  passengerOriginStopArrivalEvents = [],
  simulationTick = 0,
  showPassengerArrivalPulse = false,
  passengersVisible = true,
}: Readonly<{
  scenario: CanonicalScenario;
  fleet: readonly VehicleState[];
  selection: GameSelection;
  onSelectionChange: (selection: GameSelection) => void;
  population?: ScenarioPopulationView | undefined;
  populationVisible?: boolean | undefined;
  passengerDemand?: PassengerDemandProjection | undefined;
  vehiclePassengerLoads?: readonly VehiclePassengerLoadProjection[] | undefined;
  passengerOriginStopArrivalEvents?:
    readonly PassengerOriginStopArrivalEvent[] | undefined;
  simulationTick?: number | undefined;
  showPassengerArrivalPulse?: boolean | undefined;
  passengersVisible?: boolean | undefined;
}>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ width: 0, height: 0 });
  const mode = useRepresentationMode();
  const interactive = mode === 'normal';
  const modeRef = useRef(mode);
  const index = useMemo(
    () => createCanvas2dSelectionIndex(scenario),
    [scenario],
  );
  const populationCells = useMemo(() => {
    if (!population) return [];
    const maximum = Math.max(
      ...population.canonicalCells.map((cell) => cell.populationWeight),
      1,
    );
    const half = population.grid.resolutionDegrees / 2;
    return population.canonicalCells
      .filter((cell) => cell.populationWeight > 0)
      .map((cell) => {
        const northWest = projectTransportMapPoint(index.map.bounds, {
          latitude: cell.center.latitude + half,
          longitude: cell.center.longitude - half,
        });
        const southEast = projectTransportMapPoint(index.map.bounds, {
          latitude: cell.center.latitude - half,
          longitude: cell.center.longitude + half,
        });
        return Object.freeze({
          x: Math.min(northWest.x, southEast.x),
          y: Math.min(northWest.y, southEast.y),
          width: Math.abs(southEast.x - northWest.x),
          height: Math.abs(southEast.y - northWest.y),
          opacity:
            0.15 +
            ((Math.min(7, Math.floor((cell.populationWeight / maximum) * 8)) +
              1) /
              8) *
              0.65,
        });
      });
  }, [index.map.bounds, population]);
  const waiting = useMemo(
    () => passengerWaitingTotals(passengerDemand),
    [passengerDemand],
  );
  const arrivals = useRef<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    if (!showPassengerArrivalPulse) return;
    arrivals.current = updatePassengerArrivalTicks(
      arrivals.current,
      passengerOriginStopArrivalEvents,
      simulationTick,
    );
  }, [
    passengerOriginStopArrivalEvents,
    showPassengerArrivalPulse,
    simulationTick,
  ]);
  const vehicleLoads = useMemo(
    () => new Map(vehiclePassengerLoads.map((load) => [load.vehicleId, load])),
    [vehiclePassengerLoads],
  );
  const input = useRef({
    index,
    fleet,
    selection,
    populationCells,
    populationVisible,
    passengersVisible,
    waiting,
    vehicleLoads,
    arrivals,
    simulationTick,
    showPassengerArrivalPulse,
  });
  const lastDrawn = useRef<Canvas2dSelectionSnapshot | undefined>(undefined);
  const populationMaterialization = useRef<
    ReturnType<typeof materializeCanvas2dPopulationCells> | undefined
  >(undefined);
  const [candidateIndex, setCandidateIndex] = useState<number>();
  input.current = {
    index,
    fleet,
    selection,
    populationCells,
    populationVisible,
    passengersVisible,
    waiting,
    vehicleLoads,
    arrivals,
    simulationTick,
    showPassengerArrivalPulse,
  };
  const driverRef = useRef<
    ReturnType<typeof createRepresentationFrameDriver> | undefined
  >(undefined);
  modeRef.current = mode;
  useEffect(() => driverRef.current?.setMode(mode), [mode]);
  useEffect(() => {
    lastDrawn.current = undefined;
    setCandidateIndex(undefined);
  }, [scenario]);

  useEffect(() => {
    const element = canvas.current!;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        size.current = {
          width: Math.max(0, entry.contentRect.width),
          height: Math.max(0, entry.contentRect.height),
        };
    });
    observer.observe(element);
    const driver = createRepresentationFrameDriver({
      mode: modeRef.current,
      now: () => performance.now(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
      frame: () => {
        const context = element.getContext('2d');
        const { width, height } = size.current;
        if (!context || width <= 0 || height <= 0) return;
        const dpr = validDpr();
        const backingWidth = Math.round(width * dpr);
        const backingHeight = Math.round(height * dpr);
        if (element.width !== backingWidth) element.width = backingWidth;
        if (element.height !== backingHeight) element.height = backingHeight;
        const detail = {
          mode: modeRef.current,
          targetFramesPerSecond: representationCadence(modeRef.current)
            .targetFramesPerSecond,
          cssWidth: width,
          cssHeight: height,
          backingWidth,
          backingHeight,
          devicePixelRatio: dpr,
        } as const;
        const token = beginRepresentationProfile('canvas2d.draw');
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#0b2533';
        context.fillRect(0, 0, width, height);
        const currentInput = input.current;
        if (currentInput.populationVisible) {
          const materialization = materializeCanvas2dPopulationCells(
            currentInput.populationCells,
            width,
            height,
            populationMaterialization.current,
          );
          populationMaterialization.current = materialization;
          context.fillStyle = '#e88424';
          for (const cell of materialization.rectangles) {
            context.globalAlpha = cell.opacity;
            context.fillRect(cell.x, cell.y, cell.width, cell.height);
          }
          context.globalAlpha = 1;
        }
        const snapshot = createCanvas2dSelectionSnapshot(
          currentInput.index,
          currentInput.fleet,
          width,
          height,
          lastDrawn.current,
        );
        context.lineWidth = 1.5;
        let routeArrowheads = 0;
        for (const edge of snapshot.routeEdges) {
          context.strokeStyle = edge.color;
          context.beginPath();
          context.moveTo(edge.from.x, edge.from.y);
          context.lineTo(edge.to.x, edge.to.y);
          context.stroke();
          if (edge.arrowhead) {
            routeArrowheads += 1;
            context.fillStyle = edge.color;
            context.beginPath();
            context.moveTo(edge.arrowhead[0]!.x, edge.arrowhead[0]!.y);
            context.lineTo(edge.arrowhead[1]!.x, edge.arrowhead[1]!.y);
            context.lineTo(edge.arrowhead[2]!.x, edge.arrowhead[2]!.y);
            context.closePath();
            context.fill();
          }
        }
        if (currentInput.passengersVisible) {
          for (const point of snapshot.stopPoints) {
            const count = currentInput.waiting.get(point.stopPlaceId) ?? 0;
            context.fillStyle = count > 0 ? 'black' : 'silver';
            context.beginPath();
            context.arc(point.x, point.y, 4, 0, Math.PI * 2);
            context.fill();
          }
          for (const point of snapshot.keyboardCandidates)
            if (point.kind === 'stop') {
              const arrivalTick = currentInput.arrivals.current.get(
                point.stopPlaceId,
              );
              if (
                currentInput.showPassengerArrivalPulse &&
                arrivalTick !== undefined &&
                currentInput.simulationTick - arrivalTick < 5
              ) {
                context.strokeStyle = 'gold';
                context.beginPath();
                context.arc(point.x, point.y, 8, 0, Math.PI * 2);
                context.stroke();
              }
            }
        }
        context.fillStyle = '#c0c7ca';
        for (const point of snapshot.stopPoints) {
          context.beginPath();
          context.arc(point.x, point.y, 3, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = '#ef6a4c';
        for (const point of snapshot.vehiclePoints)
          context.fillRect(point.x - 4, point.y - 4, 8, 8);
        if (currentInput.passengersVisible) {
          context.fillStyle = 'black';
          context.font = '700 11px sans-serif';
          for (const point of snapshot.keyboardCandidates) {
            if (point.kind !== 'stop') continue;
            const count = currentInput.waiting.get(point.stopPlaceId) ?? 0;
            if (count > 0)
              context.fillText(String(count), point.x + 5, point.y - 5);
          }
          context.textAlign = 'center';
          for (const point of snapshot.vehiclePoints) {
            const count =
              currentInput.vehicleLoads.get(point.vehicleId)
                ?.onboardPassengerCount ?? 0;
            if (count > 0)
              context.fillText(String(count), point.x, point.y + 4);
          }
          context.textAlign = 'start';
        }
        context.strokeStyle = '#ffd166';
        context.lineWidth = 3;
        for (const point of snapshot.stopPoints)
          if (matchesSelection(point, currentInput.selection)) {
            context.beginPath();
            context.arc(point.x, point.y, 7, 0, Math.PI * 2);
            context.stroke();
          }
        for (const point of snapshot.vehiclePoints)
          if (matchesSelection(point, currentInput.selection))
            context.strokeRect(point.x - 7, point.y - 7, 14, 14);
        lastDrawn.current = snapshot;
        const selectionDetail = {
          directedRouteEdges: snapshot.routeEdges.length,
          routeArrowheads,
          selectableStopPoints: snapshot.stopPoints.length,
          selectableVehicles: snapshot.vehiclePoints.length,
          populationCells: currentInput.populationVisible
            ? currentInput.populationCells.length
            : 0,
          passengerStopDiagnostics: currentInput.passengersVisible
            ? snapshot.stopPoints.length
            : 0,
        };
        finishRepresentationProfile(token, { ...detail, ...selectionDetail });
        recordRepresentationProfile('canvas2d.frame', {
          ...detail,
          ...selectionDetail,
        });
      },
    });
    driverRef.current = driver;
    return () => {
      driver.close();
      observer.disconnect();
      lastDrawn.current = undefined;
      driverRef.current = undefined;
    };
  }, []);

  const drawnCandidates = () =>
    lastDrawn.current?.scenario === scenario
      ? lastDrawn.current.keyboardCandidates
      : [];
  const activate = (point: Canvas2dSelectablePoint | undefined) => {
    if (!point) return;
    onSelectionChange(
      point.kind === 'stop'
        ? selectStop(point.stopPlaceId)
        : selectVehicle(point.vehicleId),
    );
  };
  const currentCandidate = drawnCandidates()[candidateIndex ?? -1];
  return (
    <>
      <canvas
        ref={canvas}
        className="canvas2d-representation"
        data-testid="canvas2d-representation"
        data-interactive={interactive}
        role={interactive ? 'group' : 'img'}
        aria-label="Canvas 2D transport Map with StopPlace and Vehicle selection"
        aria-describedby={interactive ? 'canvas2d-selection-status' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={
          interactive
            ? (event) => {
                const snapshot = lastDrawn.current;
                if (!snapshot || snapshot.scenario !== scenario) return;
                const pointer = canvas2dPointerPosition(
                  event.currentTarget.getBoundingClientRect(),
                  snapshot,
                  event.clientX,
                  event.clientY,
                );
                if (pointer)
                  activate(
                    hitTestCanvas2dSelection(snapshot, pointer.x, pointer.y),
                  );
              }
            : undefined
        }
        onFocus={
          interactive
            ? () => {
                const candidates = drawnCandidates();
                const selected = candidates.findIndex((point) =>
                  matchesSelection(point, selection),
                );
                setCandidateIndex(selected >= 0 ? selected : 0);
              }
            : undefined
        }
        onKeyDown={
          interactive
            ? (event) => {
                const candidates = drawnCandidates();
                const current = Math.min(
                  candidateIndex ?? 0,
                  candidates.length - 1,
                );
                let next: number;
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
                  next = (current + 1) % candidates.length;
                else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
                  next = (current - 1 + candidates.length) % candidates.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = candidates.length - 1;
                else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  activate(candidates[current]);
                  return;
                } else return;
                event.preventDefault();
                setCandidateIndex(next);
              }
            : undefined
        }
      >
        Canvas 2D representation is unavailable.
      </canvas>
      {interactive ? (
        <span
          id="canvas2d-selection-status"
          className="canvas2d-selection-status"
          aria-live="polite"
        >
          {candidateLabel(currentCandidate)}
        </span>
      ) : null}
    </>
  );
}
