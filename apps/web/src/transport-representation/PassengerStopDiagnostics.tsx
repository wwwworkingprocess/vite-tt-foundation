import { memo, useLayoutEffect } from 'react';
import type { PassengerDemandProjection } from '@torrevieja-tycoon/simulation';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from '../performance/representation-profiler.js';
import type { VehicleSvgProjection } from './vehicle-svg-projection.js';
import { passengerWaitingTotals } from '../representation/passenger-map-diagnostics.js';

export function stableWaitingTotals(
  previous: ReadonlyMap<string, number>,
  passengerDemand: PassengerDemandProjection | undefined,
) {
  const profile = beginRepresentationProfile('passengers.derivation');
  const totals = passengerWaitingTotals(passengerDemand);
  finishRepresentationProfile(profile);
  return previous.size === totals.size &&
    [...totals].every(([place, count]) => previous.get(place) === count)
    ? previous
    : totals;
}

export default memo(function PassengerStopDiagnostics({
  nodes,
  representatives,
  waiting,
  arrivals,
  pulseTick,
  entityScale,
}: Readonly<{
  nodes: VehicleSvgProjection['nodes'];
  representatives: ReadonlyMap<string, (typeof nodes)[number]>;
  waiting: ReadonlyMap<string, number>;
  arrivals: ReadonlyMap<string, number>;
  pulseTick: number | undefined;
  entityScale: number;
}>) {
  recordRepresentationProfile('passengerStops.render');
  useLayoutEffect(() => recordRepresentationProfile('passengerStops.commit'));
  return (
    <g aria-label="Passenger stop diagnostics" pointerEvents="none">
      {nodes.map((node) => {
        const count = node.stopPlaceId
          ? (waiting.get(node.stopPlaceId) ?? 0)
          : 0;
        return node.stopPlaceId ? (
          <circle
            key={`passenger-stop-${node.stopNodeId}`}
            data-testid="passenger-stop-status"
            data-stop-place-id={node.stopPlaceId}
            data-stop-node-id={node.stopNodeId}
            data-has-waiting-passengers={count > 0}
            cx={node.cx}
            cy={node.cy}
            r={4 * entityScale}
            fill={count > 0 ? 'black' : 'silver'}
          />
        ) : null;
      })}
      {[...representatives].map(([stopPlaceId, node]) => {
        const count = waiting.get(stopPlaceId) ?? 0;
        const arrivalTick = arrivals.get(stopPlaceId);
        const pulsing =
          pulseTick !== undefined &&
          arrivalTick !== undefined &&
          pulseTick - arrivalTick < 5;
        return (
          <g key={stopPlaceId} data-stop-place-id={stopPlaceId}>
            {pulsing ? (
              <circle
                data-testid="passenger-arrival-pulse"
                data-last-arrival-tick={arrivalTick}
                cx={node.cx}
                cy={node.cy}
                r={8 * entityScale}
                fill="none"
                stroke="gold"
              />
            ) : null}
            {count > 0 ? (
              <text
                data-testid="stop-waiting-passenger-count"
                data-waiting-passenger-count={count}
                x={node.cx + 5 * entityScale}
                y={node.cy - 5 * entityScale}
                fontSize={11 * entityScale}
                strokeWidth={0.5 * entityScale}
              >
                {count}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
});
