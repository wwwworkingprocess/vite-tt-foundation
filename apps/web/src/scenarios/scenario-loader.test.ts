import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserSha256, createScenarioLoader } from './scenario-loader.js';
import { createScenarioCoordinate } from '@torrevieja-tycoon/simulation';

const response = (value: unknown) => ({
  ok: true,
  text: async () => JSON.stringify(value),
});

describe('browser scenario loader', () => {
  it('clears stale scenario metadata across loading, failure, unknown, and catalogue reload states', async () => {
    const publicRoot = join(import.meta.dirname, '..', '..', 'public');
    let failCatalog = false;
    const fetchText = vi.fn(async (url: string) => {
      if (failCatalog && url.endsWith('catalog.json'))
        return { ok: false, text: async () => '' };
      const relative = url.replace('/scenarios/', 'scenarios/');
      const text = readFileSync(join(publicRoot, relative), 'utf8');
      if (url.endsWith('catalog.json')) {
        const catalog = JSON.parse(text) as {
          scenarios: Array<Record<string, unknown>>;
        };
        catalog.scenarios.push({
          ...catalog.scenarios[0],
          scenarioId: 'scenario-b',
          title: 'B',
        });
        return response(catalog);
      }
      return { ok: true, text: async () => text };
    });
    const loader = createScenarioLoader({
      baseUrl: '/',
      fetchText,
      digestSha256: async (text) =>
        createHash('sha256').update(text).digest('hex'),
    });
    await loader.loadCatalog();
    await loader.loadScenario('torrevieja-legacy-abc-v1');
    expect(loader.projection.getState().graph).toBeDefined();
    const loadingB = loader.loadScenario('scenario-b');
    expect(loader.projection.getState()).toMatchObject({
      status: 'loading-scenario',
      catalog: { catalogId: 'torrevieja-tycoon-scenarios' },
      selectedScenarioId: 'scenario-b',
    });
    expect(loader.projection.getState()).not.toHaveProperty('graph');
    expect(loader.projection.getState()).not.toHaveProperty('title');
    expect(loader.projection.getState()).not.toHaveProperty('settlementCount');
    expect(loader.projection.getState()).not.toHaveProperty('routeCount');
    expect(loader.projection.getState()).not.toHaveProperty('message');
    await loadingB;
    expect(loader.projection.getState()).toMatchObject({
      status: 'failed',
      selectedScenarioId: 'scenario-b',
    });
    expect(loader.projection.getState()).not.toHaveProperty('graph');
    await loader.loadScenario('unknown');
    expect(loader.projection.getState()).not.toHaveProperty('title');
    const reload = loader.loadCatalog();
    expect(loader.projection.getState()).toEqual({
      status: 'loading-catalogue',
    });
    await reload;
    await loader.loadScenario('torrevieja-legacy-abc-v1');
    failCatalog = true;
    await loader.loadCatalog();
    expect(loader.projection.getState()).toMatchObject({ status: 'failed' });
    expect(loader.projection.getState()).not.toHaveProperty('graph');
  });

  it.each(['success', 'failure'] as const)(
    'keeps the catalogue available for a newer selection and ignores late stale %s',
    async (lateOutcome) => {
      const publicRoot = join(import.meta.dirname, '..', '..', 'public');
      const sourceCatalog = JSON.parse(
        readFileSync(join(publicRoot, 'scenarios', 'catalog.json'), 'utf8'),
      ) as { scenarios: Array<Record<string, unknown>> };
      const sourceManifest = JSON.parse(
        readFileSync(
          join(
            publicRoot,
            'scenarios',
            'torrevieja-v1',
            'torrevieja-mini-v1',
            'scenario.json',
          ),
          'utf8',
        ),
      ) as Record<string, unknown>;
      const descriptor = {
        ...sourceCatalog.scenarios[0]!,
        scenarioVersion: sourceManifest.scenarioVersion,
        status: sourceManifest.status,
        title: sourceManifest.title,
        primarySettlementId: sourceManifest.primarySettlementId,
        settlementIds: sourceManifest.settlementIds,
        contentHash: sourceManifest.contentHash,
      };
      const assets = Object.fromEntries(
        Object.entries(sourceManifest.assets as Record<string, object>).map(
          ([name, asset]) => [name, { ...asset, sha256: 'a'.repeat(64) }],
        ),
      );
      const manifest = (scenarioId: string) => ({
        ...sourceManifest,
        scenarioId,
        title: scenarioId,
        assets,
      });
      const catalog = {
        ...sourceCatalog,
        scenarios: ['scenario-a', 'scenario-b'].map((scenarioId) => ({
          ...descriptor,
          scenarioId,
          title: scenarioId,
          manifestPath: `${scenarioId}/scenario.json`,
        })),
      };
      const pending = new Map<
        string,
        (value: { ok: boolean; text: () => Promise<string> }) => void
      >();
      const fetchText = vi.fn((url: string) => {
        if (url.endsWith('catalog.json'))
          return Promise.resolve(response(catalog));
        const scenarioMatch =
          /scenarios\/(scenario-[ab])\/scenario\.json$/.exec(url);
        if (scenarioMatch)
          return new Promise<ReturnType<typeof response>>((resolve) =>
            pending.set(scenarioMatch[1]!, resolve),
          );
        const filename = url.slice(url.lastIndexOf('/') + 1);
        const scenarioId = /scenarios\/(scenario-[ab])\//.exec(url)?.[1];
        try {
          const value = JSON.parse(
            readFileSync(
              join(
                publicRoot,
                'scenarios',
                'torrevieja-v1',
                'torrevieja-mini-v1',
                filename,
              ),
              'utf8',
            ),
          ) as Record<string, unknown>;
          return Promise.resolve(
            response(scenarioId ? { ...value, scenarioId } : value),
          );
        } catch {
          return Promise.resolve({ ok: false, text: async () => '' });
        }
      });
      const loader = createScenarioLoader({
        baseUrl: '/',
        fetchText,
        digestSha256: async () => 'a'.repeat(64),
      });
      await loader.loadCatalog();
      const loadA = loader.loadScenario('scenario-a');
      expect(loader.projection.getState()).toMatchObject({
        status: 'loading-scenario',
        catalog: {
          scenarios: expect.arrayContaining([
            expect.objectContaining({ scenarioId: 'scenario-b' }),
          ]),
        },
        selectedScenarioId: 'scenario-a',
      });

      const loadB = loader.loadScenario('scenario-b');
      expect(loader.projection.getState()).toMatchObject({
        status: 'loading-scenario',
        selectedScenarioId: 'scenario-b',
      });
      expect(loader.projection.getState().message).toBeUndefined();
      pending.get('scenario-b')!(response(manifest('scenario-b')));
      await loadB;
      expect(loader.projection.getState()).toMatchObject({
        status: 'ready',
        selectedScenarioId: 'scenario-b',
        title: 'scenario-b',
      });

      pending.get('scenario-a')!(
        lateOutcome === 'success'
          ? response(manifest('scenario-a'))
          : { ok: false, text: async () => '' },
      );
      await loadA;
      expect(loader.projection.getState()).toMatchObject({
        status: 'ready',
        selectedScenarioId: 'scenario-b',
        title: 'scenario-b',
      });
    },
  );
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
    await expect(
      loader.resolveCatalogScenario('torrevieja-legacy-abc-v1'),
    ).resolves.toMatchObject({
      manifest: { scenarioId: 'torrevieja-legacy-abc-v1' },
    });
    await expect(loader.resolveCatalogScenario('missing')).rejects.toThrow(
      'Unknown scenario missing',
    );
    await loader.loadScenario('torrevieja-legacy-all-v1');
    expect(loader.projection.getState()).toMatchObject({
      status: 'ready',
      title: 'Torrevieja Legacy Network - All Old Lines',
      settlementCount: 1,
      routeCount: 8,
      graph: { summary: { nodes: 161, edges: 244, routes: 8, patterns: 16 } },
    });
    expect(fetchText).toHaveBeenCalledWith(
      '/vite-tt-foundation/scenarios/torrevieja-v1/torrevieja-legacy-all-v1/stops.json',
    );
    const selectedState = loader.projection.getState();
    const resolved = await loader.resolveScenario(
      createScenarioCoordinate(selectedState.scenario!),
    );
    expect(resolved.manifest.scenarioId).toBe('torrevieja-legacy-all-v1');
    expect(loader.projection.getState()).toBe(selectedState);
    loader.adoptResolvedScenario(resolved);
    expect(loader.projection.getState()).toMatchObject({
      status: 'ready',
      selectedScenarioId: 'torrevieja-legacy-all-v1',
      scenario: resolved,
    });
    const unready = createScenarioLoader({
      baseUrl: '/vite-tt-foundation/',
      fetchText,
      digestSha256: async (text) =>
        createHash('sha256').update(text).digest('hex'),
    });
    expect(() => unready.adoptResolvedScenario(resolved)).toThrow(
      'exact saved scenario',
    );
    await expect(
      loader.resolveScenario({
        ...createScenarioCoordinate(resolved),
        contentHash: '0'.repeat(64),
      }),
    ).rejects.toThrow('exact saved scenario');
    await expect(
      loader.resolveScenario({
        ...createScenarioCoordinate(resolved),
        scenarioSchemaVersion: '2.0.0',
      } as never),
    ).rejects.toThrow('exact saved scenario');

    const mismatch = createScenarioLoader({
      baseUrl: '/vite-tt-foundation/',
      fetchText,
      digestSha256: async () => '0'.repeat(64),
    });
    await mismatch.loadCatalog();
    await mismatch.loadScenario('torrevieja-legacy-all-v1');
    expect(mismatch.projection.getState()).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('content-integrity-mismatch'),
    });
  });

  it('classifies malformed scenario-package JSON as a malformed asset', async () => {
    const publicRoot = join(import.meta.dirname, '..', '..', 'public');
    const fetchText = vi.fn(async (url: string) => {
      if (url.endsWith('/scenario.json'))
        return { ok: true, text: async () => '{' };
      const relative = url.replace('/scenarios/', 'scenarios/');
      const text = readFileSync(join(publicRoot, relative), 'utf8');
      return { ok: true, text: async () => text };
    });
    const loader = createScenarioLoader({
      baseUrl: '/',
      fetchText,
      digestSha256: async () => 'a'.repeat(64),
    });

    await loader.loadCatalog();
    await loader.loadScenario('torrevieja-legacy-abc-v1');

    expect(loader.projection.getState()).toMatchObject({
      status: 'failed',
      selectedScenarioId: 'torrevieja-legacy-abc-v1',
      message: expect.stringContaining('malformed-asset'),
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

  it('provides the browser SHA-256 digest port', async () => {
    await expect(browserSha256('a')).resolves.toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    );
  });
});
