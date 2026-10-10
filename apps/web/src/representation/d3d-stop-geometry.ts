import { BufferAttribute, BufferGeometry, Color } from 'three';
import type {
  CanonicalScenario,
  RouteId,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import type { D3dMapModel } from './d3d-map-model.js';
import { terrainLayerOffsets, type D3dTerrain } from './d3d-terrain-model.js';
/** Canonical service membership, including every directional node. Shared stops
 * prefer the active route when served, otherwise the first canonical service. */
export function d3dStopColors(
  model: D3dMapModel,
  scenario: CanonicalScenario,
  preferred?: RouteId,
) {
  const places = new Map(
    scenario.stops.stopNodes.map((n) => [n.stopNodeId, n.stopPlaceId]),
  );
  const services = new Map<StopPlaceId, RouteId[]>();
  for (const route of scenario.routes.routes)
    for (const pattern of route.patterns)
      for (const node of pattern.stopNodeIds) {
        const place = places.get(node);
        if (place) {
          const routes = services.get(place) ?? [];
          if (!routes.includes(route.routeId)) routes.push(route.routeId);
          services.set(place, routes);
        }
      }
  const colors = new Map(model.routes.map((r) => [r.routeId, r.color]));
  return Object.freeze(
    model.stops.map((stop) => {
      const routes = services.get(stop.stopPlaceId) ?? [];
      const route =
        preferred && routes.includes(preferred) ? preferred : routes[0];
      return route ? (colors.get(route) ?? '#477d89') : '#477d89';
    }),
  );
}
export function d3dStopRadius(metre: number | undefined) {
  return metre ? 10 * metre : 0.325;
}
/** Batched terrain-draped disks/rings. Size is ordinary metres, elevation is
 * shared ground mapping. Invisible instance targets retain generous picking.
 * Caller owns GPU buffers; no per-stop React object or new semantic authority. */
export function createD3dStopGeometry(
  stops: D3dMapModel['stops'],
  colors: readonly string[],
  radius: number,
  terrain?: D3dTerrain,
  selection = false,
) {
  const positions: number[] = [],
    rgb: number[] = [];
  const offset = terrain
    ? (selection ? terrainLayerOffsets.selection : terrainLayerOffsets.stop) *
      terrain.metre
    : selection
      ? 0.17
      : 0.045;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!,
      color = new Color(colors[i]);
    const vertex = (angle: number, r: number) => {
      const x = stop.x + Math.cos(angle) * r,
        z = stop.z + Math.sin(angle) * r;
      positions.push(x, (terrain?.ground(x, z).y ?? 0) + offset, z);
      rgb.push(color.r, color.g, color.b);
    };
    for (let j = 0; j < 32; j++) {
      const a = (j * Math.PI) / 16,
        b = ((j + 1) * Math.PI) / 16;
      if (selection) {
        vertex(a, radius * 0.8);
        vertex(b, radius);
        vertex(a, radius);
        vertex(a, radius * 0.8);
        vertex(b, radius * 0.8);
        vertex(b, radius);
      } else {
        vertex(0, 0);
        vertex(b, radius);
        vertex(a, radius);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(rgb), 3));
  geometry.computeBoundingSphere();
  return geometry;
}
