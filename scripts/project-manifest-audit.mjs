import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const manifest = z
  .strictObject({
    defaultScenarioId: z.string().min(1),
    schemaVersions: z.strictObject({
      transportSimulationSnapshot: z.number().int().positive(),
      transportSaveRecord: z.number().int().positive(),
    }),
    contractVersions: z.strictObject({
      transportClientContract: z.number().int().positive(),
      transportWorkerContract: z.number().int().positive(),
    }),
    criticalCoverage: z.strictObject({
      statements: z.literal(95),
      lines: z.literal(95),
      functions: z.literal(95),
      branches: z.literal(95),
      files: z.array(z.string().min(1)).min(1),
    }),
    simulationCriticalCoverage: z.strictObject({
      statements: z.literal(95),
      lines: z.literal(95),
      functions: z.literal(95),
      branches: z.literal(95),
      files: z.array(z.string().min(1)).min(1),
    }),
    transportDomainCriticalCoverage: z.strictObject({
      statements: z.literal(95),
      lines: z.literal(95),
      functions: z.literal(95),
      branches: z.literal(95),
      files: z.array(z.string().min(1)).min(1),
    }),
    buildBudgetsBytes: z.strictObject({
      applicationEntry: z.number().int().positive(),
      dialogShell: z.number().int().positive(),
      projectInfo: z.number().int().positive(),
      simulationControls: z.number().int().positive(),
      sessionControls: z.number().int().positive(),
      svgRepresentation: z.number().int().positive(),
      representation: z.number().int().positive(),
      transportWorker: z.number().int().positive(),
      totalEmittedJavaScript: z.number().int().positive(),
    }),
  })
  .parse(JSON.parse(await read('torrevieja-project.json')));
if (manifest.defaultScenarioId !== 'torrevieja-legacy-abc-v1')
  throw new Error(
    'defaultScenarioId must name the adopted legacy A/B/C scenario.',
  );
if (
  !(await read('apps/web/src/project-defaults.ts')).includes(
    `defaultScenarioId = '${manifest.defaultScenarioId}' as const`,
  )
)
  throw new Error('Browser default scenario does not match project manifest.');
const requiredCriticalFiles = [
  'apps/web/src/transport-simulation/transport-controller.ts',
  'apps/web/src/transport-simulation/transport-foundation-application.ts',
  'apps/web/src/transport-simulation/transport-client.ts',
  'apps/web/src/transport-simulation/worker-transport-client.ts',
  'apps/web/src/transport-simulation/transport-worker-wire.ts',
  'apps/web/src/transport-simulation/transport-save-record.ts',
  'apps/web/src/transport-simulation/transport-save-repository.ts',
  'apps/web/src/scenarios/scenario-loader.ts',
  'apps/web/src/transport-representation/vehicle-svg-projection.ts',
  'apps/web/src/transport-representation/demo-vehicle-command.ts',
  'apps/web/src/transport-simulation/scenario-save-target.ts',
];
for (const path of requiredCriticalFiles)
  if (!manifest.criticalCoverage.files.includes(path))
    throw new Error(`criticalCoverage.files is missing ${path}.`);
const requiredTransportDomainCriticalFiles = [
  'packages/transport-domain/src/city-population-grid.ts',
  'packages/transport-domain/src/stop-catchment.ts',
];
const requiredSimulationCriticalFiles = [
  'packages/simulation/src/vehicle-movement.ts',
  'packages/simulation/src/transport-simulation.ts',
  'packages/simulation/src/passenger-demand.ts',
  'packages/simulation/src/passenger-direct-itinerary.ts',
  'packages/simulation/src/passenger-waiting-cohort.ts',
  'packages/simulation/src/vehicle-operation.ts',
];
for (const path of requiredSimulationCriticalFiles)
  if (!manifest.simulationCriticalCoverage.files.includes(path))
    throw new Error(`simulationCriticalCoverage.files is missing ${path}.`);
for (const path of requiredTransportDomainCriticalFiles)
  if (!manifest.transportDomainCriticalCoverage.files.includes(path))
    throw new Error(
      `transportDomainCriticalCoverage.files is missing ${path}.`,
    );
const checks = [
  [
    'schemaVersions.transportSimulationSnapshot',
    manifest.schemaVersions.transportSimulationSnapshot,
    'packages/simulation/src/transport-simulation.ts',
    'transportSimulationSnapshotSchemaVersion',
  ],
  [
    'schemaVersions.transportSaveRecord',
    manifest.schemaVersions.transportSaveRecord,
    'apps/web/src/transport-simulation/transport-save-record.ts',
    'transportSaveRecordSchemaVersion',
  ],
  [
    'contractVersions.transportClientContract',
    manifest.contractVersions.transportClientContract,
    'apps/web/src/transport-simulation/transport-client.ts',
    'transportClientContractVersion',
  ],
  [
    'contractVersions.transportWorkerContract',
    manifest.contractVersions.transportWorkerContract,
    'apps/web/src/transport-simulation/transport-worker-wire.ts',
    'transportWorkerContractVersion',
  ],
];
for (const [name, version, path, constant] of checks) {
  const source = await read(path);
  if (
    !new RegExp(
      `(?:const|let)\\s+${constant}\\s*=\\s*${version}(?:\\s+as\\s+const)?`,
    ).test(source)
  )
    throw new Error(`${name} does not match ${constant} in ${path}.`);
}
console.log('Torrevieja project manifest audit passed.');
