import type { TerrainRuntime } from '../terrain/terrain-runtime.js';
const shades = new WeakMap<TerrainRuntime, Map<number, Float32Array>>();
/** Presentation-only fixed northwest sun at 35 degrees. Five bounded horizon
 * probes over 1..16 diagonal cells model terrain self-shadow without a shadow map or frames.
 * Elevation emphasis is supplied by the shared ground mapper, never source DEM. */
export function terrainSelfShade(
  terrain: TerrainRuntime,
  col: number,
  row: number,
  elevationScale: number,
): number {
  const { width, height } = terrain.viewport;
  const c = Math.floor(col),
    r = Math.floor(row);
  if (
    c < 0 ||
    r < 0 ||
    c >= width ||
    r >= height ||
    terrain.classify(r, c) !== 'land'
  )
    return 1;
  let scales = shades.get(terrain);
  if (!scales) {
    scales = new Map();
    shades.set(terrain, scales);
  }
  let field = scales.get(elevationScale);
  if (!field) {
    field = new Float32Array(width * height).fill(NaN);
    scales.set(elevationScale, field);
  }
  const index = r * width + c;
  if (!Number.isNaN(field[index])) return field[index]!;
  const h = terrain.sample(r, c)!;
  const west = terrain.sample(r, Math.max(0, c - 1)) ?? h;
  const north = terrain.sample(Math.max(0, r - 1), c) ?? h;
  const east = terrain.sample(r, Math.min(width - 1, c + 1)) ?? h;
  const south = terrain.sample(Math.min(height - 1, r + 1), c) ?? h;
  // Bright sun-facing slopes and restrained dark backslope shading.
  const dx = ((east - west) * elevationScale) / (2 * terrain.resolution.x);
  const dz = ((south - north) * elevationScale) / (2 * terrain.resolution.y);
  const facing = (1 + (dx + dz) * Math.SQRT1_2) / Math.hypot(dx, dz, 1);
  let shade = 0.82 + 0.18 * Math.max(0, Math.min(1, facing));
  for (const step of [1, 2, 4, 8, 16]) {
    if (r < step || c < step) break;
    const ridge = terrain.sample(r - step, c - step);
    if (
      ridge !== null &&
      (ridge - h) * elevationScale >
        step *
          Math.hypot(terrain.resolution.x, terrain.resolution.y) *
          Math.tan((35 * Math.PI) / 180)
    ) {
      shade *= 0.8;
      break;
    }
  }
  field[index] = Math.max(0.65, shade);
  return field[index];
}
