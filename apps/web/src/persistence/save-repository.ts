import Dexie, { type EntityTable } from 'dexie';
import {
  parseFoundationSaveId,
  parseFoundationSaveRecord,
  summarizeFoundationSave,
  type FoundationSaveId,
  type FoundationSaveRecord,
  type FoundationSaveSummary,
} from './save-record.js';

export class FoundationPersistenceError extends Error {
  readonly code = 'invalid-persisted-record';
}
export interface FoundationSaveRepository {
  put(record: FoundationSaveRecord): Promise<void>;
  get(saveId: FoundationSaveId): Promise<FoundationSaveRecord | undefined>;
  list(): Promise<readonly FoundationSaveSummary[]>;
  delete(saveId: FoundationSaveId): Promise<void>;
  close(): Promise<void>;
}
function validated(value: unknown): FoundationSaveRecord {
  try {
    return parseFoundationSaveRecord(structuredClone(value));
  } catch (error) {
    throw new FoundationPersistenceError('Persisted save record is invalid.', {
      cause: error,
    });
  }
}
function summaries(
  records: readonly unknown[],
): readonly FoundationSaveSummary[] {
  const values = records
    .map(validated)
    .sort(
      (a, b) =>
        b.updatedAtUtcMs - a.updatedAtUtcMs || a.saveId.localeCompare(b.saveId),
    )
    .map(summarizeFoundationSave);
  return Object.freeze(values);
}
export function createInMemoryFoundationSaveRepository(): FoundationSaveRepository {
  const records = new Map<string, unknown>();
  let closed = false;
  const open = () => {
    if (closed) throw new Error('Foundation save repository is closed.');
  };
  return Object.freeze({
    put(record: FoundationSaveRecord) {
      return Promise.resolve().then(() => {
        open();
        const parsed = validated(record);
        records.set(parsed.saveId, structuredClone(parsed));
      });
    },
    get(saveId: FoundationSaveId) {
      return Promise.resolve().then(() => {
        open();
        const value = records.get(parseFoundationSaveId(saveId));
        return value === undefined ? undefined : validated(value);
      });
    },
    list() {
      return Promise.resolve().then(() => {
        open();
        return summaries([...records.values()]);
      });
    },
    delete(saveId: FoundationSaveId) {
      return Promise.resolve().then(() => {
        open();
        records.delete(parseFoundationSaveId(saveId));
      });
    },
    close() {
      closed = true;
      return Promise.resolve();
    },
  });
}
class SaveDatabase extends Dexie {
  foundationSaves!: EntityTable<Record<string, unknown>, 'saveId'>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      foundationSaves: 'saveId, gameId, updatedAtUtcMs',
    });
  }
}
export function createDexieFoundationSaveRepository(
  databaseName: string,
): FoundationSaveRepository {
  if (!databaseName.trim()) throw new Error('Database name is required.');
  const db = new SaveDatabase(databaseName);
  let closed = false;
  const open = () => {
    if (closed) throw new Error('Foundation save repository is closed.');
  };
  return Object.freeze({
    async put(record: FoundationSaveRecord) {
      open();
      const parsed = validated(record);
      await db.foundationSaves.put(
        structuredClone(parsed) as unknown as Record<string, unknown>,
      );
    },
    async get(saveId: FoundationSaveId) {
      open();
      const value = await db.foundationSaves.get(parseFoundationSaveId(saveId));
      return value === undefined ? undefined : validated(value);
    },
    async list() {
      open();
      return summaries(await db.foundationSaves.toArray());
    },
    async delete(saveId: FoundationSaveId) {
      open();
      await db.foundationSaves.delete(parseFoundationSaveId(saveId));
    },
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
      return Promise.resolve();
    },
  });
}
export async function deleteFoundationSaveDatabase(
  name: string,
): Promise<void> {
  await Dexie.delete(name);
}
