import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { runPreparation } from './browser-preparation.js';
import { usePreparedCity } from './use-prepared-city.js';
vi.mock('./browser-preparation.js', () => ({ runPreparation: vi.fn() }));
afterEach(cleanup);
const input = {
  kind: 'compose',
  identity: 'A',
  sceneIdentity: 'A',
  city: 'es-test',
  scenario: 's',
  scale: 5,
  model: {},
  population: {},
  metadata: undefined,
} as unknown as Parameters<typeof usePreparedCity>[1];
const good = {
  schemaVersion: 1,
  identity: 'A',
  cityId: 'es-test',
  city: { buildingSource: 'street-cells-C', buildings: [] },
  baseYs: new Float64Array(0),
};
it('does no disabled preparation and publishes immutable ready models with exact identity', async () => {
  const inactive = renderHook(() => usePreparedCity('A', undefined));
  expect(inactive.result.current).toBeUndefined();
  inactive.unmount();
  vi.mocked(runPreparation).mockResolvedValueOnce(good);
  const h = renderHook(() => usePreparedCity('A', input));
  await waitFor(() => expect(h.result.current?.status).toBe('ready'));
  if (h.result.current?.status === 'ready') {
    expect(h.result.current.city).toBe(good.city);
    expect(Object.isFrozen(h.result.current.city)).toBe(true);
  }
});
it.each([
  null,
  { ...good, city: null },
  { ...good, schemaVersion: 2 },
  { ...good, identity: 2 },
  { ...good, baseYs: [] },
  { ...good, city: { buildingSource: 'bad', buildings: [] } },
  { ...good, city: { buildingSource: 'street-cells-C', buildings: {} } },
  { ...good, baseYs: new Float64Array(1) },
  { ...good, identity: 'B' },
])('rejects corrupt or obsolete city DTOs: %j', async (value) => {
  vi.mocked(runPreparation).mockResolvedValueOnce(value);
  const h = renderHook(() => usePreparedCity('A', input));
  await waitFor(() => expect(h.result.current?.status).toBe('error'));
});
