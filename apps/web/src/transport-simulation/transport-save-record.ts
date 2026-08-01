import { z } from 'zod';
import {
  parseTransportSimulationSnapshot,
  type ScenarioCoordinate,
  type TransportSimulationSnapshot,
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
  type FoundationSaveId,
} from '../persistence/save-record.js';

const position = z.number().int().nonnegative().safe();
export const transportSaveRecordSchemaVersion = 6 as const;
const coordinateSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const recordSchema = z.strictObject({
  kind: z.literal('transport-save-record'),
  schemaVersion: z.literal(transportSaveRecordSchemaVersion),
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
});

export interface TransportSaveRecord {
  readonly kind: 'transport-save-record';
  readonly schemaVersion: 6;
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
  readonly snapshot: TransportSimulationSnapshot;
}

export interface TransportSaveSummary {
  readonly saveId: FoundationSaveId;
  readonly label?: string | undefined;
  readonly scenarioSchemaVersion: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly contentHash: string;
  readonly sourceTimelineId: TimelineId;
  readonly sourceSimulationTick: number;
  readonly createdAtUtcMs: number;
  readonly updatedAtUtcMs: number;
  readonly snapshotVersion: 8;
  readonly vehicleCount: number;
  readonly compatibility: 'current';
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
    snapshotVersion: 8,
    vehicleCount: record.snapshot.state.fleet.length,
    compatibility: 'current',
  });
}

export type PersistedSaveClassification =
  | Readonly<{
      classification: 'current';
      record: TransportSaveRecord;
      summary: TransportSaveSummary;
    }>
  | Readonly<{ classification: 'obsolete-pre-release'; error: Error }>
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
  if (raw.kind === 'foundation-save-record')
    return freeze({
      classification: 'obsolete-pre-release',
      error: new Error('This pre-release save is obsolete.'),
    });
  if (
    typeof raw.schemaVersion === 'number' &&
    Number.isSafeInteger(raw.schemaVersion) &&
    raw.schemaVersion > transportSaveRecordSchemaVersion
  )
    return freeze({
      classification: 'unsupported-future',
      error: new Error('Unsupported future save record.'),
    });
  if (raw.schemaVersion !== transportSaveRecordSchemaVersion)
    return freeze({
      classification: 'obsolete-pre-release',
      error: new Error('This pre-release save is obsolete.'),
    });
  try {
    const record = parseTransportSaveRecord(value);
    return freeze({
      classification: 'current',
      record,
      summary: summarizeCompatibleSave(record),
    });
  } catch (cause) {
    return freeze({
      classification: 'malformed-known',
      error: new Error('Malformed known save record.', { cause }),
    });
  }
}
