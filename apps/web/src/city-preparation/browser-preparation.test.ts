import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  create: vi.fn(),
  run: vi.fn(),
  engine: vi.fn(),
  enabled: true,
  closed: false,
}));
vi.mock('./preparation-client.js', () => ({
  createPreparationClient: f.create,
}));
vi.mock('./preparation-engine.js', () => ({
  createPreparationEngine: f.engine,
}));
vi.mock('./city-preparation-settings.js', () => ({
  cityPreparationSettings: {
    get enabled() {
      return f.enabled;
    },
    maxQueuedJobs: 8,
    maxRetainedBytes: 100,
    maxJobMilliseconds: 1000,
  },
  validatePreparationSettings: vi.fn(),
}));
beforeEach(() => {
  vi.resetModules();
  f.enabled = true;
  f.closed = false;
  f.run.mockReset().mockResolvedValue({ ok: true });
  f.create.mockReset().mockImplementation(() => ({
    request: f.run,
    isClosed: () => f.closed,
    metrics: () => ({ pending: 0 }),
  }));
  f.engine.mockReset().mockReturnValue({ run: f.run });
});
afterEach(() => vi.unstubAllGlobals());
it('creates one isolated visual worker, reuses it, reports metrics and recreates a crashed channel', async () => {
  const ctor = vi.fn(function () {
    return {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
    };
  });
  vi.stubGlobal('Worker', ctor);
  const m = await import('./browser-preparation.js');
  expect(m.preparationExecution()).toBe('visual-worker');
  await m.runPreparation('a', { kind: 'asset', url: '/x' });
  await m.runPreparation('b', { kind: 'asset', url: '/y' });
  expect(ctor).toHaveBeenCalledTimes(1);
  expect(f.create).toHaveBeenCalledWith(expect.anything(), 8, 100, 1000);
  expect(m.preparationMetrics()).toEqual({ pending: 0 });
  f.closed = true;
  await m.runPreparation('c', { kind: 'asset', url: '/z' });
  expect(ctor).toHaveBeenCalledTimes(2);
});
it.each(['missing', 'denied', 'incomplete', 'disabled'])(
  'diagnoses the %s worker path and yields to a shared legacy engine without claiming off-thread work',
  async (kind) => {
    if (kind === 'missing') vi.stubGlobal('Worker', undefined);
    else if (kind === 'incomplete')
      vi.stubGlobal('Worker', class Incomplete {});
    else
      vi.stubGlobal(
        'Worker',
        vi.fn(function () {
          throw Error('denied');
        }),
      );
    if (kind === 'disabled') f.enabled = false;
    const m = await import('./browser-preparation.js');
    await m.runPreparation('a', { kind: 'asset', url: '/x' });
    await m.runPreparation('b', { kind: 'asset', url: '/y' });
    expect(m.preparationExecution()).toBe('cooperative-fallback');
    expect(f.engine).toHaveBeenCalledTimes(1);
    expect(m.preparationMetrics()).toBeUndefined();
    expect(f.run).toHaveBeenCalledTimes(2);
    const fetcher = f.engine.mock.calls[0]![0].fetchArchive as (
      u: string,
    ) => Promise<unknown>;
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    await fetcher('/x');
    expect(fetch).toHaveBeenCalledWith('/x');
  },
);

it('warms only the visual worker code/handshake, shares it with jobs and recovers denied creation without loading a legacy engine', async () => {
  vi.stubGlobal(
    'Worker',
    vi.fn(function () {
      throw Error('denied');
    }),
  );
  const m = await import('./browser-preparation.js');
  m.warmPreparationWorker();
  expect(m.preparationExecution()).toBe('cooperative-fallback');
  const ctor = vi.fn(function () {
    return {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
    };
  });
  vi.stubGlobal('Worker', ctor);
  m.warmPreparationWorker();
  m.warmPreparationWorker();
  expect(ctor).toHaveBeenCalledTimes(1);
  expect(f.run).not.toHaveBeenCalled();
  expect(f.engine).not.toHaveBeenCalled();
  expect(m.preparationExecution()).toBe('visual-worker');
  await m.runPreparation('a', { kind: 'asset', url: '/x' });
  expect(ctor).toHaveBeenCalledTimes(1);
  expect(f.run).toHaveBeenCalledTimes(1);
});
