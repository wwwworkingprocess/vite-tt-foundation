import { citySeed } from './d3d-city-spatial.js';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
export type LandscapeFamily =
  'palm' | 'olive' | 'carob' | 'succulent' | 'scrub';
/** Presentation recipes, not sourced amenities or land-use authority. No conifers. */
export const landscapeStyles = freezeSettlement({
  'coastal-palms': {
    types: [2, 3],
    spacing: 12,
    families: ['palm', 'palm', 'scrub'],
    pattern: 'loose',
  },
  'olive-grove': {
    types: [1, 2, 3],
    spacing: 10,
    families: ['olive', 'olive', 'scrub'],
    pattern: 'rows',
  },
  'carob-shade': {
    types: [1, 2, 4, 5],
    spacing: 13,
    families: ['carob', 'carob', 'olive', 'scrub'],
    pattern: 'loose',
  },
  'dry-xeriscape': {
    types: [2, 3, 4],
    spacing: 8,
    families: ['succulent', 'scrub', 'scrub', 'olive'],
    pattern: 'loose',
  },
  'formal-garden': {
    types: [2, 3],
    spacing: 8,
    families: ['olive', 'palm', 'scrub', 'succulent'],
    pattern: 'rows',
  },
  'open-recreation': {
    types: [4, 5],
    spacing: 14,
    families: ['carob', 'olive', 'scrub'],
    pattern: 'edge',
  },
} as const);
export type LandscapeVariantId = keyof typeof landscapeStyles;
export type LandscapeOverrides = Readonly<
  Record<
    string,
    Readonly<Record<string, Readonly<{ variantId?: string; seed?: number }>>>
  >
>;
/** Edit and rebuild. Original mask IDs are URI-encoded source identities, not array indices.
 * These two real parks demonstrate the future producer override seam. No ZIP/schema/UI change. */
export const landscapeOverrides: LandscapeOverrides = freezeSettlement({
  'es-torrevieja': {
    'es-torrevieja-mask-s%3AR14980058-0': {
      variantId: 'coastal-palms',
      seed: 1042,
    },
    'es-torrevieja-mask-s%3AR14606438-0': {
      variantId: 'olive-grove',
      seed: 2042,
    },
  },
});
export const landscapePolicy = freezeSettlement({
  enabled: true,
  version: 'mediterranean-landscape-v1',
  maxProposals: 32_768,
  proposalsPerMask: 512,
  far: { instances: 0, triangles: 0 },
  // Instance caps count actual GPU part slots (a tree has trunk + foliage).
  medium: { instances: 2_000, triangles: 40_000 },
  near: { instances: 8_000, triangles: 180_000 },
  maxBatches: 8,
});
export function resolveLandscapeVariant(
  cityId: string,
  maskId: string,
  type: number,
  overrides: LandscapeOverrides = landscapeOverrides,
) {
  if (!Number.isInteger(type) || type < 0 || type > 5)
    throw Error('Invalid landscape mask type');
  if (type === 0) return undefined;
  const allowed = (Object.keys(landscapeStyles) as LandscapeVariantId[]).filter(
    (id) => (landscapeStyles[id].types as readonly number[]).includes(type),
  );
  const seed = citySeed(cityId + ':' + maskId + ':' + type),
    override = overrides[cityId]?.[maskId];
  const id = override?.variantId ?? allowed[seed % allowed.length]!;
  if (!allowed.some((x) => x === id))
    throw Error('Invalid landscape variant for mask type');
  const chosenSeed = override?.seed ?? seed;
  if (
    !Number.isSafeInteger(chosenSeed) ||
    chosenSeed < 0 ||
    chosenSeed > 0xffffffff
  )
    throw Error('Invalid landscape seed: expected uint32');
  const variantId = id as LandscapeVariantId;
  return Object.freeze({
    variantId,
    seed: chosenSeed,
    profile: landscapeStyles[variantId],
  });
}

/** Rendering eligibility only; passing a flag enables exact off/on regression tests. */
export function landscapeVisible(
  mode: 'normal' | 'mini',
  lod: 'far' | 'medium' | 'near',
  enabled: boolean = landscapePolicy.enabled,
) {
  return enabled && mode === 'normal' && lod !== 'far';
}
