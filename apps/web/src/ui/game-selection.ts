import type { RouteId, StopPlaceId } from '@torrevieja-tycoon/transport-domain';
import type { VehicleId } from '@torrevieja-tycoon/simulation';

export type GameSelection =
  | Readonly<{ readonly kind: 'route'; readonly routeId: RouteId }>
  | Readonly<{ readonly kind: 'stop'; readonly stopPlaceId: StopPlaceId }>
  | Readonly<{ readonly kind: 'vehicle'; readonly vehicleId: VehicleId }>
  | null;

export const selectRoute = (routeId: RouteId): GameSelection =>
  Object.freeze({ kind: 'route', routeId });
export const selectStop = (stopPlaceId: StopPlaceId): GameSelection =>
  Object.freeze({ kind: 'stop', stopPlaceId });
export const selectVehicle = (vehicleId: VehicleId): GameSelection =>
  Object.freeze({ kind: 'vehicle', vehicleId });

export const selectionExists = (
  selection: GameSelection,
  input: Readonly<{
    routeIds: ReadonlySet<string>;
    stopPlaceIds: ReadonlySet<string>;
    vehicleIds: ReadonlySet<string>;
  }>,
) =>
  selection === null ||
  (selection.kind === 'route'
    ? input.routeIds.has(selection.routeId)
    : selection.kind === 'stop'
      ? input.stopPlaceIds.has(selection.stopPlaceId)
      : input.vehicleIds.has(selection.vehicleId));
