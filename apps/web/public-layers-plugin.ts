import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { readLayerFile } from '../../scripts/public-layer-files.mjs';

const layers = [
  'asset-research',
  'icons',
  'population-fields',
  'road-network',
  'route-presentation',
  'scenarios',
  'settlement-metadata',
  'terrain',
  'urban-assets',
];
/** Publish archives only. Install icons are the small browser-bootstrap exception. */
export function publicLayersPlugin(): Plugin {
  const root = new URL('./public/', import.meta.url);
  const archives = new Map(
    layers.map((layer) => [
      layer,
      readFileSync(new URL(`${layer}/${layer}.zip`, root)),
    ]),
  );
  const icons = new Map(
    [192, 512].map((size) => [
      `icons/foundation-${size}.png`,
      readLayerFile(root, `icons/foundation-${size}.png`),
    ]),
  );
  let base = '/';
  return {
    name: 'public-layer-storage',
    config: () => ({
      publicDir: false,
      define: {
        'import.meta.env.PUBLIC_LAYER_REVISIONS': JSON.stringify(
          Object.fromEntries(
            [...archives].map(([layer, bytes]) => [
              layer,
              createHash('sha256').update(bytes).digest('hex'),
            ]),
          ),
        ),
      },
    }),
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]!;
        const relative = pathname.startsWith(base)
          ? pathname.slice(base.length)
          : '';
        const layer = layers.find((name) => relative === `${name}/${name}.zip`);
        const bytes = layer ? archives.get(layer) : icons.get(relative);
        if (!bytes) {
          next();
          return;
        }
        res.setHeader('Content-Type', layer ? 'application/zip' : 'image/png');
        res.end(bytes);
      });
    },
    generateBundle() {
      for (const [layer, bytes] of archives)
        this.emitFile({
          type: 'asset',
          fileName: `${layer}/${layer}.zip`,
          source: bytes,
        });
      for (const [fileName, bytes] of icons)
        this.emitFile({ type: 'asset', fileName, source: bytes });
    },
  };
}
