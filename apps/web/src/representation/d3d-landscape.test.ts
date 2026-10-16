import { expect, it } from 'vitest';
import {
  buildLandscapeLayout,
  selectLandscapeLod,
  type LandscapeArea,
} from './d3d-landscape.js';
import { footprintInside, footprintRing } from './d3d-footprint.js';
import { preparePolygonQuery } from '../settlement/settlement-metadata-spatial.js';
const rect = (x: number, z: number, w: number) =>
  [
    [x, z],
    [x + w, z],
    [x + w, z + w],
    [x, z + w],
    [x, z],
  ] as const;
const area = (id: string, type = 2, holes = false): LandscapeArea => {
  const rings = holes ? [rect(0, 0, 200), rect(70, 70, 60)] : [rect(0, 0, 200)];
  return {
    id,
    type,
    sourceId: id,
    areaSqm: holes ? 36400 : 40000,
    rings,
    contains: preparePolygonQuery({ type: 'Polygon', coordinates: rings }),
  };
};
const support = {
  metre: 1,
  verticalExaggeration: 5,
  sample: (x: number, z: number) => ({
    kind: 'land',
    native: true,
    y: (x + z) * 0.01,
  }),
  reject: () => undefined,
};
it('places deterministic full footprints through holes, samples all regions, preserves source and uses stable LOD subsets', () => {
  const a = area('park', 2, true),
    before = JSON.stringify(a.rings),
    plan = buildLandscapeLayout('es-test', [a], support);
  expect(plan.instances.length).toBeGreaterThan(30);
  expect(new Set(plan.instances.map((i) => i.family)).size).toBeGreaterThan(1);
  for (const i of plan.instances) {
    expect(footprintInside(footprintRing(i), a.rings, 0.001)).toBe(true);
    expect(i.y).toBeCloseTo(support.sample(i.x, i.z).y + 0.045, 8);
  }
  expect(JSON.stringify(a.rings)).toBe(before);
  expect(plan.instances.some((i) => i.x < 50)).toBe(true);
  expect(plan.instances.some((i) => i.x > 150)).toBe(true);
  expect(buildLandscapeLayout('es-test', [a], support)).toEqual(plan);
  const medium = selectLandscapeLod(plan, 'medium');
  expect(
    medium.instances.every(
      (i) =>
        plan.instances.includes(i) &&
        !['scrub', 'succulent'].includes(i.family),
    ),
  ).toBe(true);
  expect(selectLandscapeLod(plan, 'far').instances).toHaveLength(0);
  expect(medium.triangles).toBeLessThanOrEqual(40000);
});
it('has order-independent mask ownership, bounds work fairly, and separates water/invalid overrides from usable masks', () => {
  const a = area('a'),
    b = { ...area('b'), rings: [rect(300, 0, 200)] };
  b.contains = preparePolygonQuery({ type: 'Polygon', coordinates: b.rings });
  const p = buildLandscapeLayout('es-test', [a, b, area('water', 0)], support);
  expect(p).toEqual(
    buildLandscapeLayout('es-test', [area('water', 0), b, a], support),
  );
  expect(p.diagnostics.find((d) => d.maskId === 'water')!.accepted).toBe(0);
  expect(p.instances.some((i) => i.maskId === 'a')).toBe(true);
  expect(p.instances.some((i) => i.maskId === 'b')).toBe(true);
  const bad = buildLandscapeLayout('es-test', [a, b], support, {
    'es-test': { a: { variantId: 'unknown' } },
  });
  expect(bad.diagnostics.find((d) => d.maskId === 'a')!.error).toContain(
    'landscape',
  );
  expect(bad.instances.some((i) => i.maskId === 'b')).toBe(true);
  const many = Array.from({ length: 300 }, (_, i) => {
    const a = area('m' + i);
    const rings = [rect((i % 20) * 250, Math.floor(i / 20) * 250, 200)];
    return {
      ...a,
      rings,
      contains: preparePolygonQuery({ type: 'Polygon', coordinates: rings }),
    };
  });
  const capped = buildLandscapeLayout('es-test', many, support);
  expect(capped.proposals).toBeLessThanOrEqual(65536);
  expect(capped.instances.length).toBeLessThanOrEqual(8000);
  expect(capped.triangles).toBeLessThanOrEqual(180000);
  expect(new Set(capped.instances.map((i) => i.maskId)).size).toBe(300);
});
it('rejects native water, unsupported/steep ground and explicit full-envelope physical constraints', () => {
  const a = area('a');
  for (const reason of ['road', 'building', 'site', 'transport']) {
    const p = buildLandscapeLayout('es-test', [a], {
      ...support,
      reject: () => reason,
    });
    expect(p.instances).toHaveLength(0);
    expect(p.diagnostics[0]!.rejected[reason]).toBeGreaterThan(0);
  }
  for (const sample of [
    () => ({ kind: 'water', native: true, y: 0 }),
    () => ({ kind: 'land', native: false, y: 0 }),
    (x: number) => ({ kind: 'land', native: true, y: x * 100 }),
  ]) {
    const p = buildLandscapeLayout('es-test', [a], { ...support, sample });
    expect(p.instances).toHaveLength(0);
    expect(
      Object.values(p.diagnostics[0]!.rejected).reduce((a, b) => a + b, 0),
    ).toBe(p.proposals);
  }
});
it('breaks rank-hash ties by stable identity and keeps opposite input order equivalent', () => {
  const first = area('hash-test-dlg-4ljvab'),
    other = area('hash-test-2jxv-tgvz92');
  const rings = [rect(300, 0, 200)];
  const second = {
    ...other,
    rings,
    contains: preparePolygonQuery({ type: 'Polygon', coordinates: rings }),
  };
  expect(buildLandscapeLayout('es-test', [first, second], support)).toEqual(
    buildLandscapeLayout('es-test', [second, first], support),
  );
});
it('enforces instance exhaustion fairly even in very large, easily planted dry areas', () => {
  const big = Array.from({ length: 20 }, (_, i) => {
    const rings = [rect(i * 2500, 0, 2000)];
    return {
      ...area('big-' + i, 4),
      areaSqm: 4e6,
      rings,
      contains: preparePolygonQuery({ type: 'Polygon', coordinates: rings }),
    };
  });
  const overrides = {
    'es-test': Object.fromEntries(
      big.map((a) => [a.id, { variantId: 'dry-xeriscape' }]),
    ),
  };
  const p = buildLandscapeLayout('es-test', big, support, overrides);
  expect(p.gpuInstances).toBe(8000);
  // A two-part crown must not consume a final single GPU slot; a later ground plant may fill it.
  const shifted = buildLandscapeLayout('es-test', big, support, {
    'es-test': Object.fromEntries(
      big.map((a, seed) => [a.id, { variantId: 'dry-xeriscape', seed }]),
    ),
  });
  expect(shifted.gpuInstances).toBe(8000);
  expect(
    shifted.diagnostics.reduce(
      (n, d) => n + (d.rejected['instance-budget'] ?? 0),
      0,
    ),
  ).toBeGreaterThan(0);
  expect(p.instances.length).toBeLessThan(8000);
  const gpuParts = p.instances.reduce(
    (n, i) => n + (['palm', 'olive', 'carob'].includes(i.family) ? 2 : 1),
    0,
  );
  expect(gpuParts).toBeLessThanOrEqual(8000);
  expect(p.triangles).toBeLessThanOrEqual(180000);
  expect(new Set(p.instances.map((i) => i.maskId)).size).toBe(20);
  expect(p.diagnostics.some((d) => d.budgetLimited)).toBe(true);
});
import { citySeed } from './d3d-city-spatial.js';
it('caps ranked display subsets and rejects invalid local limits without letting requests raise ceilings', () => {
  const original = buildLandscapeLayout('es-test', [area('sample')], support),
    template = original.instances[0]!;
  const ids: string[] = [];
  for (let i = 0; ids.length < 4000; i++)
    if (citySeed('eligible-' + i) % 4 === 0) ids.push('eligible-' + i);
  const instances = ids.map((id, i) => ({
    ...template,
    id,
    x: i * 10,
    family: 'palm' as const,
  }));
  const plan = {
    ...original,
    instances,
    triangles: instances.length * 32,
    gpuInstances: instances.length * 2,
  };
  expect(plan.triangles).toBeLessThanOrEqual(180000);
  expect(selectLandscapeLod(plan, 'medium').gpuInstances).toBe(2000);
  expect(
    selectLandscapeLod(plan, 'medium', { instances: 2000, triangles: 1600 })
      .triangles,
  ).toBe(1600);
  expect(
    selectLandscapeLod(plan, 'near', { instances: 4, triangles: 180000 })
      .instances,
  ).toHaveLength(2);
  expect(
    selectLandscapeLod(plan, 'medium', { instances: 100000, triangles: 1e9 })
      .triangles,
  ).toBe(32000);
  for (const limits of [
    { instances: -1, triangles: 1 },
    { instances: NaN, triangles: 1 },
    { instances: 1, triangles: -1 },
    { instances: 1, triangles: 1.5 },
  ])
    expect(() => selectLandscapeLod(plan, 'near', limits)).toThrow(
      'landscape display',
    );
});
it('rejects visually steep amplified slopes and low-plant supports with a visible height step', () => {
  const a = area('dry-support', 4),
    overrides = {
      'es-test': { 'dry-support': { variantId: 'dry-xeriscape' } },
    };
  const moderate = buildLandscapeLayout(
    'es-test',
    [a],
    {
      ...support,
      sample: (x: number) => ({ kind: 'land', native: true, y: x * 0.2 }),
    },
    overrides,
  );
  expect(moderate.instances.length).toBeGreaterThan(0);
  expect(
    moderate.instances.every((i) =>
      ['palm', 'olive', 'carob'].includes(i.family),
    ),
  ).toBe(true);
  expect(moderate.diagnostics[0]!.rejected.slope).toBeGreaterThan(0);
  const steep = buildLandscapeLayout(
    'es-test',
    [a],
    {
      ...support,
      sample: (x: number) => ({ kind: 'land', native: true, y: x * 0.6 }),
    },
    overrides,
  );
  expect(steep.instances).toHaveLength(0);
});
it('bounds triangles when narrow protected planting beds selectively admit small ground vegetation', () => {
  const strips = Array.from({ length: 200 }, (_, i) => {
    const x = i * 10,
      rings = [
        [
          [x, 0],
          [x + 5, 0],
          [x + 5, 1000],
          [x, 1000],
          [x, 0],
        ] as const,
      ];
    return {
      ...area('bed-' + i, 4),
      rings,
      areaSqm: 5000,
      contains: preparePolygonQuery({ type: 'Polygon', coordinates: rings }),
    };
  });
  const overrides = {
    'es-test': Object.fromEntries(
      strips.map((a) => [a.id, { variantId: 'dry-xeriscape' }]),
    ),
  };
  const reject = (r: readonly (readonly [number, number])[]) =>
    Math.abs(
      r.slice(1).reduce((n, p, i) => n + r[i]![0] * p[1] - p[0] * r[i]![1], 0),
    ) /
      2 >
    3.9
      ? 'planting-bed-envelope'
      : undefined;
  const p = buildLandscapeLayout(
    'es-test',
    strips,
    { ...support, reject },
    overrides,
  );
  expect(
    p.instances.every((i) => ['succulent', 'scrub'].includes(i.family)),
  ).toBe(true);
  expect(p.gpuInstances).toBeLessThanOrEqual(8000);
  expect(p.triangles).toBeLessThanOrEqual(180000);
  expect(
    p.diagnostics.reduce((n, d) => n + (d.rejected['triangle-budget'] ?? 0), 0),
  ).toBeGreaterThan(0);
});
