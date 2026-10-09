import { indexZip, readZipEntry } from './zip-layer.js';

export const publicLayerNames = [
  'asset-research',
  'icons',
  'population-fields',
  'route-presentation',
  'scenarios',
  'settlement-metadata',
  'terrain',
  'urban-assets',
] as const;
/** One archive request per used folder; entries inflate only when requested. */
export function createPublicLayerLoader(input: {
  readonly baseUrl: string;
  readonly revisions?: Readonly<Record<string, string>>;
  readonly fetchArchive: (
    url: string,
  ) => Promise<Readonly<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>>;
}) {
  const base = `/${input.baseUrl.replace(/^\/+|\/+$/g, '')}/`.replace(
    '//',
    '/',
  );
  const archives = new Map<string, Promise<ReturnType<typeof indexZip>>>();
  const entries = new Map<string, Promise<Uint8Array>>();
  return Object.freeze({
    async fetchAsset(url: string) {
      if (!url.startsWith(base))
        throw new Error('Public asset URL is outside the application base');
      const relative = url.slice(base.length);
      const slash = relative.indexOf('/');
      const layer = relative.slice(0, slash);
      const path = relative.slice(slash + 1);
      if (
        !publicLayerNames.some((name) => name === layer) ||
        !path ||
        /[?#%]/.test(relative)
      )
        throw new Error('Unknown public asset layer');
      let archive = archives.get(layer);
      if (!archive) {
        archive = (async () => {
          const response = await input.fetchArchive(
            `${base}${layer}/${layer}.zip${input.revisions?.[layer] ? '?v=' + input.revisions[layer] : ''}`,
          );
          if (!response.ok)
            throw new Error(`Public layer unavailable: ${layer}`);
          return indexZip(new Uint8Array(await response.arrayBuffer()));
        })();
        archives.set(layer, archive);
        void archive.catch(() => {
          archives.delete(layer);
        });
      }
      const entry = (await archive).get(path);
      if (!entry || path.endsWith('/'))
        return Object.freeze({
          ok: false,
          text: () => Promise.resolve(''),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      let bytes = entries.get(relative);
      if (!bytes) {
        bytes = readZipEntry(entry);
        entries.set(relative, bytes);
        void bytes.catch(() => {
          entries.delete(relative);
        });
      }
      const data = await bytes;
      return Object.freeze({
        ok: true,
        text: () =>
          Promise.resolve(
            new TextDecoder('utf-8', { fatal: true }).decode(data),
          ),
        arrayBuffer: () => Promise.resolve(Uint8Array.from(data).buffer),
      });
    },
  });
}

let browserLoader: ReturnType<typeof createPublicLayerLoader> | undefined;
export function fetchPublicAsset(url: string) {
  browserLoader ??= createPublicLayerLoader({
    baseUrl: import.meta.env.BASE_URL,
    revisions: import.meta.env.PUBLIC_LAYER_REVISIONS,
    fetchArchive: (path) => fetch(path),
  });
  return browserLoader.fetchAsset(url);
}
