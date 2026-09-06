import { describe, expect, it } from 'vitest';
import {
  assertSupportedRepresentationView,
  defaultRepresentationViewForFamily,
  representationFamilies,
  representationViewsForFamily,
  supportsRepresentationView,
} from './representation-view-capabilities.js';

describe('representation view capabilities', () => {
  it.each([
    ['dom2d', 'map'],
    ['canvas2d', 'map'],
    ['d3d', 'main'],
  ] as const)('%s supports its canonical %s view', (family, view) => {
    expect(representationViewsForFamily(family)).toEqual([view]);
    expect(defaultRepresentationViewForFamily(family)).toBe(view);
    expect(supportsRepresentationView(family, view)).toBe(true);
    expect(() => assertSupportedRepresentationView(family, view)).not.toThrow();
  });

  it.each([
    ['dom2d', 'main'],
    ['canvas2d', 'main'],
    ['d3d', 'map'],
  ] as const)('%s rejects unsupported %s', (family, view) => {
    expect(supportsRepresentationView(family, view)).toBe(false);
    expect(() => assertSupportedRepresentationView(family, view)).toThrow(
      `Representation family ${family} does not support view ${view}.`,
    );
  });

  it('fails closed for unknown runtime values', () => {
    expect(supportsRepresentationView('unknown', 'map')).toBe(false);
    expect(supportsRepresentationView('dom2d', 'unknown')).toBe(false);
  });

  it('owns one immutable default within every immutable supported-view list', () => {
    expect(representationFamilies).toEqual(['dom2d', 'canvas2d', 'd3d']);
    expect(Object.isFrozen(representationFamilies)).toBe(true);
    for (const family of representationFamilies) {
      const views = representationViewsForFamily(family);
      expect(views).toContain(defaultRepresentationViewForFamily(family));
      expect(views).toHaveLength(1);
      expect(Object.isFrozen(views)).toBe(true);
    }
  });
});
