import { describe, expect, it, vi, afterEach } from 'vitest';
import { createPreparationClient } from './preparation-client.js';
import type { PreparationJob } from './preparation-protocol.js';
const make = () => {
  const listeners = new Map<string, EventListener>();
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn((n: string, l: EventListener) =>
      listeners.set(n, l),
    ),
    removeEventListener: vi.fn(),
  };
  return {
    worker,
    send: (data: unknown) =>
      listeners.get('message')!(new MessageEvent('message', { data })),
    event: (name: string) => listeners.get(name)!(new Event(name)),
  };
};
const job: PreparationJob = { kind: 'asset', url: '/x' };
afterEach(() => vi.useRealTimers());
describe('preparation channel failure and resource invariants', () => {
  it.each([
    null,
    { version: 2 },
    { version: 1, id: NaN, ok: true },
    { version: 1, id: 1, ok: 'yes' },
    { version: 1, id: 99, ok: true },
    { version: 1, id: 1, ok: false, error: 2 },
  ])('rejects malformed replies without hanging: %j', async (data) => {
    const f = make(),
      c = createPreparationClient(f.worker, 2);
    f.send({ version: 1, kind: 'hello' });
    const p = c.request('a', job);
    f.send(data);
    await expect(p).rejects.toThrow();
    expect(c.isClosed()).toBe(true);
  });
  it.each(['error', 'messageerror'])(
    'rejects all pending jobs on %s and terminates its own worker',
    async (name) => {
      const f = make(),
        c = createPreparationClient(f.worker, 2);
      const a = c.request('a', job),
        b = c.request('b', job);
      f.event(name);
      await expect(a).rejects.toThrow('crashed');
      await expect(b).rejects.toThrow('crashed');
      expect(c.metrics().pending).toBe(0);
      expect(f.worker.terminate).toHaveBeenCalledOnce();
    },
  );
  it('times out a missing handshake rather than keeping an eternal spinner', async () => {
    vi.useFakeTimers();
    const f = make(),
      c = createPreparationClient(f.worker, 1);
    const p = c.request('a', job);
    vi.advanceTimersByTime(10000);
    await expect(p).rejects.toThrow('handshake timed out');
  });
  it('handles constructor-handshake/send failure and duplicate handshake', async () => {
    const f = make();
    f.worker.postMessage.mockImplementationOnce(() => {
      throw Error('denied');
    });
    const c = createPreparationClient(f.worker, 1);
    await expect(c.request('a', job)).rejects.toThrow('closed');
    const g = make(),
      d = createPreparationClient(g.worker, 1);
    g.send({ version: 1, kind: 'hello' });
    g.worker.postMessage.mockImplementationOnce(() => {
      throw Error('gone');
    });
    await expect(d.request('a', job)).rejects.toThrow('send failed');
    const h = make(),
      e = createPreparationClient(h.worker, 1);
    h.send({ version: 1, kind: 'hello' });
    const p = e.request('a', job);
    h.send({ version: 1, kind: 'hello' });
    await expect(p).rejects.toThrow('Duplicate');
  });
  it('rejects bad successful payloads for retry without poisoning the live channel', async () => {
    const f = make(),
      c = createPreparationClient(f.worker, 1);
    f.send({ version: 1, kind: 'hello' });
    const p = c.request('a', job);
    f.send({
      version: 1,
      id: 1,
      ok: true,
      value: { ok: true, bytes: 'not bytes' },
    });
    await expect(p).rejects.toThrow('payload');
    const q = c.request('a', job);
    f.send({
      version: 1,
      id: 2,
      ok: true,
      value: { ok: true, bytes: new Uint8Array([1]) },
    });
    await expect(q).resolves.toMatchObject({ ok: true });
    expect(c.isClosed()).toBe(false);
    c.close();
  });
  it('evicts bounded successful DTOs and keeps cached immutable records independent of transfer ownership', async () => {
    const f = make(),
      c = createPreparationClient(f.worker, 1, 5);
    f.send({ version: 1, kind: 'hello' });
    const p = c.request('a', job);
    f.send({
      version: 1,
      id: 1,
      ok: true,
      value: { ok: true, bytes: new Uint8Array(8) },
    });
    await p;
    expect(c.metrics().retainedBytes).toBe(0);
    const q = c.request('a', job);
    expect(q).not.toBe(p);
    f.send({
      version: 1,
      id: 2,
      ok: true,
      value: { ok: true, bytes: new Uint8Array(0) },
    });
    await q;
    c.close();
    expect(c.metrics().retained).toBe(0);
  });
});
it('fails a stalled worker job under a named runtime deadline without leaving timers or pending promises', async () => {
  vi.useFakeTimers();
  const f = make(),
    c = createPreparationClient(f.worker, 1, 100, 1000);
  f.send({ version: 1, kind: 'hello' });
  const pending = c.request('a', job);
  vi.advanceTimersByTime(1000);
  await expect(pending).rejects.toThrow('job timed out');
  expect(vi.getTimerCount()).toBe(0);
  expect(c.metrics().pending).toBe(0);
  expect(f.worker.terminate).toHaveBeenCalledOnce();
});

it('bounds job diagnostics and reports pending kinds without mutating retained history', async () => {
  const f = make(),
    c = createPreparationClient(f.worker, 2);
  f.send({ version: 1, kind: 'hello' });
  for (let i = 1; i <= 34; i++) {
    const p = c.request('key-' + i, job);
    expect(c.metrics().active).toEqual(['asset']);
    f.send({
      version: 1,
      id: i,
      ok: true,
      value: { ok: true, bytes: new Uint8Array(1) },
      milliseconds: i,
    });
    await p;
  }
  expect(c.metrics().jobs).toHaveLength(32);
  expect(c.metrics().jobs[0]!.id).toBe(3);
  expect(c.metrics().jobs.at(-1)!.milliseconds).toBe(34);
  c.close();
});
