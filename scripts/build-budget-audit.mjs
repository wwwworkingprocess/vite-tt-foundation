import { readFile, readdir, stat } from 'node:fs/promises';
import { readLayerFile } from './public-layer-files.mjs';
const assetBytes = async (path) => readLayerFile(dist, path);
const assetText = async (path) => (await assetBytes(path)).toString('utf8');
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
const canvas2dRepresentation = one(/^Canvas2dRepresentation-[\w-]+\.js$/);
const populationOverlay = one(/^PopulationGridOverlay-[\w-]+\.js$/);
const transportMapProjection = one(/^transport-map-projection-[\w-]+\.js$/);
const dom2dProjectionAdapter = one(/^vehicle-svg-projection-[\w-]+\.js$/);
const passengerMapDiagnostics = one(/^passenger-map-diagnostics-[\w-]+\.js$/);
const routePresentationView = one(/^route-presentation-view-[\w-]+\.js$/);
const routePresentationAcquisition = one(/^use-route-presentation-[\w-]+\.js$/);
// The bundler may merge these boundaries when their lazy consumers coincide.
const routePresentationShared = [
  ...routePresentationView,
  ...routePresentationAcquisition,
];
if (
  routePresentationAcquisition.length !== 1 ||
  routePresentationView.length > 1
)
  throw new Error(
    'Expected deterministic shared route presentation artifacts.',
  );
const openScreen = one(/^OpenScreen-[\w-]+\.js$/);
const gameInspector = one(/^GameInspector-[\w-]+\.js$/);
const persistenceRuntime = one(/^persistence-runtime-[\w-]+\.js$/);
const representation = one(/^D3dMapRepresentation-[\w-]+\.js$/);
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
  canvas2dRepresentation,
  populationOverlay,
  transportMapProjection,
  dom2dProjectionAdapter,
  passengerMapDiagnostics,
  routePresentationAcquisition,
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
const routePresentationBytes = (
  await Promise.all(routePresentationShared.map(size))
).reduce((sum, bytes) => sum + bytes, 0);
const sizes = {
  applicationEntry: await size(entry[0]),
  dialogShell: await size(dialogShell[0]),
  projectInfo: await size(projectInfo[0]),
  simulationControls: await size(simulationControls[0]),
  sessionControls: await size(sessionControls[0]),
  svgRepresentation: await size(svgRepresentation[0]),
  canvas2dRepresentation: await size(canvas2dRepresentation[0]),
  populationOverlay: await size(populationOverlay[0]),
  transportMapProjection: await size(transportMapProjection[0]),
  dom2dProjectionAdapter: await size(dom2dProjectionAdapter[0]),
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
const logicalCompositions = {
  canvasTransportRepresentation:
    sizes.canvas2dRepresentation +
    sizes.transportMapProjection +
    (await size(passengerMapDiagnostics[0])) +
    routePresentationBytes,
  dom2dTransportRepresentation:
    sizes.svgRepresentation +
    sizes.dom2dProjectionAdapter +
    sizes.transportMapProjection +
    (await size(passengerMapDiagnostics[0])) +
    routePresentationBytes,
  populationMap:
    sizes.populationOverlay +
    sizes.dom2dProjectionAdapter +
    sizes.transportMapProjection +
    routePresentationBytes,
};
const reportOnlySharedArchitecture = {
  passengerMapDiagnostics: await size(passengerMapDiagnostics[0]),
  routePresentation: routePresentationBytes,
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
  if (
    !serviceWorkerSource.includes(
      `url:${JSON.stringify(icon.src.slice(base.length))}`,
    )
  )
    throw new Error(
      `Service Worker does not precache install icon: ${icon.src}`,
    );
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
const catalogue = JSON.parse(await assetText(catalogueAsset));
const scenarioAssets = [catalogueAsset];
for (const descriptor of catalogue.scenarios ?? []) {
  const manifestAsset = `scenarios/${descriptor.manifestPath}`;
  const scenarioManifest = JSON.parse(await assetText(manifestAsset));
  scenarioAssets.push(manifestAsset);
  const scenarioDirectory = manifestAsset.slice(
    0,
    manifestAsset.lastIndexOf('/') + 1,
  );
  for (const asset of Object.values(scenarioManifest.assets ?? {}))
    scenarioAssets.push(`${scenarioDirectory}${asset.path}`);
}
for (const path of scenarioAssets) await assetBytes(path);
const populationCatalogueAsset = 'population-fields/catalog.json';
const populationCatalogue = JSON.parse(
  await assetText(populationCatalogueAsset),
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
    const bytes = await assetBytes(asset);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash)
      throw new Error(`Built population asset integrity mismatch: ${asset}.`);
    populationAssets.push(asset);
  }
}
for (const path of populationAssets) await assetBytes(path);
const routeCatalogueAsset = 'route-presentation/catalog.json';
const routeCatalogue = JSON.parse(await assetText(routeCatalogueAsset));
const routeAssets = [routeCatalogueAsset];
for (const entry of routeCatalogue.scenarios) {
  const asset = `route-presentation/${entry.path}`;
  const bytes = await assetBytes(asset);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`Built route presentation integrity mismatch: ${asset}.`);
  routeAssets.push(asset);
}
for (const path of routeAssets) await assetBytes(path);
const roadCatalog = JSON.parse(await assetText('road-network/catalog.json'));
let previousRoadFeatures = new Map();
for (const level of ['A', 'B', 'C']) {
  const product = roadCatalog.products.find((p) => p.level === level);
  const bytes = await assetBytes('road-network/' + product.path);
  if (
    bytes.length !== product.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== product.sha256
  )
    throw new Error('Built road network integrity mismatch: ' + product.path);
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.features.length !== product.featureCount)
    throw new Error('Built road network count mismatch');
  const current = new Map(data.features.map((f) => [f.id, JSON.stringify(f)]));
  for (const [id, feature] of previousRoadFeatures)
    if (current.get(id) !== feature)
      throw new Error('Road cumulative source identity mismatch: ' + id);
  previousRoadFeatures = current;
}
const terrainCatalogAsset = 'terrain/catalog.json';
const terrainCatalog = JSON.parse(await assetText(terrainCatalogAsset));
const terrainAssets = [terrainCatalogAsset];
for (const entry of Object.values(terrainCatalog.settlements)) {
  for (const product of Object.values(entry.products)) {
    const asset = 'terrain/' + product.path;
    const bytes = await assetBytes(asset);
    if (
      bytes.length !== product.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== product.sha256
    )
      throw new Error('Built terrain asset integrity mismatch: ' + asset);
    terrainAssets.push(asset);
  }
}
for (const path of terrainAssets) await assetBytes(path);
for (const layer of [
  'asset-research',
  'icons',
  'population-fields',
  'road-network',
  'route-presentation',
  'scenarios',
  'settlement-metadata',
  'terrain',
  'urban-assets',
]) {
  const archive = layer + '/' + layer + '.zip';
  if (!files.includes(archive))
    throw new Error('Missing built public layer ' + archive);
  const [sourceBytes, builtBytes] = await Promise.all([
    readFile(new URL('../apps/web/public/' + archive, import.meta.url)),
    readFile(new URL(archive, dist)),
  ]);
  if (
    createHash('sha256').update(sourceBytes).digest('hex') !==
    createHash('sha256').update(builtBytes).digest('hex')
  )
    throw new Error('Built layer differs from supplied archive: ' + archive);
  if (serviceWorkerSource.includes('url:' + JSON.stringify(archive)))
    throw new Error('Public layers must load on demand');
  if (
    files.some(
      (path) =>
        path.startsWith(layer + '/') &&
        path !== archive &&
        !(layer === 'icons' && /^icons\/foundation-(192|512)\.png$/.test(path)),
    )
  )
    throw new Error('Uncompressed public data was emitted: ' + layer);
}
if (!serviceWorkerSource.includes('public-layers'))
  throw new Error('Missing on-demand layer offline cache');
console.log(
  `Build and installability audit passed: ${JSON.stringify({ javascript, hardBudgetCoordinates: sizes, budgets: configured, reportOnlySharedArchitecture, reportOnlyLogicalCompositions: logicalCompositions })}.`,
);
