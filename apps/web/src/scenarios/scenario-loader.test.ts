import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScenarioLoader } from './scenario-loader.js';

const response = (value: unknown) => ({
  ok: true,
  text: async () => JSON.stringify(value),
});

describe('browser scenario loader', () => {
  it('treats duplicate subscriptions independently and isolates listener failures', async () => {
    const diagnostics = vi.fn();
    const loader = createScenarioLoader({
      baseUrl: '/',
      fetchText: async () =>
        response({ schemaVersion: '1.0.0', catalogId: 'x', scenarios: [] }),
      digestSha256: async () => 'a'.repeat(64),
      onDiagnostic: diagnostics,
    });
    const healthy = vi.fn();
    const removeFirst = loader.projection.subscribe(healthy);
    const removeSecond = loader.projection.subscribe(healthy);
    const removeThrowing = loader.projection.subscribe(() => {
      throw new Error('listener failed');
    });
    removeFirst();
    removeFirst();
    await expect(loader.loadCatalog()).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(loader.projection.getState()).toMatchObject({
      status: 'idle',
      catalog: { catalogId: 'x' },
    });
    expect(diagnostics).toHaveBeenCalled();
    removeSecond();
    removeThrowing();
  });

  it('uses the configured base, verifies hashes, and loads a package', async () => {
    const values = new Map<string, unknown>();
    values.set('/vite-tt-foundation/scenarios/catalog.json', {
      schemaVersion: '1.0.0',
      catalogId: 'x',
      scenarios: [],
    });
    const fetchText = vi.fn(async (url: string) => response(values.get(url)));
    const loader = createScenarioLoader({
      baseUrl: '/vite-tt-foundation/',
      fetchText,
      digestSha256: vi.fn(async () => 'a'.repeat(64)),
    });
    await loader.loadCatalog();
    expect(fetchText).toHaveBeenCalledWith(
      '/vite-tt-foundation/scenarios/catalog.json',
    );
    expect(loader.projection.getState().catalog?.scenarios).toEqual([]);
  });

  it('rejects hash mismatches and stale completions cannot replace a newer selection', async () => {
    const requests: Array<(value: ReturnType<typeof response>) => void> = [];
    const fetchText = vi.fn(
      () =>
        new Promise<ReturnType<typeof response>>((resolve) =>
          requests.push(resolve),
        ),
    );
    const loader = createScenarioLoader({
      baseUrl: '/',
      fetchText,
      digestSha256: async () => '0'.repeat(64),
    });
    const oldLoad = loader.loadCatalog();
    const newLoad = loader.loadCatalog();
    requests[1]!(
      response({ schemaVersion: '1.0.0', catalogId: 'new', scenarios: [] }),
    );
    await newLoad;
    requests[0]!(
      response({ schemaVersion: '1.0.0', catalogId: 'old', scenarios: [] }),
    );
    await oldLoad;
    expect(loader.projection.getState().catalog?.catalogId).toBe('new');
  });

  it('ignores a stale failure after a newer successful catalogue load', async () => {
    const requests: Array<
      (value: { ok: boolean; text: () => Promise<string> }) => void
    > = [];
    const loader = createScenarioLoader({
      baseUrl: '/',
      fetchText: () => new Promise((resolve) => requests.push(resolve)),
      digestSha256: async () => 'a'.repeat(64),
    });
    const stale = loader.loadCatalog();
    const current = loader.loadCatalog();
    requests[1]!(
      response({ schemaVersion: '1.0.0', catalogId: 'current', scenarios: [] }),
    );
    await current;
    requests[0]!({
      ok: true,
      text: async () => {
        throw new Error('stale failed');
      },
    });
    await stale;
    expect(loader.projection.getState().catalog?.catalogId).toBe('current');
    expect(loader.projection.getState().status).toBe('idle');
  });

  it('loads the adopted Torrevieja seed after verifying every declared hash', async () => {
    const publicRoot = join(import.meta.dirname, '..', '..', 'public');
    const fetchText = vi.fn(async (url: string) => {
      const relative = url.replace('/vite-tt-foundation/', '');
      try {
        const text = readFileSync(join(publicRoot, relative), 'utf8');
        return { ok: true, text: async () => text };
      } catch {
        return { ok: false, text: async () => '' };
      }
    });
    const loader = createScenarioLoader({
      baseUrl: '/vite-tt-foundation/',
      fetchText,
      digestSha256: async (text) =>
        createHash('sha256').update(text).digest('hex'),
    });
    await loader.loadCatalog();
    await loader.loadScenario('torrevieja-v1');
    expect(loader.projection.getState()).toMatchObject({
      status: 'ready',
      title: 'Torrevieja',
      settlementCount: 1,
      routeCount: 1,
      graph: { summary: { nodes: 231, edges: 6, routes: 1, patterns: 2 } },
    });
    expect(fetchText).toHaveBeenCalledWith(
      '/vite-tt-foundation/scenarios/torrevieja-v1/stops.json',
    );

    const mismatch = createScenarioLoader({
      baseUrl: '/vite-tt-foundation/',
      fetchText,
      digestSha256: async () => '0'.repeat(64),
    });
    await mismatch.loadCatalog();
    await mismatch.loadScenario('torrevieja-v1');
    expect(mismatch.projection.getState()).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('content-integrity-mismatch'),
    });
  });

  it('reports unknown scenarios and malformed catalogue responses without throwing', async () => {
    const loader = createScenarioLoader({
      baseUrl: '/',
      fetchText: async () => ({ ok: true, text: async () => '{' }),
      digestSha256: async () => 'a'.repeat(64),
    });
    await expect(loader.loadCatalog()).resolves.toBeUndefined();
    expect(loader.projection.getState()).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('malformed-catalogue'),
    });
    await expect(loader.loadScenario('missing')).resolves.toBeUndefined();
    expect(loader.projection.getState().message).toContain('Unknown scenario');
  });
});
