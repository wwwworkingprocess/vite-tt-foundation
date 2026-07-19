import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, posix } from 'node:path';

const dist = new URL('../apps/web/dist/', import.meta.url);
const walk = async (directory = '') => {
  const entries = await readdir(new URL(directory, dist), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const relative = posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(`${relative}/`)));
    else files.push(relative);
  }
  return files;
};
const files = (await walk()).sort();
const javascript = files.filter((file) => file.endsWith('.js'));
const one = (pattern) =>
  javascript.filter((file) => pattern.test(basename(file)));
const transportWorker = one(/^transport\.worker-[\w-]+\.js$/);
const entry = one(/^index-[\w-]+\.js$/);
const representation = one(/^foundation-scene-[\w-]+\.js$/);
const register = one(/^registerSW\.js$/);
const serviceWorker = one(/^sw\.js$/);
const workbox = one(/^workbox-[\w-]+\.js$/);
for (const [name, matches] of Object.entries({
  application: entry,
  representation,
  transportWorker,
  registerSW: register,
  serviceWorker,
  workbox,
}))
  if (matches.length !== 1)
    throw new Error(`Expected one deterministic ${name} JavaScript artifact.`);
const configured = JSON.parse(
  await readFile(
    new URL('../torrevieja-project.json', import.meta.url),
    'utf8',
  ),
).buildBudgetsBytes;
const size = async (file) => (await stat(new URL(file, dist))).size;
const sizes = {
  applicationEntry: await size(entry[0]),
  representation: await size(representation[0]),
  transportWorker: await size(transportWorker[0]),
  totalEmittedJavaScript: (await Promise.all(javascript.map(size))).reduce(
    (sum, bytes) => sum + bytes,
    0,
  ),
};
for (const [name, budget] of Object.entries(configured))
  if (sizes[name] > budget)
    throw new Error(
      `Build budget exceeded for ${name}: ${sizes[name]}/${budget}.`,
    );
if (files.some((file) => file.endsWith('.map')))
  throw new Error(
    'Production source maps must not be emitted anywhere in dist.',
  );
const manifest = JSON.parse(
  await readFile(new URL('manifest.webmanifest', dist), 'utf8'),
);
const serviceWorkerSource = await readFile(new URL('sw.js', dist), 'utf8');
const base = manifest.start_url;
if (typeof base !== 'string' || manifest.scope !== base)
  throw new Error('Manifest start_url and scope must use the configured base.');
const requiredIcons = new Map([
  [`${base}icons/foundation-192.png`, [192, 192]],
  [`${base}icons/foundation-512.png`, [512, 512]],
]);
for (const icon of manifest.icons ?? []) {
  if (!requiredIcons.has(icon.src)) continue;
  if (icon.type !== 'image/png' || !icon.purpose?.includes('maskable'))
    throw new Error(`Icon metadata is incomplete: ${icon.src}`);
  const bytes = await readFile(new URL(icon.src.slice(base.length), dist));
  const dimensions = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (dimensions.join('x') !== requiredIcons.get(icon.src).join('x'))
    throw new Error(`Icon dimensions are invalid: ${icon.src}`);
  requiredIcons.delete(icon.src);
}
if (requiredIcons.size)
  throw new Error(
    `Built manifest is missing install icons: ${[...requiredIcons.keys()].join(', ')}`,
  );
for (const scenarioAsset of [
  'scenarios/catalog.json',
  'scenarios/torrevieja-v1/scenario.json',
  'scenarios/torrevieja-v1/settlements.json',
  'scenarios/torrevieja-v1/stops.json',
  'scenarios/torrevieja-v1/routes.json',
  'scenarios/torrevieja-v1/presentation.json',
  'scenarios/torrevieja-v1/provenance.json',
])
  if (!serviceWorkerSource.includes(`url:${JSON.stringify(scenarioAsset)}`))
    throw new Error(`Service Worker does not precache ${scenarioAsset}.`);
console.log(
  `Build and installability audit passed: ${JSON.stringify({ javascript, sizes, budgets: configured })}.`,
);
