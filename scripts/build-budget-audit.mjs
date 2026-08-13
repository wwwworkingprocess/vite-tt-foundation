import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, posix } from 'node:path';
import { createHash } from 'node:crypto';

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
const foundationWorker = one(/^foundation\.worker-[\w-]+\.js$/);
const workerChunks = javascript.filter((file) =>
  /(?:^|\/)\w[\w.-]*\.worker-[\w-]+\.js$/.test(file),
);
const entry = one(/^index-[\w-]+\.js$/);
const dialogShell = one(/^AccessibleDialog-[\w-]+\.js$/);
const projectInfo = one(/^ProjectInfo-[\w-]+\.js$/);
const simulationControls = one(/^SimulationControls-[\w-]+\.js$/);
const sessionControls = one(/^SessionControls-[\w-]+\.js$/);
const svgRepresentation = one(/^VehicleMovementSvg-[\w-]+\.js$/);
const populationOverlay = one(/^PopulationGridOverlay-[\w-]+\.js$/);
const openScreen = one(/^OpenScreen-[\w-]+\.js$/);
const gameInspector = one(/^GameInspector-[\w-]+\.js$/);
const persistenceRuntime = one(/^persistence-runtime-[\w-]+\.js$/);
const representation = one(/^foundation-scene-[\w-]+\.js$/);
const register = one(/^registerSW\.js$/);
const serviceWorker = one(/^sw\.js$/);
const workbox = one(/^workbox-[\w-]+\.js$/);
for (const [name, matches] of Object.entries({
  application: entry,
  dialogShell,
  projectInfo,
  simulationControls,
  sessionControls,
  svgRepresentation,
  populationOverlay,
  openScreen,
  gameInspector,
  persistenceRuntime,
  representation,
  transportWorker,
  registerSW: register,
  serviceWorker,
  workbox,
}))
  if (matches.length !== 1)
    throw new Error(`Expected one deterministic ${name} JavaScript artifact.`);
if (foundationWorker.length !== 0)
  throw new Error('The project build must not emit a Foundation Worker chunk.');
if (
  workerChunks.length !== transportWorker.length ||
  workerChunks.some((file) => !transportWorker.includes(file))
)
  throw new Error(`Unclassified Worker chunks: ${workerChunks.join(', ')}`);
const configured = JSON.parse(
  await readFile(
    new URL('../torrevieja-project.json', import.meta.url),
    'utf8',
  ),
).buildBudgetsBytes;
const size = async (file) => (await stat(new URL(file, dist))).size;
const sizes = {
  applicationEntry: await size(entry[0]),
  dialogShell: await size(dialogShell[0]),
  projectInfo: await size(projectInfo[0]),
  simulationControls: await size(simulationControls[0]),
  sessionControls: await size(sessionControls[0]),
  svgRepresentation: await size(svgRepresentation[0]),
  populationOverlay: await size(populationOverlay[0]),
  openScreen: await size(openScreen[0]),
  gameInspector: await size(gameInspector[0]),
  persistenceRuntime: await size(persistenceRuntime[0]),
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
const catalogueAsset = 'scenarios/catalog.json';
const catalogue = JSON.parse(
  await readFile(new URL(catalogueAsset, dist), 'utf8'),
);
const scenarioAssets = [catalogueAsset];
for (const descriptor of catalogue.scenarios ?? []) {
  const manifestAsset = `scenarios/${descriptor.manifestPath}`;
  const scenarioManifest = JSON.parse(
    await readFile(new URL(manifestAsset, dist), 'utf8'),
  );
  scenarioAssets.push(manifestAsset);
  const scenarioDirectory = manifestAsset.slice(
    0,
    manifestAsset.lastIndexOf('/') + 1,
  );
  for (const asset of Object.values(scenarioManifest.assets ?? {}))
    scenarioAssets.push(`${scenarioDirectory}${asset.path}`);
}
for (const scenarioAsset of scenarioAssets)
  if (!serviceWorkerSource.includes(`url:${JSON.stringify(scenarioAsset)}`))
    throw new Error(`Service Worker does not precache ${scenarioAsset}.`);
const populationCatalogueAsset = 'population-fields/catalog.json';
const populationCatalogue = JSON.parse(
  await readFile(new URL(populationCatalogueAsset, dist), 'utf8'),
);
const populationAssets = [
  populationCatalogueAsset,
  'population-fields/CHECKSUMS.sha256',
];
for (const city of populationCatalogue.cities ?? []) {
  for (const [path, expectedHash] of [
    [city.gridPath, city.gridSha256],
    [city.cropPath, city.cropSha256],
  ]) {
    const asset = `population-fields/${path}`;
    const bytes = await readFile(new URL(asset, dist));
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash)
      throw new Error(`Built population asset integrity mismatch: ${asset}.`);
    populationAssets.push(asset);
  }
}
for (const asset of populationAssets)
  if (!serviceWorkerSource.includes(`url:${JSON.stringify(asset)}`))
    throw new Error(`Service Worker does not precache ${asset}.`);
console.log(
  `Build and installability audit passed: ${JSON.stringify({ javascript, sizes, budgets: configured })}.`,
);
