import { readFile, readdir, stat } from 'node:fs/promises';
const dist = new URL('../apps/web/dist/', import.meta.url);
const assets = new URL('assets/', dist);
const files = await readdir(assets);
const javascript = files.filter((file) => file.endsWith('.js'));
const one = (prefix) => javascript.filter((file) => file.startsWith(prefix));
const worker = one('foundation.worker-');
const entry = one('index-');
const representation = one('foundation-scene-');
if (worker.length !== 1 || entry.length !== 1 || representation.length !== 1)
  throw new Error(
    'Expected separate hashed application, representation/R3F, and dedicated Worker chunks.',
  );
const configured = JSON.parse(
  await readFile(
    new URL('../foundation-template.json', import.meta.url),
    'utf8',
  ),
).buildBudgetsBytes;
const sizes = {
  applicationEntry: (await stat(new URL(entry[0], assets))).size,
  representation: (await stat(new URL(representation[0], assets))).size,
  worker: (await stat(new URL(worker[0], assets))).size,
  totalJavaScript: 0,
};
sizes.totalJavaScript = (
  await Promise.all(
    javascript.map(async (file) => (await stat(new URL(file, assets))).size),
  )
).reduce((sum, size) => sum + size, 0);
for (const [name, budget] of Object.entries(configured))
  if (sizes[name] > budget)
    throw new Error(
      `Build budget exceeded for ${name}: ${sizes[name]}/${budget}.`,
    );
if (files.some((file) => file.endsWith('.map')))
  throw new Error('Production source maps must not be emitted.');
const manifest = JSON.parse(
  await readFile(new URL('manifest.webmanifest', dist), 'utf8'),
);
const requiredIcons = new Map([
  ['/icons/foundation-192.png', [192, 192]],
  ['/icons/foundation-512.png', [512, 512]],
]);
for (const icon of manifest.icons ?? []) {
  if (!requiredIcons.has(icon.src)) continue;
  if (icon.type !== 'image/png' || !icon.purpose?.includes('maskable'))
    throw new Error(`Icon metadata is incomplete: ${icon.src}`);
  const bytes = await readFile(new URL(`.${icon.src}`, dist));
  const dimensions = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (dimensions.join('x') !== requiredIcons.get(icon.src).join('x'))
    throw new Error(`Icon dimensions are invalid: ${icon.src}`);
  requiredIcons.delete(icon.src);
}
if (requiredIcons.size)
  throw new Error(
    `Built manifest is missing install icons: ${[...requiredIcons.keys()].join(', ')}`,
  );
console.log(
  `Build and installability audit passed: ${JSON.stringify({ sizes, budgets: configured })}.`,
);
