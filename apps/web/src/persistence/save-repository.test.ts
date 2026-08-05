import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import {
  createFoundationSimulationSnapshot,
  createFoundationState,
  parseSimulationTick,
} from '@torrevieja-tycoon/simulation';
import {
  parseFoundationSaveId,
  parseFoundationSaveRecord,
} from './save-record.js';
import {
  createDexieFoundationSaveRepository,
  createInMemoryFoundationSaveRepository,
  deleteFoundationSaveDatabase,
  type FoundationSaveRepository,
} from './save-repository.js';
import { foundationSaveRecordSchemaVersion } from './save-record.js';

it('exports the save-record schema version', () =>
  expect(foundationSaveRecordSchemaVersion).toBe(1));

let sequence = 0;
const databases: string[] = [];
const factories: readonly (readonly [
  string,
  () => FoundationSaveRepository,
])[] = [
  ['memory', createInMemoryFoundationSaveRepository],
  [
    'dexie',
    () => {
      const name = `phase-3d-${sequence++}`;
      databases.push(name);
      return createDexieFoundationSaveRepository(name);
    },
  ],
];
afterEach(async () => {
  for (const name of databases.splice(0))
    await deleteFoundationSaveDatabase(name);
});
it('rejects invalid record relationships and empty database names', () => {
  const valid = record('relationship');
  expect(() =>
    parseFoundationSaveRecord({
      ...valid,
      createdAtUtcMs: 20,
      updatedAtUtcMs: 10,
    }),
  ).toThrow();
  expect(() =>
    parseFoundationSaveRecord({ ...valid, sourceSimulationTick: 6 }),
  ).toThrow();
  expect(() => createDexieFoundationSaveRepository(' ')).toThrow('name');
});
function record(id: string, updated = 10) {
  return parseFoundationSaveRecord({
    kind: 'foundation-save-record',
    schemaVersion: 1,
    saveId: id,
    label: ` ${id} `,
    gameId: parseGameId('game'),
    sourceTimelineId: parseTimelineId('source'),
    sourceCommandRevision: 2,
    sourceSimulationTick: 5,
    sourceStreamOffset: 2,
    createdAtUtcMs: 1,
    updatedAtUtcMs: updated,
    snapshot: createFoundationSimulationSnapshot(
      createFoundationState(parseSimulationTick(5)),
    ),
  });
}
describe.each(factories)('%s save repository', (_name, create) => {
  it('puts, replaces, gets, lists deterministically, deletes, and closes idempotently', async () => {
    const repository = create();
    await repository.put(record('b'));
    await repository.put(record('a'));
    await repository.put(record('c', 20));
    await repository.put(record('d', 20));
    await repository.put(record('b', 30));
    const loaded = await repository.get(parseFoundationSaveId('b'));
    expect(loaded?.updatedAtUtcMs).toBe(30);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded?.snapshot.state)).toBe(true);
    const list = await repository.list();
    expect(list.map((x) => x.saveId)).toEqual(['b', 'c', 'd', 'a']);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    await repository.delete(parseFoundationSaveId('b'));
    await expect(
      repository.get(parseFoundationSaveId('b')),
    ).resolves.toBeUndefined();
    await repository.close();
    await repository.close();
    await expect(repository.list()).rejects.toThrow('closed');
  });
  it('rejects malformed writes', async () => {
    const repository = create();
    await expect(repository.put({} as never)).rejects.toThrow();
    await repository.close();
  });
});

it('Dexie rejects corrupted stored data and isolates database names', async () => {
  const firstName = `phase-3d-${sequence++}`;
  const secondName = `phase-3d-${sequence++}`;
  databases.push(firstName, secondName);
  const first = createDexieFoundationSaveRepository(firstName);
  const second = createDexieFoundationSaveRepository(secondName);
  await first.put(record('valid'));
  await expect(
    second.get(parseFoundationSaveId('valid')),
  ).resolves.toBeUndefined();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(firstName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(
        'foundationSaves',
        'readwrite',
      );
      transaction.objectStore('foundationSaves').put({ saveId: 'corrupt' });
      transaction.oncomplete = () => {
        request.result.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
  await expect(
    first.get(parseFoundationSaveId('corrupt')),
  ).rejects.toMatchObject({
    code: 'invalid-persisted-record',
  });
  await first.close();
  await second.close();
});
