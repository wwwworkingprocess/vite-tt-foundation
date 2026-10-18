import { afterEach, expect, it, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn());
const configure = vi.hoisted(() => vi.fn());
vi.mock('./preparation-engine.js', () => ({
  createPreparationEngine: (input: unknown) => {
    configure(input);
    return { run };
  },
}));
vi.mock('./city-preparation-settings.js', () => ({
  cityPreparationSettings: { maxPacketBytes: 32 },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('handshakes, validates jobs, transfers unique buffers and reports every worker failure', async () => {
  const send = vi.fn();
  vi.stubGlobal('postMessage', send);
  vi.stubGlobal('onmessage', null);
  await import('./city-preparation.worker.js');
  const receive = (data: unknown) => {
    const handler = globalThis.onmessage as (event: MessageEvent) => void;
    handler(new MessageEvent('message', { data }));
  };
  receive(null);
  expect(send).toHaveBeenLastCalledWith(
    { version: 1, kind: 'protocol-error' },
    [],
  );
  receive({ version: 1, kind: 'hello' });
  expect(send).toHaveBeenLastCalledWith({ version: 1, kind: 'hello' }, []);
  for (const data of [
    { version: 1, id: 'bad', job: {} },
    { version: 1, id: 1, job: { kind: 'unknown' } },
    { version: 1, id: 1, job: { kind: 'asset', url: 2 } },
  ])
    receive(data);
  const b = new Float64Array([1]);
  run.mockResolvedValueOnce({ list: [b, null, 3], same: b });
  receive({ version: 1, id: 2, job: { kind: 'asset', url: '/x' } });
  await vi.waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 2, ok: true }),
      [b.buffer],
    ),
  );
  run.mockResolvedValueOnce({ large: new Float64Array(5) });
  receive({ version: 1, id: 3, job: { kind: 'asset', url: '/x' } });
  await vi.waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 3,
        ok: false,
        error: expect.stringContaining('byte budget'),
      }),
      [],
    ),
  );
  run.mockRejectedValueOnce(new Error('CRC'));
  receive({ version: 1, id: 4, job: { kind: 'asset', url: '/x' } });
  await vi.waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(
      { version: 1, id: 4, ok: false, error: 'CRC' },
      [],
    ),
  );
  run.mockRejectedValueOnce('offline');
  receive({ version: 1, id: 5, job: { kind: 'asset', url: '/x' } });
  await vi.waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(
      { version: 1, id: 5, ok: false, error: 'offline' },
      [],
    ),
  );
});

it('fetches archive URLs relative to the active origin and preserves subpaths', async () => {
  vi.stubGlobal('postMessage', vi.fn());
  vi.stubGlobal('onmessage', null);
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  await import('./city-preparation.worker.js');
  const input = configure.mock.calls.at(-1)![0] as {
    fetchArchive: (url: string) => Promise<unknown>;
  };
  await expect(
    input.fetchArchive('/game/terrain/terrain.zip?rev=hash'),
  ).resolves.toEqual({ ok: true });
  expect(fetcher.mock.calls[0]![0].href).toBe(
    new URL('/game/terrain/terrain.zip?rev=hash', location.origin).href,
  );
});
