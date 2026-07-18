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
      ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'].includes(
        extname(entry.name),
      ) &&
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
  const violations = [];
  const declarations = [
    ...text.matchAll(
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:\r?\n\s*)?([^;]+);/gm,
    ),
  ];
  const aliases = new Set(
    declarations
      .filter((match) =>
        /^(?:Dexie|\w*(?:Database|Store|Host|Controller))$/.test(
          match[2].trim(),
        ),
      )
      .map((match) => match[1]),
  );
  for (const match of declarations) {
    const [statement, name, initializer] = match;
    if (
      /\b(?:create\w*(?:Store|Host|Controller|Database)|new\s+(?:Dexie|\w*(?:Database|Store|Host|Controller)))\b/.test(
        initializer,
      )
    )
      violations.push(statement);
    else if (
      /^new\s+Dexie\b/.test(initializer) ||
      [...aliases].some((alias) =>
        new RegExp(`^new\\s+${alias}\\b`).test(initializer),
      ) ||
      (/(?:authoritative|store|host|database|db)/i.test(name) &&
        /^(?:new\s+|create)/.test(initializer))
    )
      violations.push(statement);
  }
  return violations;
}
export function environmentNeutralViolations(text) {
  const violations = [];
  const builtins =
    '(?:node:)?(?:assert|buffer|child_process|crypto|events|fs|http|https|module|os|path|perf_hooks|process|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)(?:\\/[^\'"]*)?';
  if (
    new RegExp(
      `(?:from\\s+|import\\s*\\(|import\\s+|require\\s*\\()\\s*['"]${builtins}['"]`,
    ).test(text)
  )
    violations.push('node-import');
  if (
    /\b(?:process|Buffer|__dirname|__filename|setImmediate|clearImmediate)\b/.test(
      text,
    )
  )
    violations.push('node-global');
  if (/\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\b/.test(text))
    violations.push('timer-api');
  return violations;
}
export function writableStoreViolations(text) {
  const aliases = new Set(['store']);
  for (const match of text.matchAll(
    /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*;/g,
  ))
    if (aliases.has(match[2])) aliases.add(match[1]);
  const storeName = `(?:${[...aliases].join('|')})`;
  const patterns = [
    /projection\s*[:=]\s*store\b/,
    /projection\s*\.\s*setState/,
    /return\s+store(?:\s+as\s+StoreApi[^;]*)?\s*;/,
    /{\s*setState\s*:\s*\w+\.setState\s*}/,
    /Object\.assign\s*\(\s*projection\s*,\s*{[^}]*setState/s,
    /(?:const|let|var)\s+projection\s*=\s*{[^}]*setState\s*:\s*\w+\.setState/s,
    new RegExp(`return\\s+Object\\.freeze\\s*\\(\\s*${storeName}\\s*\\)`),
    new RegExp(`return\\s+{[^}]*\\.\\.\\.\\s*${storeName}[^}]*}`, 's'),
    new RegExp(
      `return\\s+Object\\.assign\\s*\\(\\s*{}\\s*,\\s*${storeName}\\s*\\)`,
    ),
  ];
  return patterns.filter((pattern) => pattern.test(text)).map(String);
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
  if (environmentNeutralViolations(text).length)
    fail(`${file} uses Node-only imports or globals.`);
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
  if (writableStoreViolations(text).length)
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
for (const expected of [
  'route',
  'bus',
  'stop',
  'passenger',
  'platform',
  'fare',
  'depot',
  'schedule',
  'vehicle',
  'routes',
  'stops',
  'buses',
  'passengers',
  'schedules',
  'economics',
])
  if (!transportDomainTerms(forbiddenFixture).includes(expected))
    fail(`domain regression fixture missed ${expected}.`);
if (transportDomainTerms(allowedFixture, 'browser-pacing-driver.ts').length)
  fail('legitimate foundation fixture was rejected.');
if (topLevelSingletons(singletonFixture).length !== 12)
  fail('singleton regression fixture was not fully detected.');
if (environmentNeutralViolations(forbiddenFixture).length !== 3)
  fail('Node-only regression fixtures were not fully detected.');
if (writableStoreViolations(forbiddenFixture).length !== 7)
  fail('writable-store regression fixtures were not fully detected.');
if (
  environmentNeutralViolations(allowedFixture).length ||
  writableStoreViolations(allowedFixture).length ||
  topLevelSingletons(allowedFixture).length
)
  fail('legitimate foundation fixture failed architecture checks.');
console.log(
  `Foundation architecture audit passed (${simulation.length + protocol.length + web.length} production modules, Git-free mode).`,
);
