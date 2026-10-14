import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync as nativeRead } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { indexZip, verifyZipEntry } from '../assets/zip-layer.js';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { parseMaterializationCatalog } from './city-materialization.js';
const root = join(import.meta.dirname, '../../public/urban-assets/');
const digest = (b: Uint8Array | string) =>
  createHash('sha256').update(b).digest('hex');
it('checks every installed ZIP entry CRC, complete manifest bytes/hashes, sample source hashes and original candidate identities', () => {
  const archive = indexZip(nativeRead(root + 'urban-assets.zip'));
  const entries = new Map(
    [...archive]
      .filter(([name]) => !name.endsWith('/'))
      .map(([name, e]) => [
        name,
        verifyZipEntry(
          e,
          e.method === 0 ? e.compressed : inflateRawSync(e.compressed),
        ),
      ]),
  );
  const manifest = JSON.parse(
    new TextDecoder().decode(entries.get('MANIFEST.json')!),
  ) as { files: { path: string; byteLength: number; sha256: string }[] };
  expect(manifest.files).toHaveLength(entries.size - 1);
  for (const file of manifest.files) {
    const bytes = entries.get(file.path)!;
    expect(bytes.length).toBe(file.byteLength);
    expect(digest(bytes)).toBe(file.sha256);
  }
  const catalog = parseMaterializationCatalog(
    JSON.parse(
      readFileSync(
        root + 'es-torrevieja/materialization/catalog.v0.json',
        'utf8',
      ),
    ),
    'es-torrevieja',
  );
  const sources = catalog.sites.flatMap((s) => s.geometries);
  expect(sources.slice(0, 4).map((s) => [s.sourceFeatureId, s.sha256])).toEqual(
    [
      [
        'R14660913',
        'b9bcd8bbd057d7d8ba41a6ac2ff3020e2ee08be444b3c4d81208469f12ca4568',
      ],
      [
        'W151884902',
        '9b4116dea0c5bcb70c5a7a5035beafefe39fcdd0dfc77949e9643e3427f49aa4',
      ],
      [
        'W1092710852',
        '6dae9ba7b12967f2b3ff0f088c5cda00314f0f5beca114e9c6454bc37574fd87',
      ],
      [
        'W480233467',
        '437bb8a53a22fa4e9e128f48d1bf2c86fe9d1728ac95a9f98fe87654fd0ede57',
      ],
    ],
  );
  const preserved = {
    'catalog.json':
      '816722f72aced5737f567a14c3e833e171ba5e8d230cd3e2be986dcbf67b7ca4',
    'es-torrevieja/buildings/catalog.json':
      '5abd58467117295c07a8a716dea7ba8d89a63ed316f1cfb154173c6147dcd56a',
    'es-torrevieja/pois/catalog.json':
      '20453d1cd7f884cacae06caa68095692dca6faef4da1503090ba01c9159f2c69',
    'es-torrevieja/landscape/catalog.json':
      'f80fe6e26507b915c8e54211a73468113fc760c62df4e3a8a482a38ee5fa374e',
  };
  for (const [path, sha] of Object.entries(preserved))
    expect(digest(entries.get(path)!)).toBe(sha);
  const candidates = [
    'es-torrevieja/buildings/catalog.json',
    'es-torrevieja/pois/catalog.json',
    'es-torrevieja/landscape/catalog.json',
  ].flatMap(
    (path) =>
      (
        JSON.parse(readFileSync(root + path, 'utf8')) as {
          items: { id: string }[];
        }
      ).items,
  );
  for (const site of catalog.sites)
    if (site.sourceAssetId !== null)
      expect(candidates.some((c) => c.id === site.sourceAssetId)).toBe(true);
});
