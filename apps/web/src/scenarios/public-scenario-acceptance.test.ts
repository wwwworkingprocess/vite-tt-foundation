import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createScenarioLoader } from './scenario-loader.js';

const publicRoot = join(import.meta.dirname, '..', '..', 'public');

describe('public multi-scenario catalogue', () => {
  it.each(['/', '/vite-tt-foundation/'])(
    'loads and verifies both packages under base %s',
    async (baseUrl) => {
      const loader = createScenarioLoader({
        baseUrl,
        fetchText: async (url) => {
          const relative = url.slice(baseUrl.length);
          try {
            const text = await readFile(join(publicRoot, relative), 'utf8');
            return { ok: true, text: async () => text };
          } catch {
            return { ok: false, text: async () => '' };
          }
        },
        digestSha256: async (text) =>
          createHash('sha256').update(text).digest('hex'),
      });
      await loader.loadCatalog();
      expect(
        loader.projection
          .getState()
          .catalog?.scenarios.map((item) => item.scenarioId),
      ).toEqual(['torrevieja-v1', 'torrevieja-mini-v1']);
      await loader.loadScenario('torrevieja-v1');
      expect(loader.projection.getState()).toMatchObject({
        status: 'ready',
        selectedScenarioId: 'torrevieja-v1',
        graph: { summary: { nodes: 231 } },
      });
      await loader.loadScenario('torrevieja-mini-v1');
      expect(loader.projection.getState()).toMatchObject({
        status: 'ready',
        selectedScenarioId: 'torrevieja-mini-v1',
        graph: { summary: { nodes: 7 } },
      });
    },
  );

  it('accepts absent optional assets and normalizes non-Error catalogue failure', async () => {
    const baseUrl = '/';
    const create = (failCatalogue: boolean) =>
      createScenarioLoader({
        baseUrl,
        fetchText: async (url) => {
          if (failCatalogue) throw 'catalogue failed';
          if (
            url.endsWith('/presentation.json') ||
            url.endsWith('/provenance.json')
          )
            return { ok: false, text: async () => '' };
          const text = await readFile(join(publicRoot, url.slice(1)), 'utf8');
          return { ok: true, text: async () => text };
        },
        digestSha256: async (text) =>
          createHash('sha256').update(text).digest('hex'),
      });
    const optional = create(false);
    await optional.loadCatalog();
    await optional.loadScenario('torrevieja-mini-v1');
    expect(optional.projection.getState()).toMatchObject({ status: 'ready' });
    const failing = create(true);
    await failing.loadCatalog();
    expect(failing.projection.getState()).toEqual({
      status: 'failed',
      message: 'Scenario loading failed.',
    });
  });
});
