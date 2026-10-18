import { createPublicLayerLoader } from './public-layer-loader.js';
import {
  runPreparation,
  warmPreparationWorker,
} from '../city-preparation/browser-preparation.js';
import { record } from '../city-preparation/preparation-protocol.js';
export {
  createPublicLayerLoader,
  publicLayerNames,
} from './public-layer-loader.js';

// Session inputs must not queue behind an unpreemptible visual composition.
// Ownership is disjoint: these two small ZIPs stay here; geographic ZIPs stay
// in the visual worker. Both owners use the same storage/CRC implementation.
let sessionInputs: ReturnType<typeof createPublicLayerLoader> | undefined;
export async function fetchPublicAsset(url: string) {
  const base = import.meta.env.BASE_URL;
  if (
    url.startsWith(base + 'scenarios/') ||
    url.startsWith(base + 'population-fields/')
  ) {
    warmPreparationWorker();
    sessionInputs ??= createPublicLayerLoader({
      baseUrl: base,
      revisions: import.meta.env.PUBLIC_LAYER_REVISIONS,
      fetchArchive: (path) => fetch(path),
    });
    return sessionInputs.fetchAsset(url);
  }
  const value = await runPreparation('asset:' + url, { kind: 'asset', url });
  if (
    !record(value) ||
    typeof value.ok !== 'boolean' ||
    !(value.bytes instanceof Uint8Array)
  )
    throw Error('Invalid prepared public asset');
  const bytes = value.bytes;
  return Object.freeze({
    ok: value.ok,
    text: () =>
      Promise.resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    arrayBuffer: () => Promise.resolve(Uint8Array.from(bytes).buffer),
  });
}
