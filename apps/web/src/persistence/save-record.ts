import { z } from 'zod';
import {
  foundationSnapshotDataSchema,
  parseCommandRevision,
  parseGameId,
  parseStreamOffset,
  parseTimelineId,
  type FoundationSnapshotData,
  type GameId,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .brand<'FoundationSaveId'>();
const time = z.number().int().nonnegative().safe();
const recordSchema = z
  .strictObject({
    kind: z.literal('foundation-save-record'),
    schemaVersion: z.literal(1),
    saveId: idSchema,
    label: z.string().trim().min(1).max(120).optional(),
    gameId: z.string(),
    sourceTimelineId: z.string(),
    sourceCommandRevision: time,
    sourceSimulationTick: time,
    sourceStreamOffset: time,
    createdAtUtcMs: time,
    updatedAtUtcMs: time,
    snapshot: foundationSnapshotDataSchema,
  })
  .superRefine((value, context) => {
    if (value.updatedAtUtcMs < value.createdAtUtcMs)
      context.addIssue({
        code: 'custom',
        message: 'updatedAtUtcMs precedes createdAtUtcMs',
      });
    if (value.sourceSimulationTick !== value.snapshot.state.tick)
      context.addIssue({
        code: 'custom',
        message: 'snapshot tick does not match sourceSimulationTick',
      });
  });

export type FoundationSaveId = z.infer<typeof idSchema>;
export interface FoundationSaveRecord {
  readonly kind: 'foundation-save-record';
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
  readonly snapshot: FoundationSnapshotData;
}
export type FoundationSaveSummary = Readonly<
  Omit<FoundationSaveRecord, 'snapshot'>
>;

export const parseFoundationSaveId = (value: unknown): FoundationSaveId =>
  idSchema.parse(value);
export function parseFoundationSaveRecord(
  value: unknown,
): FoundationSaveRecord {
  const parsed = recordSchema.parse(value);
  const snapshot = Object.freeze({
    ...parsed.snapshot,
    state: Object.freeze({ ...parsed.snapshot.state }),
  });
  return Object.freeze({
    ...parsed,
    gameId: parseGameId(parsed.gameId),
    sourceTimelineId: parseTimelineId(parsed.sourceTimelineId),
    sourceCommandRevision: parseCommandRevision(parsed.sourceCommandRevision),
    sourceStreamOffset: parseStreamOffset(parsed.sourceStreamOffset),
    snapshot,
  });
}
export function summarizeFoundationSave(
  record: FoundationSaveRecord,
): FoundationSaveSummary {
  return Object.freeze({
    kind: record.kind,
    schemaVersion: record.schemaVersion,
    saveId: record.saveId,
    ...(record.label === undefined ? {} : { label: record.label }),
    gameId: record.gameId,
    sourceTimelineId: record.sourceTimelineId,
    sourceCommandRevision: record.sourceCommandRevision,
    sourceSimulationTick: record.sourceSimulationTick,
    sourceStreamOffset: record.sourceStreamOffset,
    createdAtUtcMs: record.createdAtUtcMs,
    updatedAtUtcMs: record.updatedAtUtcMs,
  });
}
