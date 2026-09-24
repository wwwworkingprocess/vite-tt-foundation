import type {
  PassengerDemandProjection,
  PassengerOriginStopArrivalEvent,
  VehiclePassengerLoadProjection,
  VehicleState,
} from '@torrevieja-tycoon/simulation';
import type {
  CanonicalScenario,
  RouteId,
} from '@torrevieja-tycoon/transport-domain';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from '../performance/representation-profiler.js';
import {
  useLatestRepresentationValue,
  useRepresentationMode,
} from '../representation/RepresentationModeContext.js';
import { updatePassengerArrivalTicks } from '../representation/passenger-map-diagnostics.js';
import {
  fullTransportMapViewport,
  createTransportMapProjection,
  resolveTransportMapViewport,
  type TransportMapViewport,
} from '../representation/transport-map-projection.js';
import { selectVehicle, type GameSelection } from '../ui/game-selection.js';
import { materializeSvgTransportMapEntityScale } from '../representation/transport-map-visual-metrics.js';
import type { RepresentationMode } from '../representation/representation-cadence.js';
import StaticScenarioSvgLayer from './StaticScenarioSvgLayer.js';
import PassengerStopDiagnostics, {
  stableWaitingTotals,
} from './PassengerStopDiagnostics.js';
import { projectVehicleMovementSvg } from './vehicle-svg-projection.js';

const noPassengerLoads = Object.freeze(
  [],
) as readonly VehiclePassengerLoadProjection[];
const noArrivalEvents = Object.freeze(
  [],
) as readonly PassengerOriginStopArrivalEvent[];

interface AuthorityProps {
  readonly scenario: CanonicalScenario;
  readonly fleet: readonly VehicleState[];
  readonly passengerDemand?: PassengerDemandProjection | undefined;
  readonly vehiclePassengerLoads?:
    readonly VehiclePassengerLoadProjection[] | undefined;
  readonly passengerOriginStopArrivalEvents?:
    readonly PassengerOriginStopArrivalEvent[] | undefined;
  readonly simulationTick?: number | undefined;
  readonly showPassengerArrivalPulse?: boolean | undefined;
}
interface SvgProps extends AuthorityProps {
  readonly selection?: GameSelection | undefined;
  readonly onSelectionChange?: ((selection: GameSelection) => void) | undefined;
  readonly passengersVisible?: boolean | undefined;
  readonly focusedRouteId?: RouteId | undefined;
}
interface CommittedSvgProps extends AuthorityProps {
  readonly selection?: GameSelection | undefined;
  readonly onSelectionChange?: ((selection: GameSelection) => void) | undefined;
  readonly passengersVisible?: boolean | undefined;
  readonly viewport: TransportMapViewport;
  readonly mode: RepresentationMode;
}

export function VehicleMovementSvg(props: Readonly<SvgProps>) {
  recordRepresentationProfile('svg.wrapper.render');
  const mode = useRepresentationMode();
  const { selection = null, onSelectionChange, passengersVisible } = props;
  const viewport = useMemo(
    () =>
      resolveTransportMapViewport(
        createTransportMapProjection(props.scenario),
        props.focusedRouteId,
      ),
    [props.focusedRouteId, props.scenario],
  );
  const authority = useMemo<AuthorityProps>(
    () => ({
      scenario: props.scenario,
      fleet: props.fleet,
      passengerDemand: props.passengerDemand,
      vehiclePassengerLoads: props.vehiclePassengerLoads,
      passengerOriginStopArrivalEvents: props.passengerOriginStopArrivalEvents,
      simulationTick: props.simulationTick,
      showPassengerArrivalPulse: props.showPassengerArrivalPulse,
    }),
    [
      props.fleet,
      props.passengerDemand,
      props.passengerOriginStopArrivalEvents,
      props.scenario,
      props.showPassengerArrivalPulse,
      props.simulationTick,
      props.vehiclePassengerLoads,
    ],
  );
  const committed = useLatestRepresentationValue(authority);
  const callback = useRef(onSelectionChange);
  callback.current = onSelectionChange;
  const select = useCallback(
    (next: GameSelection) => callback.current?.(next),
    [],
  );
  return (
    <CommittedVehicleMovementSvg
      {...committed}
      selection={selection}
      onSelectionChange={select}
      passengersVisible={passengersVisible}
      viewport={viewport}
      mode={mode}
    />
  );
}

const activate = (callback: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    callback();
  }
};

const CommittedVehicleMovementSvg = memo(function CommittedVehicleMovementSvg({
  scenario,
  fleet,
  selection,
  onSelectionChange,
  passengerDemand,
  vehiclePassengerLoads = noPassengerLoads,
  passengerOriginStopArrivalEvents = noArrivalEvents,
  simulationTick = 0,
  showPassengerArrivalPulse = false,
  passengersVisible = true,
  viewport = fullTransportMapViewport,
  mode,
}: Readonly<CommittedSvgProps>) {
  recordRepresentationProfile('svg.committed.render');
  const renderProfile = beginRepresentationProfile(
    'svg.committed.render-to-commit',
  );
  const [lastArrivalTicks, setLastArrivalTicks] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const priorWaiting = useRef<ReadonlyMap<string, number>>(new Map());
  const svg = useRef<SVGSVGElement>(null);
  const [cssSize, setCssSize] = useState<readonly [number, number]>([400, 300]);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setCssSize([
          entry.contentRect.width || 1,
          entry.contentRect.height || 1,
        ]);
    });
    const element = svg.current!;
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const entityScale = materializeSvgTransportMapEntityScale(
    mode,
    viewport,
    cssSize[0],
    cssSize[1],
  );
  const staticProjection = useMemo(
    () => projectVehicleMovementSvg(scenario, [], viewport),
    [scenario, viewport],
  );
  const vehicles = projectVehicleMovementSvg(
    scenario,
    fleet,
    viewport,
  ).vehicles;
  useEffect(() => {
    if (!showPassengerArrivalPulse) return;
    setLastArrivalTicks((previous) =>
      updatePassengerArrivalTicks(
        previous,
        passengerOriginStopArrivalEvents,
        simulationTick,
      ),
    );
  }, [
    passengerOriginStopArrivalEvents,
    showPassengerArrivalPulse,
    simulationTick,
  ]);
  const waiting = useMemo(() => {
    const totals = stableWaitingTotals(priorWaiting.current, passengerDemand);
    priorWaiting.current = totals;
    return totals;
  }, [passengerDemand]);
  const representatives = useMemo(() => {
    const values = new Map<string, (typeof staticProjection.nodes)[number]>();
    for (const node of staticProjection.nodes)
      if (
        node.stopPlaceId &&
        (!values.has(node.stopPlaceId) ||
          node.stopNodeId.localeCompare(
            values.get(node.stopPlaceId)!.stopNodeId,
          ) < 0)
      )
        values.set(node.stopPlaceId, node);
    return values;
  }, [staticProjection.nodes]);
  const loads = useMemo(
    () => new Map(vehiclePassengerLoads.map((load) => [load.vehicleId, load])),
    [vehiclePassengerLoads],
  );
  useLayoutEffect(() => {
    finishRepresentationProfile(renderProfile);
    recordRepresentationProfile('svg.committed.commit');
  });
  return (
    <section className="passenger-map-diagnostics">
      <svg
        ref={svg}
        data-testid="vehicle-movement-svg"
        data-scenario-id={scenario.manifest.scenarioId}
        data-content-hash={scenario.manifest.contentHash}
        data-node-count={staticProjection.nodes.length}
        data-directed-edge-count={staticProjection.edges.length}
        viewBox={staticProjection.viewBox}
        data-map-viewport={
          viewport === fullTransportMapViewport ? 'full' : 'route'
        }
        role="group"
        aria-label="Authoritative vehicle movement"
      >
        <StaticScenarioSvgLayer
          edges={staticProjection.edges}
          nodes={staticProjection.nodes}
          selection={
            selection?.kind === 'route' || selection?.kind === 'stop'
              ? selection
              : null
          }
          onSelectionChange={onSelectionChange}
          entityScale={entityScale}
        />
        {passengersVisible ? (
          <PassengerStopDiagnostics
            nodes={staticProjection.nodes}
            representatives={representatives}
            waiting={waiting}
            arrivals={lastArrivalTicks}
            pulseTick={showPassengerArrivalPulse ? simulationTick : undefined}
            entityScale={entityScale}
          />
        ) : null}
        <g aria-label="Authoritative vehicles">
          {vehicles.map((vehicle) => (
            <g key={vehicle.vehicleId}>
              <circle
                data-testid="vehicle-position"
                data-vehicle-id={vehicle.vehicleId}
                data-movement-kind={vehicle.movementKind}
                data-route-id={vehicle.routeId}
                data-pattern-id={vehicle.patternId}
                data-route-leg-index={vehicle.routeLegIndex}
                data-completed-route-cycles={vehicle.completedRouteCycles}
                data-edge-id={vehicle.edgeId}
                data-progress-numerator={vehicle.progressNumerator}
                data-progress-denominator={vehicle.progressDenominator}
                aria-label={`${vehicle.label}: ${vehicle.movementKind}`}
                cx={vehicle.cx}
                cy={vehicle.cy}
                r={6 * entityScale}
                fill={vehicle.color}
                stroke="transparent"
                strokeWidth="16"
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={0}
                data-selected={
                  selection?.kind === 'vehicle' &&
                  selection.vehicleId === vehicle.vehicleId
                }
                onClick={() =>
                  onSelectionChange?.(selectVehicle(vehicle.vehicleId))
                }
                onKeyDown={activate(() =>
                  onSelectionChange?.(selectVehicle(vehicle.vehicleId)),
                )}
              />
              {passengersVisible ? (
                <text
                  data-testid="vehicle-onboard-passenger-count"
                  data-vehicle-id={vehicle.vehicleId}
                  data-onboard-passenger-count={
                    loads.get(vehicle.vehicleId)?.onboardPassengerCount ?? 0
                  }
                  x={vehicle.cx}
                  y={vehicle.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  pointerEvents="none"
                  fontSize={11 * entityScale}
                  strokeWidth={0.5 * entityScale}
                >
                  {loads.get(vehicle.vehicleId)?.onboardPassengerCount ?? 0}
                </text>
              ) : null}
            </g>
          ))}
        </g>
      </svg>
    </section>
  );
});
