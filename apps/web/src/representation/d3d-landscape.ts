import {
  footprintInside,
  footprintRing,
  createFootprintIndex,
  type FootprintPolygon,
} from './d3d-footprint.js';
import { citySeed, distanceToCorridor } from './d3d-city-spatial.js';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
import {
  landscapePolicy,
  landscapeOverrides,
  resolveLandscapeVariant,
  type LandscapeFamily,
  type LandscapeOverrides,
} from './d3d-landscape-policy.js';
import { landscapePrototypeInfo } from './d3d-landscape-geometry.js';
import type { D3dLodBand } from './d3d-map-model.js';
export type LandscapeArea = Readonly<{
  id: string;
  type: number;
  sourceId: string;
  areaSqm: number;
  rings: FootprintPolygon;
  contains: (p: readonly [number, number]) => boolean;
}>;
export type LandscapeInstance = Readonly<{
  id: string;
  maskId: string;
  family: LandscapeFamily;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  colorVariant: number;
}>;
export type LandscapeSupport = Readonly<{
  metre: number;
  sample: (
    x: number,
    z: number,
  ) => Readonly<{ kind: string; native: boolean; y: number }>;
  reject: (ring: FootprintPolygon[number]) => string | undefined;
}>;
export type LandscapeDiagnostic = {
  maskId: string;
  type: number;
  variantId: string;
  seed: number;
  proposed: number;
  accepted: number;
  rejected: Record<string, number>;
  error?: string;
  budgetLimited: boolean;
};
const radical = (index: number, base: number) => {
  let result = 0,
    f = 1;
  while (index > 0) {
    f /= base;
    result += f * (index % base);
    index = Math.floor(index / base);
  }
  return result;
};
/** Pure bounded round-robin sampling. C/mask/source geometry and physical building records are never changed. */
export function buildLandscapeLayout(
  cityId: string,
  areas: readonly LandscapeArea[],
  support: LandscapeSupport,
  overrides: LandscapeOverrides = landscapeOverrides,
) {
  const instances: LandscapeInstance[] = [],
    diagnostics: LandscapeDiagnostic[] = [];
  const states = [...areas]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((area) => {
      const d: LandscapeDiagnostic = {
        maskId: area.id,
        type: area.type,
        variantId: 'none',
        seed: 0,
        proposed: 0,
        accepted: 0,
        rejected: {},
        budgetLimited: false,
      };
      diagnostics.push(d);
      try {
        const variant = resolveLandscapeVariant(
          cityId,
          area.id,
          area.type,
          overrides,
        );
        if (!variant || area.areaSqm < 16) return [];
        d.variantId = variant.variantId;
        d.seed = variant.seed;
        const outer = area.rings[0]!,
          xs = outer.map((p) => p[0]),
          zs = outer.map((p) => p[1]);
        return [
          {
            area,
            d,
            variant,
            minX: Math.min(...xs),
            minZ: Math.min(...zs),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...zs) - Math.min(...zs),
            target: Math.min(
              landscapePolicy.proposalsPerMask,
              Math.max(
                1,
                Math.floor(area.areaSqm / variant.profile.spacing ** 2),
              ),
            ),
          },
        ];
      } catch (error) {
        d.error = String(error);
        return [];
      }
    })
    .sort(
      (a, b) =>
        citySeed(cityId + a.area.id) - citySeed(cityId + b.area.id) ||
        a.area.id.localeCompare(b.area.id),
    );
  const collisions = createFootprintIndex(
    16 * support.metre,
    0.15 * support.metre,
  );
  let proposals = 0,
    triangles = 0,
    gpuInstances = 0;
  while (
    states.some(
      (s) =>
        s.d.proposed < landscapePolicy.proposalsPerMask &&
        s.d.accepted < s.target,
    ) &&
    proposals < landscapePolicy.maxProposals &&
    gpuInstances < landscapePolicy.near.instances
  ) {
    for (const s of states) {
      if (
        proposals >= landscapePolicy.maxProposals ||
        gpuInstances >= landscapePolicy.near.instances
      )
        break;
      if (
        s.d.proposed >= landscapePolicy.proposalsPerMask ||
        s.d.accepted >= s.target
      )
        continue;
      const attempt = s.d.proposed++;
      proposals++;
      const reject = (reason: string) => {
        s.d.rejected[reason] = (s.d.rejected[reason] ?? 0) + 1;
      };
      const seed = citySeed(s.area.id + ':' + s.variant.seed + ':' + attempt),
        profile = s.variant.profile;
      const family =
        profile.families[(attempt + s.variant.seed) % profile.families.length]!;
      const info = landscapePrototypeInfo[family],
        scale = 0.8 + (seed % 401) / 1000;
      let u = radical(attempt + 1 + (s.variant.seed % 997), 2),
        v = radical(attempt + 1 + (s.variant.seed % 991), 3);
      if (profile.pattern === 'rows') {
        const cols = Math.max(
            1,
            Math.floor(s.w / (profile.spacing * support.metre)),
          ),
          rows = Math.max(
            1,
            Math.floor(s.h / (profile.spacing * support.metre)),
          );
        u = (Math.floor(u * cols) + 0.5) / cols;
        v = (Math.floor(v * rows) + 0.5) / rows;
      }
      const candidate = {
        id: cityId + ':' + s.area.id + ':' + s.variant.seed + ':' + attempt,
        maskId: s.area.id,
        family,
        x: s.minX + u * s.w,
        z: s.minZ + v * s.h,
        width: info.width * scale * support.metre,
        depth: info.depth * scale * support.metre,
        height:
          info.height * (0.9 + ((seed >>> 12) % 201) / 1000) * support.metre,
        rotation: (seed % 6284) / 1000,
        colorVariant: (seed >>> 20) % 3,
        y: 0,
      };
      const ring = footprintRing(candidate);
      if (!footprintInside(ring, s.area.rings, 0.001 * support.metre)) {
        reject('mask-boundary');
        continue;
      }
      if (profile.pattern === 'edge') {
        const distance = Math.min(
          ...s.area.rings[0]!.slice(1).map((p, i) =>
            distanceToCorridor(candidate, {
              from: { x: p[0], z: p[1] },
              to: { x: s.area.rings[0]![i]![0], z: s.area.rings[0]![i]![1] },
              width: 0,
            }),
          ),
        );
        if (distance > 12 * support.metre) {
          reject('open-interior');
          continue;
        }
      }
      const points = [
        ...ring.slice(0, 4),
        [candidate.x, candidate.z] as const,
        ...ring
          .slice(1)
          .map(
            (p, i) =>
              [(p[0] + ring[i]![0]) / 2, (p[1] + ring[i]![1]) / 2] as const,
          ),
      ];
      const samples = points.map(([x, z]) => support.sample(x, z));
      if (
        samples.some(
          (p) => p.kind !== 'land' || !p.native || !Number.isFinite(p.y),
        )
      ) {
        reject('native-surface');
        continue;
      }
      const ys = samples.map((p) => p.y);
      const relief = Math.max(...ys) - Math.min(...ys);
      // Judge the displayed 5x surface, not just the unexaggerated native grade.
      // Low plants need a nearly level base; tree crowns allow broader support.
      const maximumRelief = ['succulent', 'scrub'].includes(family)
        ? 0.15 * support.metre
        : 0.45 * Math.min(candidate.width, candidate.depth);
      if (relief > maximumRelief) {
        reject('slope');
        continue;
      }
      const blocked = support.reject(ring);
      if (blocked) {
        reject(blocked);
        continue;
      }
      if (gpuInstances + info.parts > landscapePolicy.near.instances) {
        reject('instance-budget');
        continue;
      }
      if (triangles + info.triangles > landscapePolicy.near.triangles) {
        reject('triangle-budget');
        continue;
      }
      if (!collisions.add(candidate.id, ring)) {
        reject('crown-spacing');
        continue;
      }
      candidate.y =
        support.sample(candidate.x, candidate.z).y + 0.045 * support.metre;
      instances.push(candidate);
      triangles += info.triangles;
      gpuInstances += info.parts;
      s.d.accepted++;
    }
  }
  for (const s of states)
    s.d.budgetLimited =
      s.d.accepted < s.target &&
      (s.d.proposed >= landscapePolicy.proposalsPerMask ||
        proposals >= landscapePolicy.maxProposals ||
        gpuInstances >= landscapePolicy.near.instances);
  return freezeSettlement({
    instances,
    diagnostics,
    proposals,
    triangles,
    gpuInstances,
  });
}
export type LandscapeLayout = ReturnType<typeof buildLandscapeLayout>;
/** Medium is a ranked tree-only subset of the frozen near plan, never a second layout. */
export function selectLandscapeLod(
  plan: LandscapeLayout,
  lod: D3dLodBand,
  requested: Readonly<{
    instances: number;
    triangles: number;
  }> = landscapePolicy[lod],
) {
  if (
    !Number.isSafeInteger(requested.instances) ||
    requested.instances < 0 ||
    !Number.isSafeInteger(requested.triangles) ||
    requested.triangles < 0
  )
    throw Error('Invalid landscape display limits');
  // A local tuning request can reduce limits, never raise the fixed policy ceiling.
  const limits = {
    instances: Math.min(requested.instances, landscapePolicy[lod].instances),
    triangles: Math.min(requested.triangles, landscapePolicy[lod].triangles),
  };
  const instances: LandscapeInstance[] = [];
  let triangles = 0,
    gpuInstances = 0;
  if (lod !== 'far')
    for (const item of plan.instances) {
      if (
        lod === 'medium' &&
        (['scrub', 'succulent'].includes(item.family) ||
          citySeed(item.id) % 4 !== 0)
      )
        continue;
      const next = landscapePrototypeInfo[item.family].triangles,
        parts = landscapePrototypeInfo[item.family].parts;
      if (
        gpuInstances + parts > limits.instances ||
        triangles + next > limits.triangles
      )
        continue;
      instances.push(item);
      triangles += next;
      gpuInstances += parts;
    }
  return freezeSettlement({ instances, triangles, gpuInstances });
}
