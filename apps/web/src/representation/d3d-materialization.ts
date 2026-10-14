import { resolveSiteSurfacePresentation } from './d3d-material-presets.js';
import { ShapeUtils, Vector2 } from 'three';
import {
  d3dProjectedPoint,
  type D3dMapModel,
  type D3dLodBand,
} from './d3d-map-model.js';
import type { D3dTerrain } from './d3d-terrain-model.js';
import type {
  CityMaterialization,
  MaterializationGeometry,
  MaterializationRecipe,
  materializationRenderKeys,
} from './city-materialization.js';
import { materializationLevel } from './city-materialization-loader.js';
import {
  footprintInside,
  footprintRing,
  footprintOverlaps,
} from './d3d-footprint.js';
import type { ProceduralCity } from './d3d-city-model.js';
export type SiteKit = (typeof materializationRenderKeys)[number];
type Point = readonly [number, number];
export const materializationBudgets = Object.freeze({
  triangles: 131072,
  batches: 32,
  instances: 4096,
  proposalsPerSite: 65536,
});
export const siteKitDimensions: Readonly<
  Record<SiteKit, readonly [number, number, number]>
> = Object.freeze({
  'market-canopy-v0': [8, 6, 3],
  'beach-umbrella-v0': [3, 3, 2.4],
  'park-tree-v0': [3, 3, 6],
  'small-boat-v0': [2, 6, 1.2],
  'salt-stack-v0': [4, 6, 2],
  'tower-proxy-v0': [5, 5, 10],
  'civic-proxy-v0': [28, 12, 8],
});
export type SiteInstance = Readonly<{
  id: string;
  siteId: string;
  kit: SiteKit;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
}>;
export type MaterializationPlan = Readonly<{
  settlementId: string;
  surfaces: readonly Readonly<{
    siteId: string;
    materialPreset: Extract<
      MaterializationRecipe,
      { kind: 'surface' }
    >['preset'];
    positions: Float32Array;
    /** Palette-independent world-space modulation, never source geometry/color authority. */
    toneWeights?: Float32Array;
  }>[];
  instances: readonly SiteInstance[];
  diagnostics: readonly Readonly<{
    siteId: string;
    triangles: number;
    instances: number;
    maskMismatches: number;
    unsupportedModels: number;
    suppressedSurfaces: number;
  }>[];
  triangles: number;
  bytes: number;
}>;
const cache = new WeakMap<
  CityMaterialization,
  WeakMap<
    D3dMapModel,
    WeakMap<D3dTerrain, Map<D3dLodBand, MaterializationPlan>>
  >
>();
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function projected(
  feature: MaterializationGeometry,
  map: D3dMapModel,
): Point[][][] {
  const g = feature.geometry;
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon')
    throw new Error('Materialization extent geometry invalid');
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polygons.map((p) =>
    p.map((r) =>
      r.map(([longitude, latitude]) => {
        const v = d3dProjectedPoint(map, { longitude, latitude });
        return [v.x, v.z] as const;
      }),
    ),
  );
}
/** Sutherland-Hodgman clipping of already triangulated site faces to native coverage. */
function clip(points: Point[], bounds: D3dTerrain['bounds']): Point[] {
  let result = points;
  for (const [axis, limit, greater] of [
    [0, bounds.minX, true],
    [0, bounds.maxX, false],
    [1, bounds.minZ, true],
    [1, bounds.maxZ, false],
  ] as const) {
    const next: Point[] = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i]!,
        b = result[(i + 1) % result.length]!,
        insideA = greater ? a[axis] >= limit : a[axis] <= limit,
        insideB = greater ? b[axis] >= limit : b[axis] <= limit;
      if (insideA) next.push(a);
      if (insideA !== insideB) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    result = next;
  }
  return result;
}
function surface(
  polygons: Point[][][],
  recipe: Extract<MaterializationRecipe, { kind: 'surface' }>,
  terrain: D3dTerrain,
  lod: D3dLodBand,
  remaining: number,
) {
  const output: number[] = [];
  let mismatches = 0,
    emitted = 0,
    visited = 0;
  const broad =
    polygons.reduce(
      (sum, rings) =>
        sum +
        Math.abs(
          rings[0]!
            .slice(1)
            .reduce(
              (a, p, i) =>
                a + rings[0]![i]![0] * p[1] - p[0] * rings[0]![i]![1],
              0,
            ),
        ) /
          2,
      0,
    ) >
    1e6 * terrain.metre ** 2;
  // Small market grounds need near support at medium too: coarse faces can
  // bridge relief above the native-grounded, three-metre canopy roofs.
  const mediumSupport = recipe.preset === 'market-ground-v0' ? 25 : 100;
  const support =
    ({ far: 200, medium: mediumSupport, near: broad ? 75 : 25 } as const)[lod] *
    terrain.metre;
  const emit = (a: Point, b: Point, c: Point, depth = 0) => {
    if (
      ++visited > materializationBudgets.triangles * 4 ||
      emitted >= remaining
    )
      throw new Error('Materialization triangle budget exceeded');
    if (
      Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) <
      1e-15
    )
      return;
    const ab = distance(a, b),
      bc = distance(b, c),
      ca = distance(c, a);
    if (Math.max(ab, bc, ca) > support) {
      if (depth >= 24)
        throw new Error('Materialization support depth exceeded');
      const midpoint = (p: Point, q: Point): Point => [
        (p[0] + q[0]) / 2,
        (p[1] + q[1]) / 2,
      ];
      if (ab >= bc && ab >= ca) {
        const m = midpoint(a, b);
        emit(a, m, c, depth + 1);
        emit(m, b, c, depth + 1);
      } else if (bc >= ca) {
        const m = midpoint(b, c);
        emit(a, b, m, depth + 1);
        emit(a, m, c, depth + 1);
      } else {
        const m = midpoint(c, a);
        emit(a, b, m, depth + 1);
        emit(m, b, c, depth + 1);
      }
      return;
    }
    const kind = terrain.sample(
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
    ).kind;
    if (
      recipe.terrainRule !== 'native-both' &&
      kind !== (recipe.terrainRule === 'native-land' ? 'land' : 'water')
    ) {
      mismatches++;
      return;
    }
    if (recipe.preset === 'salt-lagoon-pink-v0' && kind === 'land')
      mismatches++;
    // ShapeUtils/Earcut emits CCW in X/Z; clipping preserves order. Reverse for +Y.
    for (const p of [a, c, b])
      output.push(
        p[0],
        terrain.ground(p[0], p[1]).y + recipe.clearanceM * terrain.metre,
        p[1],
      );
    emitted++;
  };
  for (const rings of polygons) {
    const contour = rings[0]!.slice(0, -1).map((p) => new Vector2(...p)),
      holes = rings
        .slice(1)
        .map((r) => r.slice(0, -1).map((p) => new Vector2(...p))),
      vertices = [...contour, ...holes.flat()];
    for (const face of ShapeUtils.triangulateShape(contour, holes)) {
      const clipped = clip(
        face.map((i) => [vertices[i]!.x, vertices[i]!.y]),
        terrain.bounds,
      );
      for (let i = 1; i + 1 < clipped.length; i++)
        emit(clipped[0]!, clipped[i]!, clipped[i + 1]!);
    }
  }
  return { positions: new Float32Array(output), mismatches };
}
/** Balanced interval order, independent of camera/LOD and bounded by proposal guards. */
function progressiveIndices(count: number) {
  const result: number[] = [],
    ranges: [number, number][] = [[0, count]];
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i]!,
      middle = Math.floor((start + end) / 2);
    result.push(middle);
    if (start < middle) ranges.push([start, middle]);
    if (middle + 1 < end) ranges.push([middle + 1, end]);
  }
  return result;
}
/** Static visual recipes never enter the StreetCell placement cache or protections. */
export function prepareCityMaterialization(
  data: CityMaterialization,
  map: D3dMapModel,
  terrain: D3dTerrain,
  lod: D3dLodBand,
): MaterializationPlan {
  let maps = cache.get(data);
  if (!maps) {
    maps = new WeakMap();
    cache.set(data, maps);
  }
  let terrains = maps.get(map);
  if (!terrains) {
    terrains = new WeakMap();
    maps.set(map, terrains);
  }
  let levels = terrains.get(terrain);
  if (!levels) {
    levels = new Map();
    terrains.set(terrain, levels);
  }
  const previous = levels.get(lod);
  if (previous) return previous;
  const surfaces: MaterializationPlan['surfaces'][number][] = [],
    instances: SiteInstance[] = [],
    diagnostics: MaterializationPlan['diagnostics'][number][] = [];
  let triangles = 0;
  for (const { site, geometries } of data.sites) {
    let maskMismatches = 0,
      unsupportedModels = 0,
      suppressedSurfaces = 0,
      siteTriangles = 0,
      siteInstances = 0,
      proposals = 0;
    const polygons = geometries
      .filter(
        (g) =>
          g.reference.role === 'extent' ||
          g.reference.role === 'water-boundary',
      )
      .flatMap((g) => projected(g.feature, map));
    const outer = polygons[0]?.[0];
    let rotation = 0,
      longest = 0;
    for (const r of polygons.map((p) => p[0]!))
      for (let i = 1; i < r.length; i++) {
        const a = r[i - 1]!,
          b = r[i]!,
          length = distance(a, b);
        if (length > longest) {
          longest = length;
          rotation = -Math.atan2(b[1] - a[1], b[0] - a[0]);
        }
      }
    const add = (
      kit: SiteKit,
      p: Point,
      angle: number,
      id: string,
      shrink = false,
      anchorOnly = false,
    ) => {
      if (++proposals > materializationBudgets.proposalsPerSite)
        throw new Error('Materialization proposal budget exceeded');
      const [w, d, h] = siteKitDimensions[kit];
      let width = w * terrain.metre,
        depth = d * terrain.metre;
      let body = { x: p[0], z: p[1], width, depth, rotation: angle };
      if (shrink && polygons.length > 0)
        for (
          let attempt = 0;
          attempt < 16 &&
          !polygons.some((r) => footprintInside(footprintRing(body), r, 0));
          attempt++
        ) {
          width *= 0.9;
          depth *= 0.9;
          body = { ...body, width, depth };
        }
      if (
        !anchorOnly &&
        !polygons.some((r) => footprintInside(footprintRing(body), r, 0))
      )
        return;
      const ring = footprintRing(body);
      if (
        !ring.every(
          (q) =>
            q[0] >= terrain.bounds.minX &&
            q[0] <= terrain.bounds.maxX &&
            q[1] >= terrain.bounds.minZ &&
            q[1] <= terrain.bounds.maxZ,
        )
      )
        return;
      const expected = kit === 'small-boat-v0' ? 'water' : 'land';
      if (!ring.every((q) => terrain.sample(...q).kind === expected)) {
        maskMismatches++;
        return;
      }
      if (instances.length >= materializationBudgets.instances)
        throw new Error('Materialization instance budget exceeded');
      instances.push(
        Object.freeze({
          id,
          siteId: site.id,
          kit,
          ...body,
          y: terrain.ground(...p).y + 0.08 * terrain.metre,
          height: h * terrain.metre,
        }),
      );
      siteInstances++;
    };
    for (let index = 0; index < site.recipes.length; index++) {
      const recipe = site.recipes[index]!,
        key = site.id + ':' + index;
      if (recipe.kind === 'surface') {
        const presentation = resolveSiteSurfacePresentation(
          data.catalog.settlementId,
          recipe.preset,
          site.id,
        );
        if (!presentation.visible) {
          suppressedSurfaces++;
          continue;
        }
        const result = surface(
          polygons,
          recipe,
          terrain,
          lod,
          materializationBudgets.triangles - triangles,
        );
        siteTriangles += result.positions.length / 9;
        triangles += result.positions.length / 9;
        maskMismatches += result.mismatches;
        const toneWeights =
          presentation.tonalVariation > 0
            ? new Float32Array(result.positions.length / 3)
            : undefined;
        if (toneWeights)
          for (let i = 0; i < toneWeights.length; i++) {
            const x = result.positions[i * 3]!,
              z = result.positions[i * 3 + 2]!;
            toneWeights[i] =
              1 +
              presentation.tonalVariation *
                (0.6 * Math.sin(x / (450 * terrain.metre)) +
                  0.4 * Math.cos(z / (900 * terrain.metre)));
          }
        if (result.positions.length > 0)
          surfaces.push(
            Object.freeze({
              siteId: site.id,
              materialPreset: recipe.preset,
              positions: result.positions,
              ...(toneWeights ? { toneWeights } : {}),
            }),
          );
        continue;
      }
      if (recipe.kind === 'glb-model') {
        unsupportedModels++;
        continue;
      }
      const kit = data.kits.kits.find((k) => k.id === recipe.kitId)!.renderKey;
      if (recipe.kind === 'single-kit') {
        const anchor = geometries.find((g) => g.reference.role === 'anchor')
          ?.feature.geometry;
        if (recipe.placement === 'anchor') {
          if (anchor?.type !== 'Point')
            throw new Error('Materialization anchor missing');
          const p = d3dProjectedPoint(map, {
            longitude: anchor.coordinates[0],
            latitude: anchor.coordinates[1],
          });
          add(
            kit,
            [p.x, p.z],
            (recipe.rotationDeg * Math.PI) / 180,
            key,
            true,
            polygons.length === 0,
          );
        } else {
          if (!outer) throw new Error('Materialization extent missing');
          const origin = outer[0]!;
          let area = 0,
            weightedX = 0,
            weightedZ = 0;
          for (const [index, ring] of polygons[0]!.entries()) {
            let crossSum = 0,
              xSum = 0,
              zSum = 0;
            for (let i = 1; i < ring.length; i++) {
              const a = ring[i - 1]!,
                b = ring[i]!,
                ax = a[0] - origin[0],
                az = a[1] - origin[1],
                bx = b[0] - origin[0],
                bz = b[1] - origin[1],
                cross = ax * bz - bx * az;
              crossSum += cross;
              xSum += (ax + bx) * cross;
              zSum += (az + bz) * cross;
            }
            const weight = (index === 0 ? 1 : -1) * Math.abs(crossSum);
            area += weight;
            weightedX += (weight * xSum) / (3 * crossSum);
            weightedZ += (weight * zSum) / (3 * crossSum);
          }
          const p: Point = [
            origin[0] + weightedX / area,
            origin[1] + weightedZ / area,
          ];
          add(
            kit,
            p,
            rotation + (recipe.rotationDeg * Math.PI) / 180,
            key,
            true,
          );
        }
        continue;
      }
      const count = Math.floor(
        recipe.maxInstances * recipe.lodFractions[materializationLevel(lod)],
      );
      if (recipe.kind === 'area-repeat') {
        if (!outer) throw new Error('Materialization extent missing');
        let angle = recipe.orientation === 'north' ? 0 : rotation;
        if (recipe.orientation === 'layout-guide') {
          const guide = geometries.find(
            (g) => g.reference.role === 'layout-guide',
          )?.feature.geometry;
          const line =
            guide?.type === 'LineString'
              ? guide.coordinates
              : guide?.type === 'MultiLineString'
                ? guide.coordinates[0]
                : undefined;
          if (!line) throw new Error('Materialization layout guide missing');
          const a = d3dProjectedPoint(map, {
              longitude: line[0]![0],
              latitude: line[0]![1],
            }),
            b = d3dProjectedPoint(map, {
              longitude: line[1]![0],
              latitude: line[1]![1],
            });
          angle = -Math.atan2(b.z - a.z, b.x - a.x);
        }
        const cos = Math.cos(angle),
          sin = Math.sin(angle),
          local = polygons
            .flatMap((p) => p[0]!)
            .map(
              (p) =>
                [cos * p[0] - sin * p[1], sin * p[0] + cos * p[1]] as const,
            );
        const step = recipe.spacingM * terrain.metre,
          minU = Math.min(...local.map((p) => p[0])),
          maxU = Math.max(...local.map((p) => p[0])),
          minV = Math.min(...local.map((p) => p[1])),
          maxV = Math.max(...local.map((p) => p[1]));
        const seed = site.id
          .split('')
          .reduce((sum, c) => sum + c.charCodeAt(0), 0);
        let accepted = 0;
        if (recipe.pattern === 'rows' && count > 0) {
          // Keep short-side aisles twice the along-row spacing. Select separated
          // rows before progressive columns, so every LOD prefix spans the site.
          const columns = Math.max(
            0,
            Math.ceil((maxU - minU - step / 2) / step),
          );
          const rows = Math.max(
            0,
            Math.ceil((maxV - minV - step / 2) / (2 * step)),
          );
          if (columns * rows > materializationBudgets.proposalsPerSite)
            throw new Error('Materialization proposal budget exceeded');
          if (columns > 0 && rows > 0) {
            const selectedCount = Math.min(
              rows,
              Math.ceil(recipe.maxInstances / columns) + 1,
            );
            const selected = Array.from({ length: selectedCount }, (_, i) =>
              Math.floor(((i + 0.5) * rows) / selectedCount),
            );
            const selectedSet = new Set(selected);
            const deferred = progressiveIndices(rows).filter(
              (i) => !selectedSet.has(i),
            );
            const columnOrder = progressiveIndices(columns);
            for (const rowGroup of [selected, deferred]) {
              for (const col of columnOrder) {
                for (const row of rowGroup) {
                  if (accepted >= count) break;
                  const u = minU + step / 2 + col * step,
                    v = minV + step / 2 + row * 2 * step;
                  const before = instances.length;
                  add(
                    kit,
                    [cos * u + sin * v, -sin * u + cos * v],
                    angle,
                    key + ':' + row + ':' + col,
                  );
                  if (instances.length > before) accepted++;
                }
                if (accepted >= count) break;
              }
              if (accepted >= count) break;
            }
          }
        } else
          for (
            let row = 0, v = minV + step / 2;
            v < maxV && accepted < count;
            v += step, row++
          )
            for (
              let col = 0, u = minU + step / 2;
              u < maxU && accepted < count;
              u += step, col++
            ) {
              const before = instances.length;
              const shift =
                recipe.pattern === 'scattered'
                  ? Math.sin(seed + row * 17 + col * 13) * step * 0.15
                  : 0;
              const x = cos * (u + shift) + sin * v,
                z = -sin * (u + shift) + cos * v;
              add(kit, [x, z], angle, key + ':' + row + ':' + col);
              if (instances.length > before) accepted++;
            }
      } else {
        const guides = geometries.filter(
          (g) => g.reference.role === recipe.geometryRole,
        );
        if (!guides.length)
          throw new Error('Materialization layout guide missing');
        let accepted = 0;
        for (const guide of guides) {
          const g = guide.feature.geometry;
          if (g.type !== 'LineString' && g.type !== 'MultiLineString')
            throw new Error('Materialization guide geometry invalid');
          const lines =
            g.type === 'LineString' ? [g.coordinates] : g.coordinates;
          for (const line of lines)
            for (let i = 1; i < line.length && accepted < count; i++) {
              const a = d3dProjectedPoint(map, {
                  longitude: line[i - 1]![0],
                  latitude: line[i - 1]![1],
                }),
                b = d3dProjectedPoint(map, {
                  longitude: line[i]![0],
                  latitude: line[i]![1],
                }),
                length = Math.hypot(b.x - a.x, b.z - a.z),
                step = recipe.spacingM * terrain.metre;
              for (
                let s = step / 2;
                s < length && accepted < count;
                s += step
              ) {
                const before = instances.length,
                  t = s / length;
                add(
                  kit,
                  [a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t],
                  -Math.atan2(b.z - a.z, b.x - a.x),
                  key +
                    ':' +
                    guide.reference.sourceFeatureId +
                    ':' +
                    i +
                    ':' +
                    s,
                );
                if (instances.length > before) accepted++;
              }
            }
        }
      }
    }
    diagnostics.push(
      Object.freeze({
        siteId: site.id,
        triangles: siteTriangles,
        instances: siteInstances,
        maskMismatches,
        unsupportedModels,
        suppressedSurfaces,
      }),
    );
  }
  if (
    surfaces.length + new Set(instances.map((i) => i.kit)).size * 2 >
    materializationBudgets.batches
  )
    throw new Error('Materialization batch budget exceeded');
  const result = Object.freeze({
    settlementId: data.catalog.settlementId,
    surfaces: Object.freeze(surfaces),
    instances: Object.freeze(instances),
    diagnostics: Object.freeze(diagnostics),
    triangles,
    bytes:
      surfaces.reduce(
        (s, p) => s + p.positions.byteLength + (p.toneWeights?.byteLength ?? 0),
        0,
      ) +
      instances.length * 64,
  });
  levels.set(lod, result);
  return result;
}
export function diagnoseMaterializationOverlaps(
  data: CityMaterialization,
  map: D3dMapModel,
  city: ProceduralCity,
) {
  return data.sites.map(({ site, geometries }) => {
    const areas = geometries
      .filter((g) => g.reference.role === 'extent')
      .flatMap((g) => projected(g.feature, map));
    const buildingIds = city.buildings
      .filter((b) =>
        areas.some((p) => footprintOverlaps(footprintRing(b), p, 0)),
      )
      .map((b) => b.id);
    return Object.freeze({
      siteId: site.id,
      buildingIds: Object.freeze(buildingIds),
    });
  });
}
