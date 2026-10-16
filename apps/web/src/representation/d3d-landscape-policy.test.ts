import { describe, expect, it } from 'vitest';
import {
  landscapeVisible,
  landscapeStyles,
  resolveLandscapeVariant,
} from './d3d-landscape-policy.js';
describe('visual landscape variants', () => {
  it('selects repeatable type-compatible styles independently of collection order and never populates water', () => {
    expect(resolveLandscapeVariant('es-torrevieja', 'lake', 0)).toBeUndefined();
    const ids = Array.from({ length: 100 }, (_, i) => 'stable-mask-' + i);
    const first = ids.map((id) =>
      resolveLandscapeVariant('es-torrevieja', id, 2),
    );
    expect(
      ids
        .toReversed()
        .map((id) => resolveLandscapeVariant('es-torrevieja', id, 2))
        .toReversed(),
    ).toEqual(first);
    expect(new Set(first.map((x) => x!.variantId)).size).toBeGreaterThanOrEqual(
      4,
    );
    for (const t of [1, 2, 3, 4, 5])
      for (const id of ids) {
        const x = resolveLandscapeVariant('es-elche', id, t)!;
        expect(landscapeStyles[x.variantId].types).toContain(t);
        expect(Number.isSafeInteger(x.seed)).toBe(true);
      }
    expect(
      resolveLandscapeVariant('es-alicante', 'stable-mask-1', 2),
    ).not.toEqual(first[1]);
  });
  it('honors per-city original-ID style/seed overrides without changing unrelated masks', () => {
    const overrides = {
      'es-torrevieja': {
        'park-a': { variantId: 'coastal-palms', seed: 42 },
        'park-b': { variantId: 'olive-grove' },
      },
    };
    expect(
      resolveLandscapeVariant('es-torrevieja', 'park-a', 2, overrides),
    ).toMatchObject({ variantId: 'coastal-palms', seed: 42 });
    const base = resolveLandscapeVariant('es-torrevieja', 'park-b', 2)!;
    expect(
      resolveLandscapeVariant('es-torrevieja', 'park-b', 2, overrides),
    ).toMatchObject({ variantId: 'olive-grove', seed: base.seed });
    expect(resolveLandscapeVariant('es-elche', 'park-a', 2, overrides)).toEqual(
      resolveLandscapeVariant('es-elche', 'park-a', 2),
    );
  });
  it('diagnoses invalid types, incompatible styles and non-uint32 seeds instead of inventing a fallback', () => {
    for (const t of [-1, 6, NaN, 1.5])
      expect(() => resolveLandscapeVariant('es-torrevieja', 'm', t)).toThrow(
        'landscape',
      );
    for (const entry of [
      { variantId: 'unknown' },
      { variantId: 'coastal-palms' },
      { seed: -1 },
      { seed: 1.5 },
      { seed: 2 ** 32 },
      { seed: NaN },
    ])
      expect(() =>
        resolveLandscapeVariant('es-torrevieja', 'm', 1, {
          'es-torrevieja': { m: entry },
        }),
      ).toThrow('landscape');
  });
});

it('keeps far, mini and explicitly disabled details inactive without suppressing the underlying masks', () => {
  expect(landscapeVisible('normal', 'near')).toBe(true);
  expect(landscapeVisible('normal', 'medium')).toBe(true);
  expect(landscapeVisible('normal', 'far')).toBe(false);
  expect(landscapeVisible('mini', 'near')).toBe(false);
  expect(landscapeVisible('normal', 'near', false)).toBe(false);
});
