import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import ts from 'typescript';
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
const parse = (text) =>
  ts.createSourceFile(
    'audit.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const identifierText = (node) =>
  ts.isIdentifier(node) ? node.text : undefined;
const unwrapExpression = (expression) => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  )
    current = current.expression;
  if (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    current.expression.expression.getText() === 'Object' &&
    current.expression.name.text === 'freeze' &&
    current.arguments.length === 1
  )
    return unwrapExpression(current.arguments[0]);
  return current;
};
const importedFactories = (sourceFile) => {
  const storeFactories = new Set(['createStore']);
  const constructors = new Set(['Dexie']);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const clause = statement.importClause;
    if (
      statement.moduleSpecifier.text === 'zustand/vanilla' &&
      clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings)
    )
      for (const element of clause.namedBindings.elements)
        if ((element.propertyName ?? element.name).text === 'createStore')
          storeFactories.add(element.name.text);
    if (statement.moduleSpecifier.text === 'dexie') {
      if (clause?.name) constructors.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const element of clause.namedBindings.elements)
          if ((element.propertyName ?? element.name).text === 'Dexie')
            constructors.add(element.name.text);
    }
  }
  for (const statement of sourceFile.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (
          declaration.initializer &&
          ts.isIdentifier(declaration.initializer) &&
          /(?:Database|Store|Host|Controller)$/.test(
            declaration.initializer.text,
          )
        ) {
          constructors.add(declaration.initializer.text);
          if (ts.isIdentifier(declaration.name))
            constructors.add(declaration.name.text);
        }
  return { storeFactories, constructors };
};
const extendAliases = (sourceFile, names) => {
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const target = identifierText(unwrapExpression(node.initializer));
        if (target && names.has(target) && !names.has(node.name.text)) {
          names.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
};
const creationKind = (expression, factories, constructors) => {
  const value = unwrapExpression(expression);
  if (ts.isCallExpression(value)) {
    const name = identifierText(value.expression);
    if (name && factories.has(name)) return 'store';
    if (name && /^create\w*(?:Store|Host|Controller|Database)$/.test(name))
      return 'authority';
  }
  if (ts.isNewExpression(value)) {
    const name = identifierText(value.expression);
    if (
      name &&
      (constructors.has(name) ||
        /(?:Database|Store|Host|Controller)$/.test(name))
    )
      return 'authority';
  }
  return undefined;
};
export function topLevelSingletons(text) {
  const sourceFile = parse(text);
  const { storeFactories, constructors } = importedFactories(sourceFile);
  extendAliases(sourceFile, storeFactories);
  extendAliases(sourceFile, constructors);
  const violations = [];
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (
          declaration.initializer &&
          creationKind(declaration.initializer, storeFactories, constructors)
        )
          violations.push(declaration.getText(sourceFile));
    if (
      ts.isExportAssignment(statement) &&
      creationKind(statement.expression, storeFactories, constructors)
    )
      violations.push(statement.getText(sourceFile));
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
  const sourceFile = parse(text);
  const { storeFactories } = importedFactories(sourceFile);
  extendAliases(sourceFile, storeFactories);
  const storeValues = new Set();
  const exposedValues = new Set();
  const typeNamesStore = (node) =>
    node?.getText(sourceFile).includes('StoreApi');
  const derivesStore = (expression) => {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value))
      return storeValues.has(value.text) || exposedValues.has(value.text);
    if (ts.isCallExpression(value)) {
      const name = identifierText(value.expression);
      if (name && storeFactories.has(name)) return true;
      if (
        ts.isPropertyAccessExpression(value.expression) &&
        value.expression.expression.getText(sourceFile) === 'Object'
      )
        return value.arguments.some(derivesStore);
    }
    if (ts.isObjectLiteralExpression(value))
      return value.properties.some((property) =>
        ts.isSpreadAssignment(property)
          ? derivesStore(property.expression)
          : ts.isPropertyAssignment(property) &&
            property.name.getText(sourceFile) === 'setState' &&
            (derivesStore(property.initializer) ||
              (ts.isPropertyAccessExpression(property.initializer) &&
                derivesStore(property.initializer.expression))),
      );
    if (ts.isPropertyAccessExpression(value))
      return derivesStore(value.expression) && value.name.text === 'setState';
    return false;
  };
  const declarations = [];
  const collect = (node) => {
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      typeNamesStore(node.type)
    )
      storeValues.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!declaration.initializer) continue;
      const name = declaration.name.text;
      const value = unwrapExpression(declaration.initializer);
      const directStore =
        typeNamesStore(declaration.type) ||
        (ts.isCallExpression(value) &&
          !!identifierText(value.expression) &&
          storeFactories.has(identifierText(value.expression))) ||
        (ts.isIdentifier(value) && storeValues.has(value.text));
      if (directStore && !storeValues.has(name)) {
        storeValues.add(name);
        changed = true;
      } else if (derivesStore(value) && !exposedValues.has(name)) {
        exposedValues.add(name);
        changed = true;
      }
    }
  }
  const violations = [];
  const visit = (node) => {
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      derivesStore(node.expression)
    )
      violations.push(node.getText(sourceFile));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
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
const astForbiddenFixture = await source(
  'scripts/fixtures/architecture/ast-forbidden.txt',
);
const astAllowedFixture = await source(
  'scripts/fixtures/architecture/ast-allowed.txt',
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
if (
  topLevelSingletons(astForbiddenFixture).length !== 4 ||
  writableStoreViolations(astForbiddenFixture).length !== 5
)
  fail('AST ownership regression fixtures were not fully detected.');
if (
  environmentNeutralViolations(allowedFixture).length ||
  writableStoreViolations(allowedFixture).length ||
  topLevelSingletons(allowedFixture).length
)
  fail('legitimate foundation fixture failed architecture checks.');
if (
  topLevelSingletons(astAllowedFixture).length ||
  writableStoreViolations(astAllowedFixture).length
)
  fail('legitimate factory-scoped store fixture failed architecture checks.');
console.log(
  `Foundation architecture audit passed (${simulation.length + protocol.length + web.length} production modules, Git-free mode).`,
);
