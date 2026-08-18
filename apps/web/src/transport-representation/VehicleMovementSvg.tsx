import type {
  PassengerDemandProjection,
  PassengerOriginStopArrivalEvent,
  VehiclePassengerLoadProjection,
  VehicleState,
} from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from '../performance/representation-profiler.js';
import { selectVehicle, type GameSelection } from '../ui/game-selection.js';
import { useLatestRepresentationValue } from '../representation/RepresentationModeContext.js';
import { projectVehicleMovementSvg } from './vehicle-svg-projection.js';
import StaticScenarioSvgLayer from './StaticScenarioSvgLayer.js';

const noPassengerLoads = Object.freeze(
  [],
) as readonly VehiclePassengerLoadProjection[];
const noArrivalEvents = Object.freeze(
  [],
) as readonly PassengerOriginStopArrivalEvent[];

export function VehicleMovementSvg(
  props: Readonly<{
    scenario: CanonicalScenario;
    fleet: readonly VehicleState[];
    selection?: GameSelection;
    onSelectionChange?: (selection: GameSelection) => void;
    passengerDemand?: PassengerDemandProjection | undefined;
    vehiclePassengerLoads?:
      readonly VehiclePassengerLoadProjection[] | undefined;
    passengerOriginStopArrivalEvents?:
      readonly PassengerOriginStopArrivalEvent[] | undefined;
    simulationTick?: number | undefined;
    showPassengerArrivalPulse?: boolean | undefined;
  }>,
) {
  const renderProfile = beginRepresentationProfile('svg.render-to-commit');
  const {
    scenario,
    fleet,
    selection = null,
    onSelectionChange,
    passengerDemand,
    vehiclePassengerLoads = noPassengerLoads,
    passengerOriginStopArrivalEvents = noArrivalEvents,
    simulationTick = 0,
    showPassengerArrivalPulse = false,
  } = useLatestRepresentationValue(props);
  const [passengersVisible, setPassengersVisible] = useState(true);
  const [lastArrivalTicks, setLastArrivalTicks] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const projection = projectVehicleMovementSvg(scenario, fleet);
  useEffect(() => {
    setLastArrivalTicks((previous) => {
      const next = new Map(
        [...previous].filter(([, tick]) => simulationTick - tick < 5),
      );
      for (const event of passengerOriginStopArrivalEvents) {
        if (simulationTick - event.tick >= 5) continue;
        const prior = next.get(event.stopPlaceId);
        if (prior === undefined || prior < event.tick)
          next.set(event.stopPlaceId, event.tick);
      }
      return next;
    });
  }, [passengerOriginStopArrivalEvents, simulationTick]);
  const waitingByStopPlace = useMemo(() => {
    const profile = beginRepresentationProfile('passengers.derivation');
    const totals = new Map<string, number>();
    if (passengerDemand?.status === 'active') {
      for (const cohort of passengerDemand.waitingCohorts) {
        const total =
          (totals.get(cohort.originStopPlaceId) ?? 0) + cohort.count;
        if (!Number.isSafeInteger(total))
          throw new Error('Passenger map waiting total exceeds safe range.');
        totals.set(cohort.originStopPlaceId, total);
      }
    }
    finishRepresentationProfile(profile);
    return totals;
  }, [passengerDemand]);
  const representativeNodes = useMemo(() => {
    const nodes = new Map<string, (typeof projection.nodes)[number]>();
    for (const node of projection.nodes)
      if (
        node.stopPlaceId &&
        (!nodes.has(node.stopPlaceId) ||
          node.stopNodeId.localeCompare(
            nodes.get(node.stopPlaceId)!.stopNodeId,
          ) < 0)
      )
        nodes.set(node.stopPlaceId, node);
    return nodes;
  }, [projection.nodes]);
  const loads = useMemo(
    () => new Map(vehiclePassengerLoads.map((load) => [load.vehicleId, load])),
    [vehiclePassengerLoads],
  );
  useLayoutEffect(() => {
    finishRepresentationProfile(renderProfile);
    recordRepresentationProfile('svg.commit');
    if (passengersVisible) recordRepresentationProfile('passengers.commit');
  });
  const activate = (callback: () => void) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      callback();
    }
  };
  return (
    <section className="passenger-map-diagnostics">
      <button
        type="button"
        onClick={() => setPassengersVisible((current) => !current)}
      >
        {passengersVisible ? 'Hide passengers' : 'Show passengers'}
      </button>
      <svg
        data-testid="vehicle-movement-svg"
        data-scenario-id={scenario.manifest.scenarioId}
        data-content-hash={scenario.manifest.contentHash}
        data-node-count={projection.nodes.length}
        data-directed-edge-count={projection.edges.length}
        viewBox={projection.viewBox}
        role="group"
        aria-label="Authoritative vehicle movement"
      >
        <StaticScenarioSvgLayer
          edges={projection.edges}
          nodes={projection.nodes}
          selection={
            selection?.kind === 'route' || selection?.kind === 'stop'
              ? selection
              : null
          }
          onSelectionChange={onSelectionChange}
        />
        {passengersVisible ? (
          <g aria-label="Passenger stop diagnostics" pointerEvents="none">
            {projection.nodes.map((node) => {
              const waiting = node.stopPlaceId
                ? (waitingByStopPlace.get(node.stopPlaceId) ?? 0)
                : 0;
              return node.stopPlaceId ? (
                <circle
                  key={`passenger-stop-${node.stopNodeId}`}
                  data-testid="passenger-stop-status"
                  data-stop-place-id={node.stopPlaceId}
                  data-stop-node-id={node.stopNodeId}
                  data-has-waiting-passengers={waiting > 0}
                  cx={node.cx}
                  cy={node.cy}
                  r="1.15"
                  fill={waiting > 0 ? 'black' : 'silver'}
                />
              ) : null;
            })}
            {[...representativeNodes].map(([stopPlaceId, node]) => {
              const waiting = waitingByStopPlace.get(stopPlaceId) ?? 0;
              const arrivalTick = lastArrivalTicks.get(stopPlaceId);
              const pulsing =
                arrivalTick !== undefined && simulationTick - arrivalTick < 5;
              return (
                <g key={stopPlaceId} data-stop-place-id={stopPlaceId}>
                  {showPassengerArrivalPulse && pulsing ? (
                    <circle
                      data-testid="passenger-arrival-pulse"
                      data-last-arrival-tick={arrivalTick}
                      cx={node.cx}
                      cy={node.cy}
                      r="3.2"
                      fill="none"
                      stroke="gold"
                    />
                  ) : null}
                  {waiting > 0 ? (
                    <text
                      data-testid="stop-waiting-passenger-count"
                      data-waiting-passenger-count={waiting}
                      x={node.cx + 2}
                      y={node.cy - 2}
                    >
                      {waiting}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        ) : null}
        <g aria-label="Authoritative vehicles">
          {projection.vehicles.map((vehicle) => (
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
                r="2.7"
                fill={vehicle.color}
                stroke={
                  selection?.kind === 'vehicle' &&
                  selection.vehicleId === vehicle.vehicleId
                    ? '#ffd400'
                    : '#102e3c'
                }
                strokeWidth={
                  selection?.kind === 'vehicle' &&
                  selection.vehicleId === vehicle.vehicleId
                    ? '0.8'
                    : '0.3'
                }
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
}
