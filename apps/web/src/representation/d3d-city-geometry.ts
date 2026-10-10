import type { D3dLodBand } from './d3d-map-model.js';
import { d3dDrapePolicy } from './d3d-presentation-policy.js';
import { drapeD3dGeometry } from './d3d-terrain-geometry.js';
import { terrainLayerOffsets, type D3dTerrain } from './d3d-terrain-model.js';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShapeUtils,
  Vector2,
} from 'three';
import type {
  BuildingPrototypeKind,
  CityBounds,
  ProceduralCity,
} from './d3d-city-model.js';

/** Clip only emitted flat presentation triangles; research geometry remains untouched. */
export function clipCityPolygon(
  polygon: readonly Vector2[],
  bounds: CityBounds,
): readonly Vector2[] {
  let result = [...polygon];
  for (const [axis, limit, sign] of [
    ['x', bounds.minX, 1],
    ['x', bounds.maxX, -1],
    ['y', bounds.minZ, 1],
    ['y', bounds.maxZ, -1],
  ] as const) {
    const input = result;
    result = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!,
        b = input[(i + 1) % input.length]!;
      const insideA = (a[axis] - limit) * sign >= 0,
        insideB = (b[axis] - limit) * sign >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB)
        result.push(a.clone().lerp(b, (limit - a[axis]) / (b[axis] - a[axis])));
    }
  }
  return result;
}

type Part = Readonly<{
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  shape: 'box' | 'gable';
}>;
const box = (
  x: number,
  z: number,
  width: number,
  depth: number,
  height = 1,
  y = height / 2,
): Part => ({ x, y, z, width, depth, height, shape: 'box' });
const wings: Record<BuildingPrototypeKind, readonly Part[]> = {
  'detached-villa': [
    box(0.12, -0.06, 0.62, 0.72, 0.85),
    box(-0.33, -0.15, 0.28, 0.48, 0.65),
    box(0.05, 0.39, 0.8, 0.18, 0.12),
  ],
  'landmark-placeholder': [
    box(0, 0, 1, 0.8, 0.2),
    box(0, 0, 0.7, 0.5, 0.5, 0.45),
    box(0, 0, 0.25, 0.25, 0.3, 0.85),
  ],
  'detached-house': [box(0, 0, 0.82, 0.82)],
  'semi-detached': [
    box(-0.22, 0, 0.44, 0.82),
    box(0.22, 0.04, 0.44, 0.74, 0.92),
  ],
  'terrace-row': [
    box(-1 / 3, 0, 1 / 3, 1, 0.86),
    box(0, 0, 1 / 3, 1, 1),
    box(1 / 3, 0, 1 / 3, 1, 0.92),
  ],
  'small-apartment': [
    box(0, 0.05, 0.84, 0.9, 0.9),
    box(0, -0.3, 0.6, 0.2, 0.1, 0.95),
  ],
  'midrise-slab': [box(0, 0, 1, 0.8)],
  'perimeter-block': [
    box(-0.37, 0, 0.26, 1),
    box(0.37, 0, 0.26, 1),
    box(0, -0.37, 0.48, 0.26),
    box(0, 0.37, 0.48, 0.26),
  ],
  'tower-podium': [
    box(0, 0, 1, 0.9, 0.24),
    box(0.06, 0.03, 0.42, 0.42, 0.76, 0.62),
  ],
  'commercial-box': [
    box(0, 0.08, 1, 0.84, 0.8),
    box(0, -0.43, 0.7, 0.14, 0.28),
  ],
  'industrial-shed': [
    box(0, 0.09, 1, 0.82, 0.85),
    box(-0.2, -0.43, 0.6, 0.14, 0.5),
  ],
  'civic-special': [
    box(-0.34, 0, 0.32, 0.74, 0.72),
    box(0.34, 0.06, 0.32, 0.62, 0.62),
    box(0, 0, 0.36, 1),
  ],
  'corner-l': [box(-0.32, 0, 0.36, 1), box(0.18, 0.32, 0.64, 0.36)],
  'courtyard-u': [
    box(-0.34, 0, 0.32, 1),
    box(0.34, 0, 0.32, 1),
    box(0, 0.34, 0.36, 0.32),
  ],
};

/** Unit parcel prototypes: bodies start at Y=0; roof coordinates share the same origin. */
export function cityPrototypeParts(
  kind: BuildingPrototypeKind,
  layer: 'body' | 'roof',
): readonly Part[] {
  if (layer === 'body') return wings[kind];
  if (
    kind === 'detached-house' ||
    kind === 'detached-villa' ||
    kind === 'terrace-row' ||
    kind === 'semi-detached' ||
    kind === 'industrial-shed'
  )
    return wings[kind].map((part) => ({
      ...part,
      height: 0.3,
      y: part.height + 0.15,
      shape: 'gable',
    }));
  if (kind === 'midrise-slab')
    return [
      box(0, 0, 1, 0.8, 0.045, 1.0225),
      box(-0.47, 0, 0.06, 0.8, 0.12, 1.105),
      box(0.47, 0, 0.06, 0.8, 0.12, 1.105),
      box(0, -0.37, 0.88, 0.06, 0.12, 1.105),
      box(0, 0.37, 0.88, 0.06, 0.12, 1.105),
    ];
  return wings[kind].map((part) => ({
    ...part,
    height: 0.07,
    y: part.y + part.height / 2 + 0.035,
  }));
}

/** Small bounded prototypes, merged once per batch, rather than a React tree per parcel. */
export function createCityPrototypeGeometry(
  kind: BuildingPrototypeKind,
  layer: 'body' | 'roof',
) {
  const positions: number[] = [];
  for (const part of cityPrototypeParts(kind, layer)) {
    if (part.shape === 'box') {
      const source = new BoxGeometry(part.width, part.height, part.depth);
      const cube = source.toNonIndexed();
      source.dispose();
      cube.translate(part.x, part.y, part.z);
      positions.push(...cube.getAttribute('position').array);
      cube.dispose();
    } else {
      const x = part.width / 2,
        z = part.depth / 2,
        base = part.y - part.height / 2;
      const points = [
        [-x, base, -z],
        [x, base, -z],
        [0, base + part.height, -z],
        [-x, base, z],
        [x, base, z],
        [0, base + part.height, z],
      ];
      for (const [a, b, c] of [
        [0, 2, 1],
        [3, 4, 5],
        [0, 3, 5],
        [0, 5, 2],
        [1, 2, 5],
        [1, 5, 4],
        [0, 1, 4],
        [0, 4, 3],
      ]) {
        for (const index of [a, b, c]) {
          const p = points[index!]!;
          positions.push(p[0]! + part.x, p[1]!, p[2]! + part.z);
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** One quiet surface batch per layer. Corridor widths belong to the source descriptors. */
function buildCitySurfaceGeometry(
  city: ProceduralCity,
  layer: 'ground' | 'street' | 'landscape' | 'reservation',
  terrain?: D3dTerrain,
  lod: D3dLodBand = 'near',
) {
  const positions: number[] = [],
    colors: number[] = [];
  const quad = (points: readonly (readonly number[])[], color: Color) => {
    for (const index of [0, 2, 1, 1, 2, 3]) {
      positions.push(...points[index]!);
      colors.push(color.r, color.g, color.b);
    }
  };
  if (layer === 'ground') {
    for (const patch of city.ground) {
      const color = new Color('#a7b88d').lerp(
        new Color('#cbb994'),
        patch.density * 0.65,
      );
      quad(
        [
          [patch.minX, 0.012, patch.minZ],
          [patch.maxX, 0.012, patch.minZ],
          [patch.minX, 0.012, patch.maxZ],
          [patch.maxX, 0.012, patch.maxZ],
        ],
        color,
      );
    }
  } else if (layer === 'street') {
    for (const road of [...city.corridors, ...(city.localStreets ?? [])]) {
      const length = Math.hypot(
        road.to.x - road.from.x,
        road.to.z - road.from.z,
      );
      const dx = ((road.to.z - road.from.z) * road.width) / (2 * length),
        dz = ((road.from.x - road.to.x) * road.width) / (2 * length);
      quad(
        [
          [road.from.x - dx, 0.045, road.from.z - dz],
          [road.from.x + dx, 0.045, road.from.z + dz],
          [road.to.x - dx, 0.045, road.to.z - dz],
          [road.to.x + dx, 0.045, road.to.z + dz],
        ],
        new Color('#92988c'),
      );
    }
  } else {
    const polygons =
      layer === 'landscape'
        ? (city.landscapes ?? [])
            .filter((region) => region.kind !== 'water')
            .map((region) => ({
              rings: region.rings,
              color: region.color,
              surfaceY: region.surfaceY ?? 0.025,
            }))
        : (city.reservations ?? []).map((reservation) => ({
            color: '#c5c3a2',
            surfaceY: 0.032,
            rings: [
              Array.from({ length: 17 }, (_, i) => ({
                x:
                  reservation.x +
                  Math.cos((i * Math.PI) / 8) * reservation.radius,
                z:
                  reservation.z +
                  Math.sin((i * Math.PI) / 8) * reservation.radius,
              })),
            ],
          }));
    for (const polygon of polygons) {
      const rings = polygon.rings.map((ring) =>
        ring.slice(0, -1).map((point) => new Vector2(point.x, point.z)),
      );
      const flat = rings.flat();
      for (const face of ShapeUtils.triangulateShape(
        rings[0]!,
        rings.slice(1),
      )) {
        const clipped = clipCityPolygon(
          face.map((index) => flat[index]!),
          city.bounds,
        );
        const color = new Color(polygon.color);
        for (let i = 1; i < clipped.length - 1; i++)
          for (const point of [clipped[0]!, clipped[i + 1]!, clipped[i]!]) {
            positions.push(point.x, polygon.surfaceY, point.y);
            colors.push(color.r, color.g, color.b);
          }
      }
    }
  }
  const surface = new BufferGeometry();
  surface.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  surface.setAttribute(
    'color',
    new BufferAttribute(new Float32Array(colors), 3),
  );
  if (terrain) {
    drapeD3dGeometry(
      surface,
      terrain,
      terrainLayerOffsets.surface,
      true,
      (layer === 'landscape'
        ? d3dDrapePolicy('normal', lod).landscapeMetres
        : d3dDrapePolicy('normal', lod).surfaceMetres) * terrain.metre,
      undefined,
      true,
    );
    if (layer !== 'reservation') return surface;
    positions.length = 0;
    colors.length = 0;
    const pos = surface.getAttribute('position'),
      rgb = surface.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      colors.push(rgb.getX(i), rgb.getY(i), rgb.getZ(i));
    }
  }
  const limited = surface.userData.drapeLimited === true;
  surface.dispose();
  if (layer === 'reservation') {
    const anchor = createCityPrototypeGeometry('landmark-placeholder', 'body');
    const vertices = anchor.getAttribute('position');
    const color = new Color('#ded8c6');
    for (const reservation of city.reservations ?? []) {
      if (
        !reservation.anchorHeight ||
        reservation.x - reservation.radius < city.bounds.minX ||
        reservation.x + reservation.radius > city.bounds.maxX ||
        reservation.z - reservation.radius < city.bounds.minZ ||
        reservation.z + reservation.radius > city.bounds.maxZ
      )
        continue;
      for (let i = 0; i < vertices.count; i++) {
        positions.push(
          reservation.x + vertices.getX(i) * reservation.radius * 0.9,
          (terrain
            ? terrain.ground(reservation.x, reservation.z).y +
              terrainLayerOffsets.surface * terrain.metre
            : 0.035) +
            vertices.getY(i) * reservation.anchorHeight,
          reservation.z + vertices.getZ(i) * reservation.radius * 0.9,
        );
        colors.push(color.r, color.g, color.b);
      }
    }
    anchor.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.userData.drapeLimited = limited;
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Float32Array(colors), 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** Cache only CPU templates by immutable city/world/layer/LOD. Each renderer owns fresh
 * attribute identities and disposal; shared arrays are never mutated. This avoids
 * repeating polygon subdivision during StrictMode and mini/main canvas mounts. */
const terrainSurfaces = new WeakMap<
  ProceduralCity,
  WeakMap<D3dTerrain, Map<string, BufferGeometry>>
>();
export function createCitySurfaceGeometry(
  city: ProceduralCity,
  layer: 'ground' | 'street' | 'landscape' | 'reservation',
  terrain?: D3dTerrain,
  lod: D3dLodBand = 'near',
) {
  if (!terrain) return buildCitySurfaceGeometry(city, layer);
  let worlds = terrainSurfaces.get(city);
  if (!worlds) {
    worlds = new WeakMap();
    terrainSurfaces.set(city, worlds);
  }
  let layers = worlds.get(terrain);
  if (!layers) {
    layers = new Map();
    worlds.set(terrain, layers);
  }
  const key = layer + ':' + lod;
  let template = layers.get(key);
  if (!template) {
    template = buildCitySurfaceGeometry(city, layer, terrain, lod);
    layers.set(key, template);
  }
  const geometry = new BufferGeometry();
  geometry.userData.drapeLimited = template.userData.drapeLimited === true;
  for (const name of ['position', 'color', 'normal']) {
    const attribute = template.getAttribute(name);
    geometry.setAttribute(
      name,
      new BufferAttribute(attribute.array, attribute.itemSize),
    );
  }
  return geometry;
}
