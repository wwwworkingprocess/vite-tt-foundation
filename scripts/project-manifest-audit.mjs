import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const manifest = z
  .strictObject({
    schemaVersions: z.strictObject({
      transportSimulationSnapshot: z.number().int().positive(),
      transportSaveRecord: z.number().int().positive(),
    }),
    contractVersions: z.strictObject({
      transportClientContract: z.number().int().positive(),
      transportWorkerContract: z.number().int().positive(),
    }),
    buildBudgetsBytes: z.strictObject({
      applicationEntry: z.number().int().positive(),
      representation: z.number().int().positive(),
      transportWorker: z.number().int().positive(),
      totalEmittedJavaScript: z.number().int().positive(),
    }),
  })
  .parse(JSON.parse(await read('torrevieja-project.json')));
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
