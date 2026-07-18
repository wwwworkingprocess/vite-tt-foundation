import { z } from 'zod';
import {
  foundationCommandEnvelopeSchema,
  foundationRenderSnapshotSchema,
  foundationStateUpdateSchema,
  foundationSynchronizationRequestSchema,
  parseFoundationHostMessage,
} from '@torrevieja-tycoon/protocol';

const requestIdSchema = z.number().int().positive().safe();
const connectSchema = z.strictObject({
  gameId: z.string(),
  timelineId: z.string(),
  initialSimulationTick: z.number().int().nonnegative().safe(),
});

export const workerRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    kind: z.literal('worker-request'),
    requestId: requestIdSchema,
    operation: z.literal('initialize'),
    payload: connectSchema,
  }),
  z.strictObject({
    kind: z.literal('worker-request'),
    requestId: requestIdSchema,
    operation: z.literal('send-command'),
    payload: foundationCommandEnvelopeSchema,
  }),
  z.strictObject({
    kind: z.literal('worker-request'),
    requestId: requestIdSchema,
    operation: z.literal('synchronize'),
    payload: foundationSynchronizationRequestSchema,
  }),
  z.strictObject({
    kind: z.literal('worker-request'),
    requestId: requestIdSchema,
    operation: z.literal('close'),
  }),
]);

const operationResultSchema = z.strictObject({
  kind: z.literal('worker-operation-result'),
  requestId: requestIdSchema,
  status: z.literal('success'),
  result: z.unknown(),
});
const workerFailureSchema = z.strictObject({
  kind: z.literal('worker-failure'),
  requestId: requestIdSchema.optional(),
  code: z.enum(['invalid-request', 'operation-failed']),
  message: z.string().min(1),
});
const reliablePublicationSchema = z.strictObject({
  kind: z.literal('worker-reliable-update'),
  update: foundationStateUpdateSchema,
});
const renderPublicationSchema = z.strictObject({
  kind: z.literal('worker-render-snapshot'),
  snapshot: foundationRenderSnapshotSchema,
});

export const workerResponseSchema = z.union([
  operationResultSchema,
  workerFailureSchema,
  reliablePublicationSchema,
  renderPublicationSchema,
]);

export type WorkerRequest = z.infer<typeof workerRequestSchema>;
export type WorkerResponse = z.infer<typeof workerResponseSchema>;

export function parseWorkerRequest(value: unknown): WorkerRequest {
  return workerRequestSchema.parse(value);
}

export function parseWorkerResponse(value: unknown): WorkerResponse {
  const response = workerResponseSchema.parse(value);
  if (response.kind === 'worker-operation-result' && response.result !== null) {
    response.result = parseFoundationHostMessage(response.result);
  }
  return response;
}
