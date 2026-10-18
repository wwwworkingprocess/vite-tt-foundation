import type { TerrainRuntime } from '../terrain/terrain-runtime.js';
import {
  terrainViewportSchema,
  freezeTerrain,
} from '../terrain/terrain-catalog.js';
import { record } from './preparation-protocol.js';
export type NativeTerrainDto = Readonly<
  Pick<
    TerrainRuntime,
    'identity' | 'viewport' | 'resolution' | 'statistics' | 'coastline'
  > & { elevations: Float64Array; land: Uint8Array }
>;
/** Worker emits independent buffers. Transferring these never detaches its native cache. */
export function packNativeTerrain(terrain: TerrainRuntime): NativeTerrainDto {
  const { width, height } = terrain.viewport;
  const elevations = new Float64Array(width * height),
    land = new Uint8Array(width * height);
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const i = r * width + c,
        v = terrain.sample(r, c);
      land[i] = terrain.classify(r, c) === 'land' ? 1 : 0;
      elevations[i] = v ?? 0;
    }
  return {
    identity: terrain.identity,
    viewport: terrain.viewport,
    resolution: terrain.resolution,
    statistics: terrain.statistics,
    coastline: terrain.coastline,
    elevations,
    land,
  };
}
const decoded = new WeakMap<object, TerrainRuntime>();
/** Reconstitutes only constant-size closures, never reparses raster JSON on the UI thread. */
export function unpackNativeTerrain(value: unknown): TerrainRuntime {
  if (
    !record(value) ||
    typeof value.identity !== 'string' ||
    !(
      ArrayBuffer.isView(value.elevations) &&
      Object.prototype.toString.call(value.elevations) ===
        '[object Float64Array]'
    ) ||
    !(
      ArrayBuffer.isView(value.land) &&
      Object.prototype.toString.call(value.land) === '[object Uint8Array]'
    ) ||
    !record(value.resolution) ||
    !record(value.statistics) ||
    !record(value.coastline)
  )
    throw new Error('Invalid prepared native terrain');
  const old = decoded.get(value);
  if (old) return old;
  const viewport = terrainViewportSchema.parse(value.viewport);
  const n = viewport.width * viewport.height;
  if (
    (value.elevations as Float64Array).length !== n ||
    (value.land as Uint8Array).length !== n ||
    value.elevations.byteLength + value.land.byteLength > 128 * 1024 * 1024
  )
    throw new Error('Prepared terrain buffer length mismatch');
  // The trusted worker already validated every source value/classification. Envelope
  // metadata is validated here; typed-array buffers remain private to these closures.
  const dto = value as unknown as NativeTerrainDto;
  const index = (r: number, c: number) => {
    if (
      !Number.isInteger(r) ||
      !Number.isInteger(c) ||
      r < 0 ||
      c < 0 ||
      r >= viewport.height ||
      c >= viewport.width
    )
      throw new RangeError('Terrain native sample outside viewport');
    return r * viewport.width + c;
  };
  const runtime = Object.freeze({
    identity: dto.identity,
    viewport: freezeTerrain(viewport),
    resolution: Object.freeze(dto.resolution),
    statistics: Object.freeze(dto.statistics),
    coastline: freezeTerrain(dto.coastline),
    sample: (r: number, c: number) => {
      const i = index(r, c);
      return dto.land[i] === 1 ? dto.elevations[i]! : null;
    },
    classify: (r: number, c: number) =>
      dto.land[index(r, c)] === 1 ? ('land' as const) : ('water' as const),
  });
  decoded.set(value, runtime);
  return runtime;
}
