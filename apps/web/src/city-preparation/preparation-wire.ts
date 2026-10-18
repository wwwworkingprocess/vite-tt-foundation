import { record, type PreparationJob } from './preparation-protocol.js';
import { unpackNativeTerrain } from './native-terrain-dto.js';
const fail = (): never => {
  throw Error('Invalid city preparation payload');
};
/** Small wire envelope checks. Source geometry is validated by the existing worker loaders. */
export function decodePreparationJob(value: unknown): PreparationJob {
  if (!record(value)) return fail();
  if (value.kind === 'asset') {
    if (typeof value.url !== 'string' || !value.url.startsWith('/'))
      return fail();
    return value as unknown as PreparationJob;
  }
  if (typeof value.city !== 'string' || !value.city.trim()) return fail();
  if (value.kind === 'cells' || value.kind === 'roads') {
    if (!['A', 'B', 'C'].includes(String(value.level))) return fail();
    return value as unknown as PreparationJob;
  }
  if (typeof value.scenario !== 'string' || !value.scenario) return fail();
  if (value.kind === 'terrain') return value as unknown as PreparationJob;
  if (
    value.kind !== 'compose' ||
    typeof value.identity !== 'string' ||
    typeof value.sceneIdentity !== 'string' ||
    !record(value.model) ||
    !record(value.population) ||
    !Number.isFinite(value.scale) ||
    Number(value.scale) <= 0
  )
    return fail();
  return value as unknown as PreparationJob;
}
export function validatePreparationResult(
  job: PreparationJob,
  value: unknown,
): void {
  if (job.kind === 'asset') {
    if (
      !record(value) ||
      typeof value.ok !== 'boolean' ||
      !ArrayBuffer.isView(value.bytes) ||
      Object.prototype.toString.call(value.bytes) !== '[object Uint8Array]'
    )
      fail();
    return;
  }
  if (job.kind === 'terrain') {
    if (!record(value)) return fail();
    if (value.status === 'unavailable') return;
    if (value.status !== 'ready') return fail();
    const t = unpackNativeTerrain(value.terrain);
    if (!t.identity.startsWith(job.city + ':')) fail();
    return;
  }
  if (job.kind === 'cells' || job.kind === 'roads') {
    if (value === undefined) return;
    if (
      !record(value) ||
      value.settlementId !== job.city ||
      value.level !== job.level ||
      typeof value.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.sha256) ||
      !Array.isArray(value.features)
    )
      fail();
    return;
  }
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.identity !== job.identity ||
    value.cityId !== job.city ||
    !record(value.city) ||
    value.city.buildingSource !== 'street-cells-C' ||
    !Array.isArray(value.city.buildings) ||
    !(value.baseYs instanceof Float64Array) ||
    value.baseYs.length !== value.city.buildings.length ||
    !value.baseYs.every(Number.isFinite)
  )
    fail();
}
