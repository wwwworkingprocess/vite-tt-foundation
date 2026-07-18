import { z } from 'zod';

import {
  parseCommandRevision,
  parseRenderSnapshotSequence,
  parseStreamOffset,
  parseTimelineId,
} from './positions.js';

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const opaqueId = <T extends string>() =>
  z.string().min(1).max(128).regex(opaqueIdPattern).brand<T>();
const gameIdSchema = opaqueId<'GameId'>();
const commandIdSchema = opaqueId<'CommandId'>();
const correlationIdSchema = opaqueId<'CorrelationId'>();
const clientIdSchema = opaqueId<'ClientId'>();
const sessionIdSchema = opaqueId<'SessionId'>();
const positionSchema = z.number().int().nonnegative().safe();

export type GameId = z.infer<typeof gameIdSchema>;
export type CommandId = z.infer<typeof commandIdSchema>;
export type CorrelationId = z.infer<typeof correlationIdSchema>;
export type ClientId = z.infer<typeof clientIdSchema>;
export type SessionId = z.infer<typeof sessionIdSchema>;

export const foundationCommandEnvelopeSchema = z.strictObject({
  kind: z.literal('foundation-command'),
  gameId: gameIdSchema,
  timelineId: z.string().transform(parseTimelineId),
  commandId: commandIdSchema,
  correlationId: correlationIdSchema,
  clientId: clientIdSchema,
  sessionId: sessionIdSchema,
  expectedCommandRevision: positionSchema
    .transform(parseCommandRevision)
    .optional(),
  sentAt: z.string().optional(),
  command: z.strictObject({
    type: z.literal('foundation.advance-ticks'),
    count: positionSchema,
  }),
});

export type FoundationCommandEnvelope = Readonly<
  z.infer<typeof foundationCommandEnvelopeSchema>
>;

const foundationAppliedResultSchema = z.strictObject({
  kind: z.literal('foundation-command-result'),
  gameId: gameIdSchema,
  timelineId: z.string().transform(parseTimelineId),
  commandId: commandIdSchema,
  correlationId: correlationIdSchema,
  status: z.literal('applied'),
  appliedAtTick: positionSchema,
  resultingSimulationTick: positionSchema,
  appliedCommandRevision: positionSchema.transform(parseCommandRevision),
  duplicate: z.boolean(),
});

const foundationRejectedResultSchema = z.strictObject({
  kind: z.literal('foundation-command-result'),
  gameId: gameIdSchema,
  timelineId: z.string().transform(parseTimelineId),
  commandId: commandIdSchema,
  correlationId: correlationIdSchema,
  status: z.literal('rejected'),
  currentCommandRevision: positionSchema.transform(parseCommandRevision),
  rejection: z.strictObject({
    code: z.literal('stale-command-revision'),
    expectedCommandRevision: positionSchema.transform(parseCommandRevision),
    currentCommandRevision: positionSchema.transform(parseCommandRevision),
  }),
  duplicate: z.boolean(),
});

export const foundationProtocolErrorSchema = z.strictObject({
  kind: z.literal('foundation-protocol-error'),
  gameId: gameIdSchema,
  commandId: commandIdSchema.optional(),
  correlationId: correlationIdSchema.optional(),
  code: z.enum(['command-id-conflict', 'identity-mismatch', 'invalid-message']),
  message: z.string().min(1),
});

export const foundationStateUpdateSchema = z.strictObject({
  kind: z.literal('foundation-state-update'),
  gameId: gameIdSchema,
  timelineId: z.string().transform(parseTimelineId),
  streamOffset: positionSchema.transform(parseStreamOffset),
  commandRevision: positionSchema.transform(parseCommandRevision),
  simulationTick: positionSchema,
});

export const foundationRenderSnapshotSchema = z.strictObject({
  kind: z.literal('foundation-render-snapshot'),
  gameId: gameIdSchema,
  timelineId: z.string().transform(parseTimelineId),
  sequence: positionSchema.transform(parseRenderSnapshotSequence),
  commandRevision: positionSchema.transform(parseCommandRevision),
  simulationTick: positionSchema,
});

export const foundationFullBaselineSchema = z.strictObject({
  kind: z.literal('foundation-full-baseline'),
  gameId: gameIdSchema,
  timelineId: z.string().transform(parseTimelineId),
  commandRevision: positionSchema.transform(parseCommandRevision),
  simulationTick: positionSchema,
  lastIncludedStreamOffset: positionSchema.transform(parseStreamOffset),
  readModel: z.strictObject({ tick: positionSchema }),
});

export const foundationSynchronizationRequestSchema = z.strictObject({
  kind: z.literal('foundation-synchronization-request'),
  gameId: gameIdSchema,
  timelineId: z.string().transform(parseTimelineId).optional(),
  lastAppliedStreamOffset: positionSchema
    .transform(parseStreamOffset)
    .optional(),
});

const foundationSuccessfulSynchronizationResponseSchema = z.discriminatedUnion(
  'mode',
  [
    z.strictObject({
      kind: z.literal('foundation-synchronization-response'),
      mode: z.literal('delta'),
      gameId: gameIdSchema,
      timelineId: z.string().transform(parseTimelineId),
      fromExclusiveStreamOffset: positionSchema.transform(parseStreamOffset),
      throughStreamOffset: positionSchema.transform(parseStreamOffset),
      throughCommandRevision: positionSchema.transform(parseCommandRevision),
      simulationTick: positionSchema,
      updates: z.array(foundationStateUpdateSchema),
    }),
    z.strictObject({
      kind: z.literal('foundation-synchronization-response'),
      mode: z.literal('full'),
      reason: z.enum(['no-baseline', 'timeline-mismatch', 'client-ahead']),
      baseline: foundationFullBaselineSchema,
    }),
  ],
);

export const foundationSynchronizationIdentityMismatchSchema = z.strictObject({
  kind: z.literal('foundation-synchronization-identity-mismatch'),
  code: z.literal('identity-mismatch'),
  gameId: gameIdSchema,
});

const foundationSynchronizationResponseSchema = z.union([
  foundationSuccessfulSynchronizationResponseSchema,
  foundationSynchronizationIdentityMismatchSchema,
]);

export const foundationHostMessageSchema = z.union([
  foundationAppliedResultSchema,
  foundationRejectedResultSchema,
  foundationProtocolErrorSchema,
  foundationStateUpdateSchema,
  foundationRenderSnapshotSchema,
  foundationFullBaselineSchema,
  foundationSynchronizationResponseSchema,
]);

export type FoundationAppliedCommandResult = Readonly<
  z.infer<typeof foundationAppliedResultSchema>
>;
type FoundationRejectedCommandResultValue = z.infer<
  typeof foundationRejectedResultSchema
>;
export type FoundationRejectedCommandResult = Readonly<
  Omit<FoundationRejectedCommandResultValue, 'rejection'> & {
    readonly rejection: Readonly<
      FoundationRejectedCommandResultValue['rejection']
    >;
  }
>;
export type FoundationProtocolError = Readonly<
  z.infer<typeof foundationProtocolErrorSchema>
>;
export type FoundationCommandResult =
  | FoundationAppliedCommandResult
  | FoundationRejectedCommandResult
  | FoundationProtocolError;
export type FoundationStateUpdate = Readonly<
  z.infer<typeof foundationStateUpdateSchema>
>;
export type FoundationRenderSnapshot = Readonly<
  z.infer<typeof foundationRenderSnapshotSchema>
>;
type FoundationFullBaselineValue = z.infer<typeof foundationFullBaselineSchema>;
export type FoundationFullBaseline = Readonly<
  Omit<FoundationFullBaselineValue, 'readModel'> & {
    readonly readModel: Readonly<FoundationFullBaselineValue['readModel']>;
  }
>;
export type FoundationSynchronizationRequest = Readonly<
  z.infer<typeof foundationSynchronizationRequestSchema>
>;
export type FoundationSynchronizationIdentityMismatch = Readonly<
  z.infer<typeof foundationSynchronizationIdentityMismatchSchema>
>;
type FoundationSynchronizationResponseValue = z.infer<
  typeof foundationSynchronizationResponseSchema
>;
type FoundationDeltaSynchronizationResponse = Readonly<
  Omit<
    Extract<FoundationSynchronizationResponseValue, { mode: 'delta' }>,
    'updates'
  > & {
    readonly updates: readonly FoundationStateUpdate[];
  }
>;
type FoundationFullSynchronizationResponse = Readonly<
  Omit<
    Extract<FoundationSynchronizationResponseValue, { mode: 'full' }>,
    'baseline'
  > & {
    readonly baseline: FoundationFullBaseline;
  }
>;
export type FoundationSynchronizationResponse =
  | FoundationDeltaSynchronizationResponse
  | FoundationFullSynchronizationResponse
  | FoundationSynchronizationIdentityMismatch;

export const parseGameId = (value: unknown): GameId =>
  gameIdSchema.parse(value);
export const parseCommandId = (value: unknown): CommandId =>
  commandIdSchema.parse(value);
export const parseCorrelationId = (value: unknown): CorrelationId =>
  correlationIdSchema.parse(value);
export const parseClientId = (value: unknown): ClientId =>
  clientIdSchema.parse(value);
export const parseSessionId = (value: unknown): SessionId =>
  sessionIdSchema.parse(value);
export const parseFoundationCommandEnvelope = (
  value: unknown,
): FoundationCommandEnvelope => foundationCommandEnvelopeSchema.parse(value);
export const parseFoundationHostMessage = (value: unknown) =>
  foundationHostMessageSchema.parse(value);
export const parseFoundationAppliedCommandResult = (
  value: unknown,
): FoundationAppliedCommandResult => foundationAppliedResultSchema.parse(value);
export const parseFoundationRejectedCommandResult = (
  value: unknown,
): FoundationRejectedCommandResult =>
  foundationRejectedResultSchema.parse(value);
export const parseFoundationProtocolError = (
  value: unknown,
): FoundationProtocolError => foundationProtocolErrorSchema.parse(value);
export const parseFoundationStateUpdate = (
  value: unknown,
): FoundationStateUpdate => foundationStateUpdateSchema.parse(value);
export const parseFoundationRenderSnapshot = (
  value: unknown,
): FoundationRenderSnapshot => foundationRenderSnapshotSchema.parse(value);
export const parseFoundationFullBaseline = (
  value: unknown,
): FoundationFullBaseline => foundationFullBaselineSchema.parse(value);
export const parseFoundationSynchronizationRequest = (
  value: unknown,
): FoundationSynchronizationRequest =>
  foundationSynchronizationRequestSchema.parse(value);
export const parseFoundationSynchronizationResponse = (
  value: unknown,
): FoundationSynchronizationResponse =>
  foundationSynchronizationResponseSchema.parse(value);
