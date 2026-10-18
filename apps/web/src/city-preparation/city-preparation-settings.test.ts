import { expect, it } from 'vitest';
import {
  cityPreparationSettings,
  validatePreparationSettings,
} from './city-preparation-settings.js';
it('keeps preparation policy finite, positive and separate from all accepted geography/render caps', () => {
  expect(validatePreparationSettings()).toBe(cityPreparationSettings);
  expect(Object.isFrozen(cityPreparationSettings)).toBe(true);
  expect(cityPreparationSettings.maxQueuedJobs).toBe(8);
  for (const key of [
    'maxWorkersMobile',
    'maxWorkersDesktop',
    'maxQueuedJobs',
    'retainRecentCities',
    'maxPacketBytes',
    'maxRetainedBytes',
  ] as const)
    for (const value of [0, -1, 1.5, NaN, Infinity])
      expect(() =>
        validatePreparationSettings({
          ...cityPreparationSettings,
          [key]: value,
        }),
      ).toThrow('Invalid city preparation setting');
});
