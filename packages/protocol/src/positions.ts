import { z } from 'zod';

const commandRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .brand<'CommandRevision'>();
const streamOffsetSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .brand<'StreamOffset'>();
const renderSnapshotSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .brand<'RenderSnapshotSequence'>();
const timelineIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    'Timeline ID contains unsupported characters.',
  )
  .brand<'TimelineId'>();

export type CommandRevision = z.infer<typeof commandRevisionSchema>;
export type StreamOffset = z.infer<typeof streamOffsetSchema>;
export type RenderSnapshotSequence = z.infer<
  typeof renderSnapshotSequenceSchema
>;
export type TimelineId = z.infer<typeof timelineIdSchema>;

export interface CommandConcurrencyExpectation {
  readonly expectedCommandRevision?: CommandRevision;
}

export function parseCommandRevision(value: unknown): CommandRevision {
  return commandRevisionSchema.parse(value);
}

export function parseStreamOffset(value: unknown): StreamOffset {
  return streamOffsetSchema.parse(value);
}

export function parseRenderSnapshotSequence(
  value: unknown,
): RenderSnapshotSequence {
  return renderSnapshotSequenceSchema.parse(value);
}

export function parseTimelineId(value: unknown): TimelineId {
  return timelineIdSchema.parse(value);
}
