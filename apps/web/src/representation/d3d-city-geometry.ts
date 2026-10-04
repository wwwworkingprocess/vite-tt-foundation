import { BoxGeometry, BufferAttribute, BufferGeometry, Color } from 'three';
import type { BuildingArchetype, ProceduralCity } from './d3d-city-model.js';

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
const wings: Record<BuildingArchetype, readonly Part[]> = {
  house: [box(0, 0, 0.82, 0.82)],
  terrace: [
    box(-1 / 3, 0, 1 / 3, 1, 0.86),
    box(0, 0, 1 / 3, 1, 1),
    box(1 / 3, 0, 1 / 3, 1, 0.92),
  ],
  slab: [box(0, 0, 1, 0.8)],
  'corner-l': [box(-0.32, 0, 0.36, 1), box(0.18, 0.32, 0.64, 0.36)],
  'courtyard-u': [
    box(-0.34, 0, 0.32, 1),
    box(0.34, 0, 0.32, 1),
    box(0, 0.34, 0.36, 0.32),
  ],
};

/** Unit parcel prototypes: bodies start at Y=0; roof coordinates share the same origin. */
export function cityPrototypeParts(
  kind: BuildingArchetype,
  layer: 'body' | 'roof',
): readonly Part[] {
  if (layer === 'body') return wings[kind];
  if (kind === 'house' || kind === 'terrace')
    return wings[kind].map((part) => ({
      ...part,
      height: 0.3,
      y: part.height + 0.15,
      shape: 'gable',
    }));
  if (kind === 'slab')
    return [
      box(0, 0, 1, 0.8, 0.045, 1.0225),
      box(-0.47, 0, 0.06, 0.8, 0.12, 1.105),
      box(0.47, 0, 0.06, 0.8, 0.12, 1.105),
      box(0, -0.37, 0.88, 0.06, 0.12, 1.105),
      box(0, 0.37, 0.88, 0.06, 0.12, 1.105),
    ];
  return wings[kind].map((part) => ({ ...part, height: 0.07, y: 1.035 }));
}

/** Small bounded prototypes, merged once per batch, rather than a React tree per parcel. */
export function createCityPrototypeGeometry(
  kind: BuildingArchetype,
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
export function createCitySurfaceGeometry(
  city: ProceduralCity,
  layer: 'ground' | 'street',
) {
  const positions: number[] = [],
    colors: number[] = [];
  const quad = (points: readonly (readonly number[])[], color: Color) => {
    for (const index of [0, 1, 2, 1, 3, 2]) {
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
  } else {
    for (const road of city.corridors) {
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
        new Color('#777b70'),
      );
    }
  }
  const geometry = new BufferGeometry();
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
