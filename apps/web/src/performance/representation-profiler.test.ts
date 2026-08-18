import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginRepresentationProfile,
  clearRepresentationProfiles,
  configureRepresentationProfiling,
  finishRepresentationProfile,
  recordRepresentationProfile,
  representationProfilePrefix,
  representationProfilingEnabled,
  summarizeDurations,
} from './representation-profiler.js';

describe('representation profiler', () => {
  afterEach(() => {
    configureRepresentationProfiling(false);
    clearRepresentationProfiles();
    vi.restoreAllMocks();
  });

  it('has a no-clock, no-entry disabled path', () => {
    const now = vi.spyOn(performance, 'now');
    expect(beginRepresentationProfile('svg.render-to-commit')).toBeUndefined();
    recordRepresentationProfile('svg.commit');
    finishRepresentationProfile(undefined);
    expect(now).not.toHaveBeenCalled();
    expect(
      performance
        .getEntriesByType('mark')
        .filter(({ name }) => name.startsWith(representationProfilePrefix)),
    ).toHaveLength(0);
  });

  it('records namespaced durations and events and clears only its entries', () => {
    configureRepresentationProfiling(true);
    expect(representationProfilingEnabled()).toBe(true);
    const token = beginRepresentationProfile('svg.render-to-commit');
    finishRepresentationProfile(token, { vehicleMarkers: 2 });
    recordRepresentationProfile('svg.commit', { vehicleMarkers: 2 });
    expect(
      performance
        .getEntriesByType('measure')
        .some(
          ({ name }) =>
            name === `${representationProfilePrefix}svg.render-to-commit`,
        ),
    ).toBe(true);
    expect(
      performance
        .getEntriesByType('mark')
        .some(
          ({ name }) => name === `${representationProfilePrefix}svg.commit`,
        ),
    ).toBe(true);
    clearRepresentationProfiles();
    expect(
      performance
        .getEntriesByType('measure')
        .filter(({ name }) => name.startsWith(representationProfilePrefix)),
    ).toHaveLength(0);
  });

  it('summarizes synthetic duration samples deterministically', () => {
    expect(summarizeDurations([7, 1, 5, 3])).toEqual({
      count: 4,
      totalMs: 16,
      minMs: 1,
      medianMs: 4,
      maxMs: 7,
    });
    expect(summarizeDurations([])).toEqual({
      count: 0,
      totalMs: 0,
      minMs: 0,
      medianMs: 0,
      maxMs: 0,
    });
  });
});
