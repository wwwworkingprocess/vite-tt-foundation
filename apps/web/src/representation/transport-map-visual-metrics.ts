import type { RepresentationMode } from './representation-cadence.js';
import {
  fullTransportMapViewport,
  type TransportMapViewport,
} from './transport-map-projection.js';

export type TransportMapEntityVisualMetrics = Readonly<{
  stopRadius: number;
  vehicleRadius: number;
  passengerStatusRadius: number;
  passengerArrivalPulseRadius: number;
  selectionRadius: number;
  selectionStrokeWidth: number;
  entityStrokeWidth: number;
  passengerLabelFontSize: number;
  passengerLabelStrokeWidth: number;
  passengerLabelOffset: number;
  stopHitRadius: number;
  vehicleHitRadius: number;
}>;

const normalMetrics: TransportMapEntityVisualMetrics = Object.freeze({
  stopRadius: 3,
  vehicleRadius: 6,
  passengerStatusRadius: 4,
  passengerArrivalPulseRadius: 8,
  selectionRadius: 7,
  selectionStrokeWidth: 3,
  entityStrokeWidth: 1,
  passengerLabelFontSize: 11,
  passengerLabelStrokeWidth: 0.5,
  passengerLabelOffset: 5,
  stopHitRadius: 10,
  vehicleHitRadius: 12,
});

const miniScale = 0.8;
const miniMetrics: TransportMapEntityVisualMetrics = Object.freeze({
  stopRadius: normalMetrics.stopRadius * miniScale,
  vehicleRadius: normalMetrics.vehicleRadius * miniScale,
  passengerStatusRadius: normalMetrics.passengerStatusRadius * miniScale,
  passengerArrivalPulseRadius:
    normalMetrics.passengerArrivalPulseRadius * miniScale,
  selectionRadius: normalMetrics.selectionRadius * miniScale,
  selectionStrokeWidth: normalMetrics.selectionStrokeWidth * miniScale,
  entityStrokeWidth: normalMetrics.entityStrokeWidth * miniScale,
  passengerLabelFontSize: normalMetrics.passengerLabelFontSize * miniScale,
  passengerLabelStrokeWidth:
    normalMetrics.passengerLabelStrokeWidth * miniScale,
  passengerLabelOffset: normalMetrics.passengerLabelOffset * miniScale,
  stopHitRadius: 10,
  vehicleHitRadius: 12,
});

export const transportMapEntityHitMetrics = Object.freeze({
  stopRadius: normalMetrics.stopHitRadius,
  vehicleRadius: normalMetrics.vehicleHitRadius,
});

export const transportMapEntityVisualMetrics = (mode: RepresentationMode) =>
  mode === 'mini' ? miniMetrics : normalMetrics;

export function materializeSvgTransportMapEntityScale(
  mode: RepresentationMode,
  viewport: TransportMapViewport,
  cssWidth: number,
  cssHeight: number,
) {
  const viewBoxWidth =
    viewport === fullTransportMapViewport
      ? 100
      : (viewport.maxX - viewport.minX) * 90;
  const viewBoxHeight =
    viewport === fullTransportMapViewport
      ? 100
      : (viewport.maxY - viewport.minY) * 90;
  return (
    Math.max(viewBoxWidth / cssWidth, viewBoxHeight / cssHeight) *
    (mode === 'mini' ? miniScale : 1)
  );
}
