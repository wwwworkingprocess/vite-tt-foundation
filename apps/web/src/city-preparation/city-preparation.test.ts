import { describe, expect, it, vi } from 'vitest';
import { createCityPreparationCoordinator } from './city-preparation-coordinator.js';
import { createPreparationClient } from './preparation-client.js';

describe('city preparation generation ownership', () => {
  it('requires current native, C city and road draws rather than model readiness', () => {
    const c = createCityPreparationCoordinator();
    const notify = vi.fn();
    const unsubscribe = c.subscribe(notify);
    const a = c.begin('scenario#hash:city:revisions:5');
    c.stage(a, 'preparing');
    c.prepared(a, ['terrain', 'city', 'roads']);
    expect(c.snapshot().status).toBe('loading');
    c.draw(a, 'terrain');
    c.draw(a, 'roads');
    expect(c.snapshot().status).toBe('loading');
    c.draw(a, 'city');
    expect(c.snapshot()).toMatchObject({
      status: 'ready',
      stage: 'interactive',
      generation: a,
    });
    const writes = notify.mock.calls.length;
    c.draw(a, 'city');
    expect(notify).toHaveBeenCalledTimes(writes);
    unsubscribe();
  });
  it('ignores A -> B -> A and stale draw/error callbacks and has a real retry generation', () => {
    const c = createCityPreparationCoordinator();
    const a = c.begin('A');
    const b = c.begin('B');
    const a2 = c.begin('A');
    c.prepared(a, []);
    c.fail(b, 'stale');
    c.draw(a, 'city');
    expect(c.snapshot()).toMatchObject({ generation: a2, status: 'loading' });
    c.fail(a2, 'CRC mismatch');
    expect(c.snapshot().error).toBe('CRC mismatch');
    const retry = c.begin('A');
    expect(retry).not.toBe(a2);
    c.prepared(retry, []);
    expect(c.snapshot().status).toBe('loading');
    c.draw(retry, 'fallback');
    expect(c.snapshot().status).toBe('ready');
    c.cancel(retry);
    expect(c.snapshot().status).toBe('cancelled');
    c.prepared(retry, []);
    expect(c.snapshot().status).toBe('cancelled');
  });
});

describe('bounded visual worker client', () => {
  const fake = () => {
    let receive: ((event: MessageEvent) => void) | undefined;
    const worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === 'message')
          receive = listener as (event: MessageEvent) => void;
      }),
      removeEventListener: vi.fn(),
    };
    return {
      worker,
      send: (data: unknown) => receive!(new MessageEvent('message', { data })),
    };
  };
  it('handshakes, correlates and deduplicates successful immutable requests', async () => {
    const f = fake();
    const c = createPreparationClient(f.worker, 2);
    const a = c.request('key', {
      kind: 'asset',
      url: '/game/terrain/catalog.json',
    });
    const b = c.request('key', {
      kind: 'asset',
      url: '/game/terrain/catalog.json',
    });
    expect(a).toBe(b);
    expect(f.worker.postMessage).toHaveBeenCalledTimes(1);
    f.send({ version: 1, kind: 'hello' });
    expect(f.worker.postMessage).toHaveBeenCalledTimes(2);
    f.send({
      version: 1,
      id: 1,
      ok: true,
      value: { ok: true, bytes: new Uint8Array([1]) },
    });
    await expect(a).resolves.toMatchObject({ ok: true });
    expect(
      c.request('key', { kind: 'asset', url: '/game/terrain/catalog.json' }),
    ).toBe(a);
    c.close();
    expect(f.worker.terminate).toHaveBeenCalledOnce();
  });
  it('evicts failed reads for retry and rejects malformed or crashed channels without hanging', async () => {
    const f = fake();
    const c = createPreparationClient(f.worker, 1);
    f.send({ version: 1, kind: 'hello' });
    const p = c.request('key', { kind: 'asset', url: '/x' });
    f.send({ version: 1, id: 1, ok: false, error: 'CRC mismatch' });
    await expect(p).rejects.toThrow('CRC mismatch');
    const retry = c.request('key', { kind: 'asset', url: '/x' });
    expect(retry).not.toBe(p);
    f.send({ version: 9, id: 2, ok: true, value: {} });
    await expect(retry).rejects.toThrow('protocol');
    await expect(
      c.request('closed', { kind: 'asset', url: '/x' }),
    ).rejects.toThrow();
  });
  it('bounds queued jobs and closes every pending promise', async () => {
    const f = fake();
    const c = createPreparationClient(f.worker, 1);
    const p = c.request('one', { kind: 'asset', url: '/x' });
    await expect(
      c.request('two', { kind: 'asset', url: '/y' }),
    ).rejects.toThrow('queue');
    c.close();
    await expect(p).rejects.toThrow('closed');
    c.close();
  });
});
it('invalidates only current draws when the source signature or active mesh changes', () => {
  const c = createCityPreparationCoordinator();
  const g = c.begin('A');
  c.bind(g, 'source-one');
  c.prepared(g, ['city', 'roads']);
  c.draw(g, 'city');
  c.invalidate(g, 'city');
  c.draw(g, 'roads');
  expect(c.snapshot().status).toBe('loading');
  c.bind(g, 'source-two');
  c.bind(g, 'source-two');
  c.bind(g - 1, 'stale');
  c.stage(g, 'acquiring-inputs');
  c.invalidate(g - 1, 'roads');
  expect(c.snapshot().stage).toBe('presenting');
  c.draw(g, 'city');
  expect(c.snapshot().status).toBe('loading');
  c.draw(g, 'roads');
  expect(c.snapshot().status).toBe('ready');
  expect(c.snapshot().signature).toBe('source-two');
});

it('replaces equal-size required draw sets and preserves an unchanged pending set', () => {
  const c = createCityPreparationCoordinator(),
    g = c.begin('set');
  c.prepared(g, ['city']);
  c.prepared(g, ['roads']);
  c.prepared(g, ['roads']);
  expect(c.snapshot().status).toBe('loading');
  c.draw(g, 'city');
  expect(c.snapshot().status).toBe('loading');
  c.draw(g, 'roads');
  expect(c.snapshot().status).toBe('ready');
});

it('ignores duplicate batch draws while another required batch remains pending', () => {
  const c = createCityPreparationCoordinator(),
    g = c.begin('batches');
  c.prepared(g, ['city', 'roads']);
  let changes = 0;
  const off = c.subscribe(() => changes++);
  c.draw(g, 'city');
  c.draw(g, 'city');
  expect(changes).toBe(0);
  c.draw(g, 'roads');
  expect(changes).toBe(1);
  off();
});

it('accepts early real draws without claiming readiness until all prepared batches draw', () => {
  const c = createCityPreparationCoordinator(),
    g = c.begin('early');
  c.draw(g, 'terrain');
  expect(c.snapshot().stage).toBe('acquiring-inputs');
  c.prepared(g, ['terrain', 'city']);
  expect(c.snapshot().status).toBe('loading');
  c.draw(g, 'city');
  expect(c.snapshot().status).toBe('ready');
  c.activate(g - 1);
  c.activate(g);
  c.cancel(g);
  c.activate(g - 1);
  expect(c.snapshot().status).toBe('cancelled');
  c.activate(g);
  expect(c.snapshot().status).toBe('ready');
});

it('does not activate a never-started scope or fabricate preparation', () => {
  const c = createCityPreparationCoordinator();
  c.activate(0);
  expect(c.snapshot().status).toBe('cancelled');
  expect(c.snapshot().generation).toBe(0);
});
