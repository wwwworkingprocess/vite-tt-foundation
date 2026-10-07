import type {
  TransportMapBounds,
  TransportMapPoint,
} from './transport-map-projection.js';
type GeographicPosition = Readonly<{ latitude: number; longitude: number }>;
export function projectTransportMapPoint(
  bounds: TransportMapBounds,
  position: GeographicPosition,
): TransportMapPoint {
  const longitudeSpan = bounds.east - bounds.west;
  const latitudeSpan = bounds.north - bounds.south;
  return Object.freeze({
    x:
      longitudeSpan === 0
        ? 0.5
        : (position.longitude - bounds.west) / longitudeSpan,
    y:
      latitudeSpan === 0
        ? 0.5
        : (bounds.north - position.latitude) / latitudeSpan,
  });
}
