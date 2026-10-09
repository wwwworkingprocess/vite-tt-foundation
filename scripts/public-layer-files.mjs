import { readFileSync as nativeReadFileSync } from 'node:fs';
import { readdir as nativeReaddir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { indexZip, verifyZipEntry } from '../apps/web/src/assets/zip-layer.ts';

const sourceRoot = resolve(import.meta.dirname, '../apps/web/public');
const cache = new Map();
/** Node acquisition for audits/fixtures; production uses the browser layer adapter. */
export function readFileSync(path, options) {
  const filename =
    path instanceof URL ? fileURLToPath(path) : resolve(String(path));
  const logical = relative(sourceRoot, filename).split(sep).join('/');
  const slash = logical.indexOf('/');
  const layer = logical.slice(0, slash);
  const archivePath = resolve(sourceRoot, layer, `${layer}.zip`);
  if (logical.startsWith('../') || slash < 0 || logical.endsWith('.zip'))
    return nativeReadFileSync(path, options);
  let archive = cache.get(archivePath);
  if (!archive) {
    archive = indexZip(nativeReadFileSync(archivePath));
    cache.set(archivePath, archive);
  }
  const entry = archive.get(logical.slice(slash + 1));
  if (!entry) throw new Error(`Missing public layer entry: ${logical}`);
  const bytes = Buffer.from(
    verifyZipEntry(
      entry,
      entry.method === 0
        ? entry.compressed
        : inflateRawSync(entry.compressed, {
            maxOutputLength: entry.byteLength || 1,
          }),
    ),
  );
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return encoding ? bytes.toString(encoding) : bytes;
}
export async function readFile(path, options) {
  return readFileSync(path, options);
}
export async function readdir(path, options) {
  const filename =
    path instanceof URL ? fileURLToPath(path) : resolve(String(path));
  const logical = relative(sourceRoot, filename).split(sep).join('/');
  if (!logical || logical.startsWith('../'))
    return nativeReaddir(path, options);
  const [layer, ...parts] = logical.split('/');
  const archivePath = resolve(sourceRoot, layer, `${layer}.zip`);
  let archive = cache.get(archivePath);
  if (!archive) {
    archive = indexZip(nativeReadFileSync(archivePath));
    cache.set(archivePath, archive);
  }
  const prefix = parts.length ? parts.join('/') + '/' : '';
  const names = new Map();
  for (const name of archive.keys()) {
    if (!name.startsWith(prefix) || name === prefix) continue;
    const rest = name.slice(prefix.length);
    const slash = rest.indexOf('/');
    names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
  }
  return [...names].map(([name, directory]) =>
    options?.withFileTypes
      ? { name, isFile: () => !directory, isDirectory: () => directory }
      : name,
  );
}
export function readLayerFile(root, path) {
  const slash = path.indexOf('/');
  const layer = path.slice(0, slash);
  const archive = indexZip(
    nativeReadFileSync(new URL(`${layer}/${layer}.zip`, root)),
  );
  const entry = archive.get(path.slice(slash + 1));
  if (!entry) throw new Error(`Missing public layer entry: ${path}`);
  return Buffer.from(
    verifyZipEntry(
      entry,
      entry.method === 0
        ? entry.compressed
        : inflateRawSync(entry.compressed, {
            maxOutputLength: entry.byteLength || 1,
          }),
    ),
  );
}
