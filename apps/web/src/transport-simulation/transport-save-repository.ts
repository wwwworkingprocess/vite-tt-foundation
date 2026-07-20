import Dexie, { type EntityTable } from 'dexie';
import {
  classifyPersistedSaveRecord,
  parseTransportSaveRecord,
  type PersistedSaveClassification,
  type TransportSaveRecord,
} from './transport-save-record.js';

export interface TransportSaveRepository {
  put(record: TransportSaveRecord): Promise<void>;
  get(saveId: string): Promise<PersistedSaveClassification | undefined>;
  list(): Promise<readonly PersistedSaveClassification[]>;
  delete(saveId: string): Promise<void>;
  close(): Promise<void>;
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};
const classify = (records: readonly unknown[]) =>
  freeze(
    records.map((record) =>
      classifyPersistedSaveRecord(structuredClone(record)),
    ),
  );

export function createInMemoryTransportSaveRepository(
  initial: readonly unknown[] = [],
): TransportSaveRepository {
  const records = new Map<string, unknown>();
  for (const value of initial) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      continue;
    const saveId = (value as { saveId?: unknown }).saveId;
    if (typeof saveId === 'string') records.set(saveId, structuredClone(value));
  }
  let closed = false;
  const open = () => {
    if (closed) throw new Error('Transport save repository is closed.');
  };
  return Object.freeze({
    put(record: TransportSaveRecord) {
      return Promise.resolve().then(() => {
        open();
        const parsed = parseTransportSaveRecord(structuredClone(record));
        records.set(parsed.saveId, structuredClone(parsed));
      });
    },
    get(saveId: string) {
      return Promise.resolve().then(() => {
        open();
        const value = records.get(saveId);
        return value === undefined
          ? undefined
          : classifyPersistedSaveRecord(structuredClone(value));
      });
    },
    list() {
      return Promise.resolve().then(() => {
        open();
        return classify([...records.values()]);
      });
    },
    delete(saveId: string) {
      return Promise.resolve().then(() => {
        open();
        records.delete(saveId);
      });
    },
    close() {
      closed = true;
      return Promise.resolve();
    },
  });
}

class TransportSaveDatabase extends Dexie {
  foundationSaves!: EntityTable<Record<string, unknown>, 'saveId'>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      foundationSaves: 'saveId, gameId, updatedAtUtcMs',
    });
  }
}

export function createDexieTransportSaveRepository(
  databaseName: string,
): TransportSaveRepository {
  if (!databaseName.trim()) throw new Error('Database name is required.');
  const database = new TransportSaveDatabase(databaseName);
  let closed = false;
  const open = () => {
    if (closed) throw new Error('Transport save repository is closed.');
  };
  return Object.freeze({
    async put(record: TransportSaveRecord) {
      open();
      const parsed = parseTransportSaveRecord(structuredClone(record));
      await database.foundationSaves.put(
        structuredClone(parsed) as unknown as Record<string, unknown>,
      );
    },
    async get(saveId: string) {
      open();
      const value = await database.foundationSaves.get(saveId);
      return value === undefined
        ? undefined
        : classifyPersistedSaveRecord(structuredClone(value));
    },
    async list() {
      open();
      return classify(await database.foundationSaves.toArray());
    },
    async delete(saveId: string) {
      open();
      await database.foundationSaves.delete(saveId);
    },
    close() {
      if (!closed) {
        closed = true;
        database.close();
      }
      return Promise.resolve();
    },
  });
}

export async function deleteTransportSaveDatabase(name: string): Promise<void> {
  await Dexie.delete(name);
}
