import { z } from 'zod';
import {
  migrateTransportSimulationSnapshotV1,
  parseTransportSimulationSnapshot,
  parseTransportSimulationSnapshotV1,
  type ScenarioCoordinate,
  type TransportSimulationSnapshot,
  type TransportSimulationSnapshotV1,
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
export const transportSaveRecordSchemaVersion = 2 as const;
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

export interface TransportSaveRecord {
  readonly kind: 'transport-save-record';
  readonly schemaVersion: 2;
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
  readonly snapshotVersion?: 1 | 2 | undefined;
  readonly vehicleCount?: number | undefined;
  readonly compatibility: 'current' | 'migratable' | 'legacy-incompatible';
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

export function parseTransportSaveRecord(value: unknown): TransportSaveRecord {
  const parsed = recordSchema.parse(value);
  const snapshot = parseTransportSimulationSnapshot(parsed.snapshot);
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
}

export function parseTransportSaveRecordV1(
  value: unknown,
): TransportSaveRecordV1 {
  const parsed = recordV1Schema.parse(value);
  const snapshot = parseTransportSimulationSnapshotV1(parsed.snapshot);
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
}

export function migrateTransportSaveRecordV1(
  record: TransportSaveRecordV1,
): TransportSaveRecord {
  return parseTransportSaveRecord({
    ...record,
    schemaVersion: 2,
    snapshot: migrateTransportSimulationSnapshotV1(record.snapshot),
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
    snapshotVersion: 2,
    vehicleCount: record.snapshot.state.fleet.length,
    compatibility: 'current',
  });
}

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
  const supportedVersion = raw.kind === 'transport-save-record' ? 2 : 1;
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
      const record = parseTransportSaveRecord(value);
      return freeze({
        classification: 'current',
        record,
        summary: summarizeCompatibleSave(record),
      });
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
