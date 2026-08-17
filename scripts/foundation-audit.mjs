import { readFile, readdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, extname, join } from 'node:path';
import ts from 'typescript';
import { validateScenarioCityDirectory } from './scenario-city-directory.mjs';
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
    'population',
    'populations',
    'demand',
    'demands',
    'catchment',
    'catchments',
    'emission',
    'emissions',
    'itinerary',
    'itineraries',
    'routing',
    'transfer',
    'transfers',
  ]);
  return [...new Set(tokens.filter((token) => forbidden.has(token)))];
}
const itineraryDomainTerms = (text) => {
  const tokens = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const forbidden = new Set([
    'itinerary',
    'itineraries',
    'routing',
    'transfer',
    'transfers',
  ]);
  return [...new Set(tokens.filter((token) => forbidden.has(token)))];
};
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
  const storeNamespaces = new Set();
  const importedStores = new Set();
  const authorityFactories = new Set();
  const constructors = new Set(['Dexie']);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const clause = statement.importClause;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
      for (const element of clause.namedBindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        if (/^create\w*(?:Store|Host|Controller|Database)$/.test(importedName))
          authorityFactories.add(element.name.text);
        if (/(?:^store$|Store$)/.test(importedName))
          importedStores.add(element.name.text);
      }
    if (
      statement.moduleSpecifier.text === 'zustand/vanilla' &&
      clause?.namedBindings
    ) {
      if (ts.isNamedImports(clause.namedBindings))
        for (const element of clause.namedBindings.elements)
          if ((element.propertyName ?? element.name).text === 'createStore')
            storeFactories.add(element.name.text);
      if (ts.isNamespaceImport(clause.namedBindings))
        storeNamespaces.add(clause.namedBindings.name.text);
    }
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
          ts.isIdentifier(declaration.initializer)
        ) {
          if (
            /(?:Database|Store|Host|Controller)$/.test(
              declaration.initializer.text,
            )
          ) {
            constructors.add(declaration.initializer.text);
            if (ts.isIdentifier(declaration.name))
              constructors.add(declaration.name.text);
          }
          if (
            /^create\w*(?:Store|Host|Controller|Database)$/.test(
              declaration.initializer.text,
            )
          )
            authorityFactories.add(declaration.initializer.text);
        }
  const collectAuthorityFactories = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^create\w*(?:Store|Host|Controller|Database)$/.test(node.expression.text)
    )
      authorityFactories.add(node.expression.text);
    ts.forEachChild(node, collectAuthorityFactories);
  };
  collectAuthorityFactories(sourceFile);
  return {
    storeFactories,
    storeNamespaces,
    importedStores,
    authorityFactories,
    constructors,
  };
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
const creationKind = (
  expression,
  factories,
  namespaces,
  authorities,
  constructors,
) => {
  const value = unwrapExpression(expression);
  if (ts.isCallExpression(value)) {
    const name = identifierText(value.expression);
    if (name && factories.has(name)) return 'store';
    if (name && authorities.has(name)) return 'authority';
    if (
      ts.isPropertyAccessExpression(value.expression) &&
      namespaces.has(value.expression.expression.getText()) &&
      value.expression.name.text === 'createStore'
    )
      return 'store';
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
  const { storeFactories, storeNamespaces, authorityFactories, constructors } =
    importedFactories(sourceFile);
  extendAliases(sourceFile, storeFactories);
  extendAliases(sourceFile, authorityFactories);
  extendAliases(sourceFile, constructors);
  const violations = [];
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (
          declaration.initializer &&
          creationKind(
            declaration.initializer,
            storeFactories,
            storeNamespaces,
            authorityFactories,
            constructors,
          )
        )
          violations.push(declaration.getText(sourceFile));
    if (
      ts.isExportAssignment(statement) &&
      creationKind(
        statement.expression,
        storeFactories,
        storeNamespaces,
        authorityFactories,
        constructors,
      )
    )
      violations.push(statement.getText(sourceFile));
  }
  return violations;
}
export function environmentNeutralViolations(text) {
  const violations = [];
  if (nodeBuiltinImports(text).length) violations.push('node-import');
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
export function nodeBuiltinImports(text) {
  const sourceFile = parse(text);
  const builtins = new Set(
    builtinModules.map((name) => name.replace(/^node:/, '')),
  );
  const imports = [];
  const checkSpecifier = (specifier) => {
    if (typeof specifier !== 'string') return;
    const normalized = specifier.replace(/^node:/, '');
    if (
      builtins.has(normalized) ||
      [...builtins].some((name) => normalized.startsWith(`${name}/`))
    )
      imports.push(specifier);
  };
  const visitImports = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkSpecifier(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        identifierText(node.expression) === 'require') &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      checkSpecifier(node.arguments[0].text);
    ts.forEachChild(node, visitImports);
  };
  visitImports(sourceFile);
  return imports;
}
export function writableStoreViolations(text) {
  const sourceFile = parse(text);
  const { storeFactories, storeNamespaces, importedStores } =
    importedFactories(sourceFile);
  extendAliases(sourceFile, storeFactories);
  const storeValues = new Set(importedStores);
  const exposedValues = new Set();
  const typeNamesStore = (node) =>
    node?.getText(sourceFile).includes('StoreApi');
  const propertyName = (name) => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression))
      return name.expression.text;
    return name.getText(sourceFile);
  };
  const derivesStore = (expression) => {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value))
      return storeValues.has(value.text) || exposedValues.has(value.text);
    if (ts.isCallExpression(value)) {
      const name = identifierText(value.expression);
      if (name && storeFactories.has(name)) return true;
      if (
        ts.isPropertyAccessExpression(value.expression) &&
        storeNamespaces.has(value.expression.expression.getText(sourceFile)) &&
        value.expression.name.text === 'createStore'
      )
        return true;
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
          : ts.isShorthandPropertyAssignment(property)
            ? exposedValues.has(property.name.text)
            : ts.isMethodDeclaration(property)
              ? propertyName(property.name) === 'setState' &&
                !!property.body &&
                property.body.statements.some((statement) =>
                  statement.getText(sourceFile).includes('.setState'),
                )
              : ts.isPropertyAssignment(property) &&
                propertyName(property.name) === 'setState' &&
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
          ((!!identifierText(value.expression) &&
            storeFactories.has(identifierText(value.expression))) ||
            (ts.isPropertyAccessExpression(value.expression) &&
              storeNamespaces.has(
                value.expression.expression.getText(sourceFile),
              ) &&
              value.expression.name.text === 'createStore'))) ||
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
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      for (const declaration of node.declarationList.declarations)
        if (declaration.initializer && derivesStore(declaration.initializer))
          violations.push(declaration.getText(sourceFile));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}
const simulation = await walk('packages/simulation/src');
const protocol = await walk('packages/protocol/src');
const transport = await walk('packages/transport-domain/src');
const web = await walk('apps/web/src');
const publicScenarios = await walk('apps/web/public/scenarios');
const scenarioRootEntries = await readdir(
  new URL('apps/web/public/scenarios', root),
  { withFileTypes: true },
);
const scenarioCatalogue = JSON.parse(
  await source('apps/web/public/scenarios/catalog.json'),
);
for (const entry of scenarioRootEntries) {
  if (!entry.isDirectory() && entry.name !== 'catalog.json')
    fail(`unexpected flat scenario-root file ${entry.name}.`);
}
const scenarioIds = new Set();
const cityDirectoryBySettlement = new Map();
const settlementByCityDirectory = new Map();
const referencedCityDirectories = new Set();
for (const descriptor of scenarioCatalogue.scenarios) {
  if (scenarioIds.has(descriptor.scenarioId))
    fail(`duplicate public scenario ${descriptor.scenarioId}.`);
  scenarioIds.add(descriptor.scenarioId);
  const parts = descriptor.manifestPath.split('/');
  if (
    parts.length !== 3 ||
    !/^[a-z_]+-v1$/.test(parts[0]) ||
    parts[1] !== descriptor.scenarioId ||
    parts[2] !== 'scenario.json'
  )
    fail(
      `${descriptor.scenarioId} has invalid grouped manifest path ${descriptor.manifestPath}.`,
    );
  const cityDirectory = parts[0];
  const priorCity = cityDirectoryBySettlement.get(
    descriptor.primarySettlementId,
  );
  if (priorCity && priorCity !== cityDirectory)
    fail(`${descriptor.primarySettlementId} spans scenario city directories.`);
  const priorSettlement = settlementByCityDirectory.get(cityDirectory);
  if (priorSettlement && priorSettlement !== descriptor.primarySettlementId)
    fail(`${cityDirectory} contains multiple primary settlements.`);
  cityDirectoryBySettlement.set(descriptor.primarySettlementId, cityDirectory);
  settlementByCityDirectory.set(cityDirectory, descriptor.primarySettlementId);
  referencedCityDirectories.add(cityDirectory);
  const manifest = JSON.parse(
    await source(`apps/web/public/scenarios/${descriptor.manifestPath}`),
  );
  if (
    manifest.scenarioId !== descriptor.scenarioId ||
    manifest.primarySettlementId !== descriptor.primarySettlementId
  )
    fail(`${descriptor.scenarioId} descriptor and manifest do not agree.`);
  const settlements = JSON.parse(
    await source(
      `apps/web/public/scenarios/${dirname(descriptor.manifestPath)}/settlements.json`,
    ),
  );
  const primarySettlements = settlements.settlements.filter(
    ({ settlementId }) => settlementId === descriptor.primarySettlementId,
  );
  if (primarySettlements.length !== 1)
    fail(
      `${descriptor.scenarioId} must contain exactly one primary settlement ${descriptor.primarySettlementId}.`,
    );
  try {
    validateScenarioCityDirectory({
      scenarioId: descriptor.scenarioId,
      primarySettlementName: primarySettlements[0].name,
      manifestPath: descriptor.manifestPath,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
for (const entry of scenarioRootEntries)
  if (entry.isDirectory() && !referencedCityDirectories.has(entry.name))
    fail(`unexpected flat scenario package directory ${entry.name}.`);
if (scenarioIds.has('torrevieja-mini-v1'))
  fail('torrevieja-mini-v1 must remain outside the public catalogue.');
await source(
  'apps/web/public/scenarios/torrevieja-v1/torrevieja-mini-v1/scenario.json',
);
for (const file of [...simulation, ...protocol, ...transport]) {
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
    !file.includes('simulation-worker') &&
    !file.includes('transport-simulation')
  )
    fail(`${file} uses Worker globals outside the Worker adapter.`);
  if (writableStoreViolations(text).length)
    fail(`${file} exposes a writable Zustand store.`);
}
for (const file of web.filter((path) =>
  path.replaceAll('\\', '/').includes('apps/web/src/transport-representation'),
)) {
  const text = await source(file);
  if (
    /\b(?:Date|performance|setTimeout|setInterval|requestAnimationFrame)\b|Math\.random|from\s+['"](?:three|@react-three)/.test(
      text,
    )
  )
    fail(`${file} gives the SVG representation authority or frame timing.`);
}
for (const file of [...simulation, ...protocol, ...web]) {
  const text = await source(file);
  const normalized = file.replaceAll('\\', '/');
  const transportExtension =
    normalized.includes('apps/web/src/population') ||
    normalized.includes('apps/web/src/scenarios') ||
    normalized.includes('apps/web/src/transport-simulation') ||
    normalized.includes('apps/web/src/transport-representation') ||
    normalized.endsWith('apps/web/src/App.tsx') ||
    normalized.endsWith('apps/web/src/ui/SessionControls.tsx') ||
    normalized.endsWith('apps/web/src/ui/SimulationControls.tsx') ||
    normalized.endsWith('apps/web/src/ui/GameInspector.tsx') ||
    normalized.endsWith('apps/web/src/ui/game-selection.ts') ||
    normalized.endsWith('packages/simulation/src/transport-simulation.ts') ||
    normalized.endsWith('packages/simulation/src/passenger-demand.ts') ||
    normalized.endsWith(
      'packages/simulation/src/passenger-demand-runtime.ts',
    ) ||
    normalized.endsWith(
      'packages/simulation/src/passenger-destination-permutation.ts',
    ) ||
    normalized.endsWith(
      'packages/simulation/src/passenger-direct-itinerary.ts',
    ) ||
    normalized.endsWith(
      'packages/simulation/src/passenger-waiting-cohort.ts',
    ) ||
    normalized.endsWith('packages/simulation/src/passenger-boarding.ts') ||
    normalized.endsWith('packages/simulation/src/passenger-transit.ts') ||
    normalized.endsWith('packages/simulation/src/vehicle-movement.ts') ||
    normalized.endsWith('packages/simulation/src/vehicle-operation.ts') ||
    normalized.endsWith('packages/simulation/src/index.ts');
  const domain = transportExtension ? [] : transportDomainTerms(text, file);
  if (domain.length)
    fail(`${file} contains transport-domain terms: ${domain.join(', ')}.`);
  if (topLevelSingletons(text).length)
    fail(
      `${file} creates a top-level authoritative/store/host/database singleton.`,
    );
}
for (const file of [
  ...simulation.filter(
    (path) =>
      !path
        .replaceAll('\\', '/')
        .endsWith('packages/simulation/src/passenger-demand.ts') &&
      !path
        .replaceAll('\\', '/')
        .endsWith('packages/simulation/src/passenger-demand-runtime.ts') &&
      !path
        .replaceAll('\\', '/')
        .endsWith('packages/simulation/src/passenger-direct-itinerary.ts') &&
      !path
        .replaceAll('\\', '/')
        .endsWith('packages/simulation/src/passenger-waiting-cohort.ts') &&
      !path
        .replaceAll('\\', '/')
        .endsWith('packages/simulation/src/passenger-boarding.ts') &&
      !path
        .replaceAll('\\', '/')
        .endsWith('packages/simulation/src/passenger-transit.ts') &&
      !path
        .replaceAll('\\', '/')
        .endsWith('packages/simulation/src/transport-simulation.ts'),
  ),
  ...protocol,
  ...transport,
  ...web,
  ...publicScenarios,
]) {
  const terms = itineraryDomainTerms(await source(file));
  if (terms.length)
    fail(`${file} contains direct-itinerary terms: ${terms.join(', ')}.`);
}
for (const file of transport) {
  const text = await source(file);
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
const transportPackage = JSON.parse(
  await source('packages/transport-domain/package.json'),
);
if (
  simulationPackage.dependencies?.['@torrevieja-tycoon/web'] ||
  protocolPackage.dependencies?.['@torrevieja-tycoon/web'] ||
  protocolPackage.dependencies?.['@torrevieja-tycoon/simulation'] ||
  protocolPackage.dependencies?.['@torrevieja-tycoon/transport-domain'] ||
  transportPackage.dependencies?.['@torrevieja-tycoon/web'] ||
  transportPackage.dependencies?.['@torrevieja-tycoon/protocol'] ||
  transportPackage.dependencies?.['@torrevieja-tycoon/simulation']
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
const astAuthorityAliasesFixture = await source(
  'scripts/fixtures/architecture/ast-authority-aliases.txt',
);
const astStoreExposureFixture = await source(
  'scripts/fixtures/architecture/ast-store-exposure.txt',
);
const nodeBuiltinsFixture = await source(
  'scripts/fixtures/architecture/node-builtins.txt',
);
const transportExtensionFixture = await source(
  'scripts/fixtures/architecture/transport-extension-allowed.txt',
);
const transportGenericFixture = await source(
  'scripts/fixtures/architecture/transport-generic-forbidden.txt',
);
const vehicleAuthorityForbiddenFixture = await source(
  'scripts/fixtures/architecture/vehicle-authority-forbidden.txt',
);
const populationExtensionFixture = await source(
  'scripts/fixtures/architecture/population-extension-allowed.txt',
);
const populationGenericFixture = await source(
  'scripts/fixtures/architecture/population-generic-forbidden.txt',
);
const itineraryExtensionFixture = await source(
  'scripts/fixtures/architecture/itinerary-extension-allowed.txt',
);
const itineraryGenericFixture = await source(
  'scripts/fixtures/architecture/itinerary-generic-forbidden.txt',
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
if (!transportDomainTerms(transportGenericFixture).length)
  fail('generic transport-domain boundary fixture was not rejected.');
if (transportDomainTerms(populationExtensionFixture).length === 0)
  fail('population extension fixture did not exercise domain terminology.');
if (!transportDomainTerms(populationGenericFixture).length)
  fail('generic population-domain boundary fixture was not rejected.');
if (itineraryDomainTerms(itineraryExtensionFixture).length === 0)
  fail('itinerary extension fixture did not exercise domain terminology.');
if (!itineraryDomainTerms(itineraryGenericFixture).length)
  fail('generic itinerary-domain boundary fixture was not rejected.');
if (
  environmentNeutralViolations(transportExtensionFixture).length ||
  topLevelSingletons(transportExtensionFixture).length
)
  fail('legitimate transport extension fixture failed architecture checks.');
if (
  !/from\s+['"]three['"]/.test(vehicleAuthorityForbiddenFixture) ||
  !/\bDate\b/.test(vehicleAuthorityForbiddenFixture) ||
  !/Math\.random/.test(vehicleAuthorityForbiddenFixture) ||
  !/setInterval/.test(vehicleAuthorityForbiddenFixture) ||
  !topLevelSingletons(vehicleAuthorityForbiddenFixture).length
)
  fail('vehicle-authority negative fixture was not fully detected.');
if (topLevelSingletons(singletonFixture).length !== 12)
  fail('singleton regression fixture was not fully detected.');
if (environmentNeutralViolations(forbiddenFixture).length !== 3)
  fail('Node-only regression fixtures were not fully detected.');
if (
  topLevelSingletons(astForbiddenFixture).length !== 4 ||
  writableStoreViolations(astForbiddenFixture).length !== 5
)
  fail('AST ownership regression fixtures were not fully detected.');
if (topLevelSingletons(astAuthorityAliasesFixture).length !== 3)
  fail('authority-factory alias fixtures were not fully detected.');
if (
  topLevelSingletons(astStoreExposureFixture).length !== 1 ||
  writableStoreViolations(astStoreExposureFixture).length !== 4
)
  fail('Zustand namespace/exposure fixtures were not fully detected.');
if (
  environmentNeutralViolations(nodeBuiltinsFixture).length !== 1 ||
  nodeBuiltinImports(nodeBuiltinsFixture).length !== 4
)
  fail('Node built-in fixtures were not fully detected.');
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
  `Foundation architecture audit passed (${simulation.length + protocol.length + transport.length + web.length} production modules, Git-free mode).`,
);
