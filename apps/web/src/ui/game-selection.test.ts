import { describe, expect, it } from 'vitest';
import type { RouteId, StopPlaceId } from '@torrevieja-tycoon/transport-domain';
import type { VehicleId } from '@torrevieja-tycoon/simulation';
import {
  selectionExists,
  selectRoute,
  selectStop,
  selectVehicle,
} from './game-selection.js';

describe('renderer-independent game selection', () => {
  const entities = {
    routeIds: new Set(['route']),
    stopPlaceIds: new Set(['stop']),
    vehicleIds: new Set(['vehicle']),
  };

  it('creates immutable route, stop, and vehicle identities', () => {
    const values = [
      selectRoute('route' as RouteId),
      selectStop('stop' as StopPlaceId),
      selectVehicle('vehicle' as VehicleId),
    ];
    expect(values).toEqual([
      { kind: 'route', routeId: 'route' },
      { kind: 'stop', stopPlaceId: 'stop' },
      { kind: 'vehicle', vehicleId: 'vehicle' },
    ]);
    expect(values.every(Object.isFrozen)).toBe(true);
  });

  it('recognizes available and stale identities for every selection kind', () => {
    expect(selectionExists(null, entities)).toBe(true);
    expect(selectionExists(selectRoute('route' as RouteId), entities)).toBe(
      true,
    );
    expect(selectionExists(selectStop('stop' as StopPlaceId), entities)).toBe(
      true,
    );
    expect(
      selectionExists(selectVehicle('vehicle' as VehicleId), entities),
    ).toBe(true);
    expect(selectionExists(selectRoute('missing' as RouteId), entities)).toBe(
      false,
    );
    expect(
      selectionExists(selectStop('missing' as StopPlaceId), entities),
    ).toBe(false);
    expect(
      selectionExists(selectVehicle('missing' as VehicleId), entities),
    ).toBe(false);
  });
});
