import { z } from 'zod';
import {
  migrateTransportSimulationSnapshotV1,
  migrateTransportSimulationSnapshotV2,
  migrateTransportSimulationSnapshotV3,
  migrateTransportSimulationSnapshotV4,
  parseTransportSimulationSnapshot,
  parseTransportSimulationSnapshotV1,
  parseTransportSimulationSnapshotV2,
  parseTransportSimulationSnapshotV3,
  parseTransportSimulationSnapshotV4,
  type ScenarioCoordinate,
  type TransportSimulationSnapshot,
  type TransportSimulationSnapshotV1,
  type TransportSimulationSnapshotV2,
  type TransportSimulationSnapshotV3,
  type TransportSimulationSnapshotV4,
} from '@torrevieja-tycoon/simulation';
import {
  parseCommandRevision,
  parseGameId,
  parseStreamOffset,
  parseTimelineId,
  type GameId,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';
import {
  parseFoundationSaveId,
  parseFoundationSaveRecord,
  type FoundationSaveId,
} from '../persistence/save-record.js';

const position = z.number().int().nonnegative().safe();
export const transportSaveRecordSchemaVersion = 3 as const;
const coordinateSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const recordFields = {
  kind: z.literal('transport-save-record'),
  saveId: z.string(),
  label: z.string().trim().min(1).max(120).optional(),
  gameId: z.string(),
  sourceTimelineId: z.string(),
  sourceCommandRevision: position,
  sourceSimulationTick: position,
  sourceStreamOffset: position,
  createdAtUtcMs: position,
  updatedAtUtcMs: position,
  scenario: coordinateSchema,
  snapshot: z.unknown(),
} as const;
const recordSchema = z.strictObject({
  ...recordFields,
  schemaVersion: z.literal(transportSaveRecordSchemaVersion),
});
const recordV1Schema = z.strictObject({
  ...recordFields,
  schemaVersion: z.literal(1),
});
const recordV2Schema = z.strictObject({
  ...recordFields,
  schemaVersion: z.literal(2),
});

export interface TransportSaveRecord {
  readonly kind: 'transport-save-record';
  readonly schemaVersion: 3;
  readonly saveId: FoundationSaveId;
  readonly label?: string | undefined;
  readonly scenarioSchemaVersion?: string | undefined;
  readonly gameId: GameId;
  readonly sourceTimelineId: TimelineId;
  readonly sourceCommandRevision: number;
  readonly sourceSimulationTick: number;
  readonly sourceStreamOffset: number;
  readonly createdAtUtcMs: number;
  readonly updatedAtUtcMs: number;
  readonly scenario: ScenarioCoordinate;
  readonly snapshot: TransportSimulationSnapshot;
}

export interface TransportSaveRecordV2 extends Omit<
  TransportSaveRecord,
  'schemaVersion' | 'snapshot'
> {
  readonly schemaVersion: 2;
  readonly snapshot: TransportSimulationSnapshotV2;
}
export interface TransportSaveRecordV3 extends Omit<
  TransportSaveRecord,
  'snapshot'
> {
  readonly snapshot: TransportSimulationSnapshotV3;
}
export interface TransportSaveRecordV4 extends Omit<
  TransportSaveRecord,
  'snapshot'
> {
  readonly snapshot: TransportSimulationSnapshotV4;
}

export interface TransportSaveRecordV1 {
  readonly kind: 'transport-save-record';
  readonly schemaVersion: 1;
  readonly saveId: FoundationSaveId;
  readonly label?: string | undefined;
  readonly gameId: GameId;
  readonly sourceTimelineId: TimelineId;
  readonly sourceCommandRevision: number;
  readonly sourceSimulationTick: number;
  readonly sourceStreamOffset: number;
  readonly createdAtUtcMs: number;
  readonly updatedAtUtcMs: number;
  readonly scenario: ScenarioCoordinate;
  readonly snapshot: TransportSimulationSnapshotV1;
}

export interface TransportSaveSummary {
  readonly saveId: FoundationSaveId;
  readonly label?: string | undefined;
  readonly scenarioSchemaVersion?: string | undefined;
  readonly scenarioId?: string | undefined;
  readonly scenarioVersion?: string | undefined;
  readonly contentHash?: string | undefined;
  readonly sourceTimelineId: TimelineId;
  readonly sourceSimulationTick: number;
  readonly createdAtUtcMs: number;
  readonly updatedAtUtcMs: number;
  readonly snapshotVersion?: 1 | 2 | 3 | 4 | 5 | undefined;
  readonly vehicleCount?: number | undefined;
  readonly compatibility: 'current' | 'migratable' | 'legacy-incompatible';
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

type ParsedRecordFields =
  | z.infer<typeof recordSchema>
  | z.infer<typeof recordV1Schema>
  | z.infer<typeof recordV2Schema>;

const parseRecordWithSnapshot = <TSnapshot>(
  value: unknown,
  parseFields: (input: unknown) => ParsedRecordFields,
  parseSnapshot: (snapshot: unknown) => TSnapshot & {
    readonly scenario: ScenarioCoordinate;
    readonly state: { readonly tick: number };
  },
) => {
  const parsed = parseFields(value);
  const snapshot = parseSnapshot(parsed.snapshot);
  const scenario = freeze(parsed.scenario as ScenarioCoordinate);
  if (
    JSON.stringify(snapshot.scenario) !== JSON.stringify(scenario) ||
    snapshot.state.tick !== parsed.sourceSimulationTick ||
    parsed.updatedAtUtcMs < parsed.createdAtUtcMs
  )
    throw new Error('Transport save record coordinates are inconsistent.');
  return freeze({
    ...parsed,
    saveId: parseFoundationSaveId(parsed.saveId),
    gameId: parseGameId(parsed.gameId),
    sourceTimelineId: parseTimelineId(parsed.sourceTimelineId),
    sourceCommandRevision: parseCommandRevision(parsed.sourceCommandRevision),
    sourceStreamOffset: parseStreamOffset(parsed.sourceStreamOffset),
    scenario,
    snapshot,
  });
};

export function parseTransportSaveRecord(value: unknown): TransportSaveRecord {
  return parseVersionThreeRecord(value, parseTransportSimulationSnapshot);
}

export function parseTransportSaveRecordV1(
  value: unknown,
): TransportSaveRecordV1 {
  return parseRecordWithSnapshot(
    value,
    (input) => recordV1Schema.parse(input),
    parseTransportSimulationSnapshotV1,
  ) as TransportSaveRecordV1;
}

export function parseTransportSaveRecordV2(
  value: unknown,
): TransportSaveRecordV2 {
  return parseRecordWithSnapshot(
    value,
    (input) => recordV2Schema.parse(input),
    parseTransportSimulationSnapshotV2,
  ) as TransportSaveRecordV2;
}

const parseVersionThreeRecord = <
  TSnapshot extends
    | TransportSimulationSnapshot
    | TransportSimulationSnapshotV3
    | TransportSimulationSnapshotV4,
>(
  value: unknown,
  parseSnapshot: (snapshot: unknown) => TSnapshot,
): Omit<TransportSaveRecord, 'snapshot'> & { readonly snapshot: TSnapshot } => {
  return parseRecordWithSnapshot(
    value,
    (input) => recordSchema.parse(input),
    parseSnapshot,
  ) as Omit<TransportSaveRecord, 'snapshot'> & {
    readonly snapshot: TSnapshot;
  };
};

export function parseTransportSaveRecordV3(
  value: unknown,
): TransportSaveRecordV3 {
  return parseVersionThreeRecord(value, parseTransportSimulationSnapshotV3);
}

export function parseTransportSaveRecordV4(
  value: unknown,
): TransportSaveRecordV4 {
  return parseVersionThreeRecord(value, parseTransportSimulationSnapshotV4);
}

export function migrateTransportSaveRecordV1(
  record: TransportSaveRecordV1,
): TransportSaveRecord {
  return parseTransportSaveRecord({
    ...record,
    schemaVersion: 3,
    snapshot: migrateTransportSimulationSnapshotV1(record.snapshot),
  });
}

export function migrateTransportSaveRecordV2(
  record: TransportSaveRecordV2,
): TransportSaveRecord {
  return parseTransportSaveRecord({
    ...record,
    schemaVersion: 3,
    snapshot: migrateTransportSimulationSnapshotV2(record.snapshot),
  });
}

export function migrateTransportSaveRecordV3(
  record: TransportSaveRecordV3,
): TransportSaveRecord {
  return parseTransportSaveRecord({
    ...record,
    snapshot: migrateTransportSimulationSnapshotV3(record.snapshot),
  });
}

export function migrateTransportSaveRecordV4(
  record: TransportSaveRecordV4,
): TransportSaveRecord {
  return parseTransportSaveRecord({
    ...record,
    snapshot: migrateTransportSimulationSnapshotV4(record.snapshot),
  });
}

export function summarizeCompatibleSave(
  record: TransportSaveRecord,
): TransportSaveSummary {
  return freeze({
    saveId: record.saveId,
    ...(record.label === undefined ? {} : { label: record.label }),
    scenarioId: record.scenario.scenarioId,
    scenarioSchemaVersion: record.scenario.scenarioSchemaVersion,
    scenarioVersion: record.scenario.scenarioVersion,
    contentHash: record.scenario.contentHash,
    sourceTimelineId: record.sourceTimelineId,
    sourceSimulationTick: record.sourceSimulationTick,
    createdAtUtcMs: record.createdAtUtcMs,
    updatedAtUtcMs: record.updatedAtUtcMs,
    snapshotVersion: 5,
    vehicleCount: record.snapshot.state.fleet.length,
    compatibility: 'current',
  });
}

function summarizeMigratableSaveV2(
  record: TransportSaveRecordV2,
): TransportSaveSummary {
  return freeze({
    saveId: record.saveId,
    ...(record.label === undefined ? {} : { label: record.label }),
    scenarioId: record.scenario.scenarioId,
    scenarioSchemaVersion: record.scenario.scenarioSchemaVersion,
    scenarioVersion: record.scenario.scenarioVersion,
    contentHash: record.scenario.contentHash,
    sourceTimelineId: record.sourceTimelineId,
    sourceSimulationTick: record.sourceSimulationTick,
    createdAtUtcMs: record.createdAtUtcMs,
    updatedAtUtcMs: record.updatedAtUtcMs,
    snapshotVersion: 2,
    vehicleCount: record.snapshot.state.fleet.length,
    compatibility: 'migratable',
  });
}

const summarizeVersionThreeMigration = (
  record: TransportSaveRecordV3 | TransportSaveRecordV4,
  snapshotVersion: 3 | 4,
): TransportSaveSummary =>
  freeze({
    saveId: record.saveId,
    ...(record.label === undefined ? {} : { label: record.label }),
    scenarioId: record.scenario.scenarioId,
    scenarioSchemaVersion: record.scenario.scenarioSchemaVersion,
    scenarioVersion: record.scenario.scenarioVersion,
    contentHash: record.scenario.contentHash,
    sourceTimelineId: record.sourceTimelineId,
    sourceSimulationTick: record.sourceSimulationTick,
    createdAtUtcMs: record.createdAtUtcMs,
    updatedAtUtcMs: record.updatedAtUtcMs,
    snapshotVersion,
    vehicleCount: record.snapshot.state.fleet.length,
    compatibility: 'migratable',
  });

function summarizeMigratableSave(
  record: TransportSaveRecordV1,
): TransportSaveSummary {
  return freeze({
    saveId: record.saveId,
    ...(record.label === undefined ? {} : { label: record.label }),
    scenarioId: record.scenario.scenarioId,
    scenarioSchemaVersion: record.scenario.scenarioSchemaVersion,
    scenarioVersion: record.scenario.scenarioVersion,
    contentHash: record.scenario.contentHash,
    sourceTimelineId: record.sourceTimelineId,
    sourceSimulationTick: record.sourceSimulationTick,
    createdAtUtcMs: record.createdAtUtcMs,
    updatedAtUtcMs: record.updatedAtUtcMs,
    snapshotVersion: 1,
    vehicleCount: 0,
    compatibility: 'migratable',
  });
}

export type PersistedSaveClassification =
  | Readonly<{
      classification: 'current';
      record: TransportSaveRecord;
      summary: TransportSaveSummary;
    }>
  | Readonly<{
      classification: 'migratable-transport-v1';
      record: TransportSaveRecordV1;
      summary: TransportSaveSummary;
    }>
  | Readonly<{
      classification: 'migratable-transport-v2';
      record: TransportSaveRecordV2;
      summary: TransportSaveSummary;
    }>
  | Readonly<{
      classification: 'migratable-transport-v3';
      record: TransportSaveRecordV3;
      summary: TransportSaveSummary;
    }>
  | Readonly<{
      classification: 'migratable-transport-v4';
      record: TransportSaveRecordV4;
      summary: TransportSaveSummary;
    }>
  | Readonly<{
      classification: 'legacy-foundation';
      summary: TransportSaveSummary;
    }>
  | Readonly<{
      classification: 'malformed-known' | 'unsupported-future';
      error: Error;
    }>
  | Readonly<{ classification: 'unrelated' }>;

export function classifyPersistedSaveRecord(
  value: unknown,
): PersistedSaveClassification {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return freeze({ classification: 'unrelated' });
  const raw = value as { kind?: unknown; schemaVersion?: unknown };
  if (
    raw.kind !== 'transport-save-record' &&
    raw.kind !== 'foundation-save-record'
  )
    return freeze({ classification: 'unrelated' });
  const supportedVersion = raw.kind === 'transport-save-record' ? 3 : 1;
  if (
    typeof raw.schemaVersion === 'number' &&
    Number.isSafeInteger(raw.schemaVersion) &&
    raw.schemaVersion > supportedVersion
  )
    return freeze({
      classification: 'unsupported-future',
      error: new Error('Unsupported future save record.'),
    });
  try {
    if (raw.kind === 'transport-save-record') {
      if (raw.schemaVersion === 1) {
        const record = parseTransportSaveRecordV1(value);
        return freeze({
          classification: 'migratable-transport-v1',
          record,
          summary: summarizeMigratableSave(record),
        });
      }
      if (raw.schemaVersion === 2) {
        const record = parseTransportSaveRecordV2(value);
        return freeze({
          classification: 'migratable-transport-v2',
          record,
          summary: summarizeMigratableSaveV2(record),
        });
      }
      try {
        const record = parseTransportSaveRecord(value);
        return freeze({
          classification: 'current',
          record,
          summary: summarizeCompatibleSave(record),
        });
      } catch (currentError) {
        try {
          const record = parseTransportSaveRecordV4(value);
          return freeze({
            classification: 'migratable-transport-v4',
            record,
            summary: summarizeVersionThreeMigration(record, 4),
          });
        } catch {
          try {
            const record = parseTransportSaveRecordV3(value);
            return freeze({
              classification: 'migratable-transport-v3',
              record,
              summary: summarizeVersionThreeMigration(record, 3),
            });
          } catch {
            throw currentError;
          }
        }
      }
    }
    const legacy = parseFoundationSaveRecord(value);
    return freeze({
      classification: 'legacy-foundation',
      summary: {
        saveId: legacy.saveId,
        ...(legacy.label === undefined ? {} : { label: legacy.label }),
        sourceTimelineId: legacy.sourceTimelineId,
        sourceSimulationTick: legacy.sourceSimulationTick,
        createdAtUtcMs: legacy.createdAtUtcMs,
        updatedAtUtcMs: legacy.updatedAtUtcMs,
        compatibility: 'legacy-incompatible',
      },
    });
  } catch (cause) {
    return freeze({
      classification: 'malformed-known',
      error: new Error('Malformed known save record.', { cause }),
    });
  }
}
