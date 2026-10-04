import type { D3dWorldPoint } from './d3d-map-model.js';
export type UrbanCorridor = Readonly<{
  from: D3dWorldPoint;
  to: D3dWorldPoint;
  width: number;
}>;
export function citySeed(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
export function distanceToCorridor(
  point: D3dWorldPoint,
  corridor: UrbanCorridor,
): number {
  const dx = corridor.to.x - corridor.from.x,
    dz = corridor.to.z - corridor.from.z;
  const squared = dx * dx + dz * dz;
  const t =
    squared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - corridor.from.x) * dx +
              (point.z - corridor.from.z) * dz) /
              squared,
          ),
        );
  return Math.hypot(
    point.x - corridor.from.x - t * dx,
    point.z - corridor.from.z - t * dz,
  );
}
