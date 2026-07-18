import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root = new URL('../', import.meta.url);
const walk = async (directory) => {
  const entries = await readdir(new URL(directory, root), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const name = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(name)));
    else if (
      ['.ts', '.tsx'].includes(extname(entry.name)) &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('test-double')
    )
      files.push(name);
  }
  return files;
};
const fail = (message) => {
  throw new Error(`Foundation architecture audit failed: ${message}`);
};
const source = async (file) => readFile(new URL(file, root), 'utf8');
export function transportDomainTerms(text, file = '') {
  const normalized = file.endsWith('browser-pacing-driver.ts')
    ? text.replace(/\bschedule\b|\bstop\s*\([^)]*\)|\w+\.stop\s*\(/g, '')
    : text;
  const tokens = normalized
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const forbidden = new Set([
    'route',
    'stop',
    'platform',
    'bus',
    'passenger',
    'fare',
    'depot',
    'timetable',
    'schedule',
    'vehicle',
    'economy',
    'economics',
    'economic',
    'routes',
    'stops',
    'platforms',
    'buses',
    'passengers',
    'fares',
    'depots',
    'timetables',
    'schedules',
    'vehicles',
    'economies',
  ]);
  return [...new Set(tokens.filter((token) => forbidden.has(token)))];
}
export function topLevelSingletons(text) {
  return text
    .split(/\r?\n/)
    .filter((line) =>
      /^(?:const|let|var)\s+\w*(?:authoritative|store|host|database|db)\w*\s*=\s*(?:new\s+|create)/i.test(
        line,
      ),
    );
}
const simulation = await walk('packages/simulation/src');
const protocol = await walk('packages/protocol/src');
const web = await walk('apps/web/src');
for (const file of [...simulation, ...protocol]) {
  const text = await source(file);
  if (
    /from\s+['"](?:react|react-dom|three|zustand|dexie|vite-plugin-pwa|socket\.io|@react-three|@torrevieja-tycoon\/web)/.test(
      text,
    )
  )
    fail(`${file} imports a forbidden adapter.`);
  if (/\b(?:window|document|indexedDB|localStorage)\b/.test(text))
    fail(`${file} uses a browser global.`);
}
for (const file of simulation)
  if (
    /\b(?:Date|performance|setTimeout|setInterval|requestAnimationFrame)\b|Math\.random/.test(
      await source(file),
    )
  )
    fail(`${file} uses nondeterministic time, timers, or randomness.`);
for (const file of web) {
  const text = await source(file);
  if (
    /\b(?:DedicatedWorkerGlobalScope|postMessage|new Worker)\b/.test(text) &&
    !file.includes('simulation-worker')
  )
    fail(`${file} uses Worker globals outside the Worker adapter.`);
  if (
    /projection\s*[:=]\s*store\b|projection\s*\.\s*setState|return\s+store\b/.test(
      text,
    )
  )
    fail(`${file} exposes a writable Zustand store.`);
}
for (const file of [...simulation, ...protocol, ...web]) {
  const text = await source(file);
  const domain = transportDomainTerms(text, file);
  if (domain.length)
    fail(`${file} contains transport-domain terms: ${domain.join(', ')}.`);
  if (topLevelSingletons(text).length)
    fail(
      `${file} creates a top-level authoritative/store/host/database singleton.`,
    );
}
const ignored = await source('.gitignore');
for (const expected of [
  'node_modules/',
  'dist/',
  'coverage/',
  '.vite/',
  'cypress/screenshots/',
  'cypress/videos/',
])
  if (!ignored.includes(expected)) fail(`.gitignore is missing ${expected}`);
const simulationPackage = JSON.parse(
  await source('packages/simulation/package.json'),
);
const protocolPackage = JSON.parse(
  await source('packages/protocol/package.json'),
);
if (
  simulationPackage.dependencies?.['@torrevieja-tycoon/web'] ||
  protocolPackage.dependencies?.['@torrevieja-tycoon/web'] ||
  protocolPackage.dependencies?.['@torrevieja-tycoon/simulation']
)
  fail('package metadata violates dependency direction.');
const forbiddenFixture = await source(
  'scripts/fixtures/architecture/forbidden.txt',
);
const allowedFixture = await source(
  'scripts/fixtures/architecture/allowed.txt',
);
const singletonFixture = await source(
  'scripts/fixtures/architecture/singletons.txt',
);
if (transportDomainTerms(forbiddenFixture).length !== 9)
  fail('domain regression fixture was not fully detected.');
if (transportDomainTerms(allowedFixture, 'browser-pacing-driver.ts').length)
  fail('legitimate foundation fixture was rejected.');
if (topLevelSingletons(singletonFixture).length !== 3)
  fail('singleton regression fixture was not fully detected.');
console.log(
  `Foundation architecture audit passed (${simulation.length + protocol.length + web.length} production modules, Git-free mode).`,
);
