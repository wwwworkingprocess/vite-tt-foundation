/** Rebuild-time policy; no UI, persistence or simulation authority. */
export interface CityPreparationSettings {
  readonly enabled: boolean;
  readonly maxWorkersMobile: number;
  readonly maxWorkersDesktop: number;
  readonly maxQueuedJobs: number;
  readonly retainRecentCities: number;
  readonly maxPacketBytes: number;
  readonly maxJobMilliseconds: number;
  readonly maxRetainedBytes: number;
}
export const cityPreparationSettings: CityPreparationSettings = Object.freeze({
  enabled: true,
  maxWorkersMobile: 1,
  maxWorkersDesktop: 1,
  maxQueuedJobs: 8,
  retainRecentCities: 1,
  maxRetainedBytes: 64 * 1024 * 1024,
  maxJobMilliseconds: 60000,
  maxPacketBytes: 128 * 1024 * 1024,
});
export function validatePreparationSettings(
  settings: CityPreparationSettings = cityPreparationSettings,
) {
  for (const key of [
    'maxWorkersMobile',
    'maxWorkersDesktop',
    'maxQueuedJobs',
    'retainRecentCities',
    'maxPacketBytes',
    'maxJobMilliseconds',
    'maxRetainedBytes',
  ] as const)
    if (!Number.isSafeInteger(settings[key]) || settings[key] <= 0)
      throw new Error('Invalid city preparation setting: ' + key);
  return settings;
}
