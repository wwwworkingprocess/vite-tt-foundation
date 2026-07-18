import { access, readFile } from 'node:fs/promises';
import { z } from 'zod';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const manifest = JSON.parse(await read('foundation-template.json'));
const pkg = JSON.parse(await read('package.json'));
const schemaPath = manifest.$schema.replace(/^\.\//, '');
await access(new URL(schemaPath, root));
const documentedSchema = JSON.parse(await read(schemaPath));
const shape = z
  .object({
    $schema: z.string(),
    templateName: z.string().min(1),
    templateVersion: z.literal('1.0.0'),
    referenceProject: z.string().min(1),
    runtime: z
      .object({ node: z.literal('24.18.0'), yarn: z.literal('4.17.1') })
      .strict(),
    foundationPaths: z.array(z.string().min(1)).min(1),
    publicEntryPoints: z.array(z.string().min(1)).min(2),
    schemaVersions: z
      .object({
        simulationSnapshot: z.literal(1),
        saveRecord: z.literal(1),
      })
      .strict(),
    contractVersions: z
      .object({
        protocolContract: z.literal(1),
        workerAdapterContract: z.literal(1),
      })
      .strict(),
    buildBudgetsBytes: z
      .object({
        applicationEntry: z.number().int().positive(),
        representation: z.number().int().positive(),
        worker: z.number().int().positive(),
        totalEmittedJavaScript: z.number().int().positive(),
      })
      .strict(),
    extensionPoints: z.array(z.string().min(1)).min(1),
    bootstrapCommands: z.array(z.string().min(1)).min(1),
    portableValidationCommand: z.literal('corepack yarn validate:portable'),
    releaseRepositoryValidationCommands: z.array(z.string().min(1)).min(1),
    renameSurfaces: z.array(z.string().min(1)).min(1),
    protectedCompatibilitySurfaces: z.array(z.string().min(1)).min(1),
    archiveExcludes: z.array(z.string().min(1)).min(1),
  })
  .strict();
shape.parse(manifest);
const manifestKeys = Object.keys(manifest).sort();
const documentedKeys = Object.keys(documentedSchema.properties).sort();
if (JSON.stringify(manifestKeys) !== JSON.stringify(documentedKeys))
  throw new Error(
    'The JSON schema properties do not match the audited manifest shape.',
  );
for (const key of Object.keys(manifest).filter((key) => key !== '$schema'))
  if (!documentedSchema.required.includes(key))
    throw new Error(`The JSON schema does not require ${key}.`);
const nodePins = [
  (await read('.node-version')).trim(),
  (await read('.nvmrc')).trim(),
  pkg.engines.node,
  manifest.runtime.node,
];
if (new Set(nodePins).size !== 1)
  throw new Error(`Node pins are inconsistent: ${nodePins.join(', ')}`);
const ci = await read('.github/workflows/validation.yml');
if (!ci.includes('node-version-file: .node-version'))
  throw new Error('CI does not use the pinned Node version file.');
const yarnPins = [
  pkg.packageManager.replace('yarn@', ''),
  manifest.runtime.yarn,
  ...[
    ...ci.matchAll(
      /corepack (?:install --global|prepare) yarn@([^\s]+)(?: --activate)?/g,
    ),
  ].map((match) => match[1]),
];
if (new Set(yarnPins).size !== 1 || yarnPins.length < 4)
  throw new Error(`Yarn pins are inconsistent: ${yarnPins.join(', ')}`);
for (const path of manifest.foundationPaths)
  await access(new URL(`${path}/`, root));
for (const path of [
  'docs/template/clone-and-rename.md',
  'docs/template/domain-extension-guide.md',
])
  await access(new URL(path, root));
const workspacePackages = await Promise.all(
  ['packages/simulation/package.json', 'packages/protocol/package.json'].map(
    async (path) => JSON.parse(await read(path)),
  ),
);
for (const entry of manifest.publicEntryPoints)
  if (
    !workspacePackages.find((candidate) => candidate.name === entry)?.exports?.[
      '.'
    ]
  )
    throw new Error(`Public entry point is not exported: ${entry}`);
for (const command of [
  ...manifest.bootstrapCommands,
  manifest.portableValidationCommand,
  ...manifest.releaseRepositoryValidationCommands,
]) {
  const script = command.match(/^corepack yarn ([\w:-]+)$/)?.[1];
  if (script && !(script in pkg.scripts))
    throw new Error(`Manifest command has no package script: ${script}`);
}
const portableScript = pkg.scripts['validate:portable'];
for (const required of [
  'audit:runtime',
  'audit:line-endings',
  'audit:architecture',
  'audit:manifest',
  'format:check',
  'lint',
  'typecheck',
  'test',
  'test:coverage',
  'build',
  'audit:build',
  'test:e2e',
  'test:pwa',
  'test:pwa:subpath',
])
  if (!portableScript.includes(`yarn ${required}`))
    throw new Error(`validate:portable is missing ${required}.`);
if (/audit:(?:tracked|repository)/.test(portableScript))
  throw new Error('Portable validation must not require Git history.');
const requiredExcludes = [
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  'cypress/screenshots',
  'cypress/videos',
  'cypress/downloads',
  '.yarn/install-state.gz',
  '.env',
  '.env.*',
  '*.log',
];
for (const exclusion of requiredExcludes)
  if (!manifest.archiveExcludes.includes(exclusion))
    throw new Error(`Archive exclusion is missing: ${exclusion}`);
const sources = {
  simulationSnapshot: await read(
    'packages/simulation/src/foundation-snapshot.ts',
  ),
  saveRecord: await read('apps/web/src/persistence/save-record.ts'),
};
const constants = {
  simulationSnapshot: 'foundationSimulationSnapshotSchemaVersion',
  saveRecord: 'foundationSaveRecordSchemaVersion',
};
for (const [key, source] of Object.entries(sources))
  if (
    !new RegExp(
      `export const ${constants[key]} = ${manifest.schemaVersions[key]} as const`,
    ).test(source)
  )
    throw new Error(
      `Manifest ${key} version does not match its exported implementation constant.`,
    );
const contractSources = {
  protocolContract: await read('packages/protocol/src/index.ts'),
  workerAdapterContract: await read(
    'apps/web/src/simulation-worker/worker-wire.ts',
  ),
};
const contractConstants = {
  protocolContract: 'protocolContractVersion',
  workerAdapterContract: 'foundationWorkerAdapterContractVersion',
};
for (const [key, source] of Object.entries(contractSources))
  if (
    !new RegExp(
      `export const ${contractConstants[key]} = ${manifest.contractVersions[key]} as const`,
    ).test(source)
  )
    throw new Error(
      `Manifest ${key} compatibility marker does not match its exported constant.`,
    );
console.log('Foundation template manifest consistency audit passed.');
