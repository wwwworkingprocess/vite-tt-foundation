import { z } from 'zod';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import {
  createTransportSimulationState,
  parseSimulationTick,
  parseTransportSimulationSnapshot,
  parseVehicleFleetSnapshot,
} from '@torrevieja-tycoon/simulation';
import {
  foundationCommandEnvelopeSchema,
  foundationRenderSnapshotSchema,
  foundationStateUpdateSchema,
  foundationSynchronizationRequestSchema,
  parseFoundationHostMessage,
  parseFoundationSynchronizationResponse,
  parseCommandRevision,
  parseGameId,
  parseStreamOffset,
  parseTimelineId,
} from '@torrevieja-tycoon/protocol';
import type {
  TransportSnapshotExport,
  TransportSynchronizationResponse,
} from './transport-client.js';

export const transportWorkerContractVersion = 1 as const;
const requestId = z.number().int().positive().safe();
const operation = z.enum([
  'connect',
  'send-command',
  'synchronize',
  'export-snapshot',
  'close',
]);
const coordinate = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const canonicalScenario = z.unknown().transform((value, context) => {
  try {
    return createTransportSimulationState(value as CanonicalScenario, 0)
      .scenario;
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'Invalid canonical scenario.',
    });
    return z.NEVER;
  }
});
const transportSnapshot = z.unknown().transform((value, context) => {
  try {
    return parseTransportSimulationSnapshot(value);
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'Invalid transport snapshot.',
    });
    return z.NEVER;
  }
});
const identity = { gameId: z.string(), timelineId: z.string() };
const connectPayload = z.discriminatedUnion('mode', [
  z.strictObject({
    kind: z.literal('transport-client-connect'),
    contractVersion: z.literal(1),
    mode: z.literal('new'),
    ...identity,
    initialSimulationTick: z.number().int().nonnegative().safe(),
    scenario: canonicalScenario,
  }),
  z.strictObject({
    kind: z.literal('transport-client-connect'),
    contractVersion: z.literal(1),
    mode: z.literal('restore'),
    ...identity,
    scenario: canonicalScenario,
    snapshot: transportSnapshot,
  }),
]);
const vehicleId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const vehicleCommand = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('transport.vehicle.create'),
    vehicleId,
    label: z.string().trim().min(1).max(128),
    patternId: z.string().min(1),
    movementPlan: z.strictObject({
      kind: z.literal('vehicle-movement-plan-v1'),
      edgeTravelTicks: z.array(z.number().int().positive().safe()),
    }),
  }),
  z.strictObject({
    kind: z.literal('transport.vehicle.start'),
    vehicleId,
  }),
]);
const transportCommandEnvelope = foundationCommandEnvelopeSchema.extend({
  command: z.union([
    foundationCommandEnvelopeSchema.shape.command,
    vehicleCommand,
  ]),
});

export const transportWorkerRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    kind: z.literal('transport-worker-request'),
    contractVersion: z.literal(transportWorkerContractVersion),
    requestId,
    operation: z.literal('connect'),
    payload: connectPayload,
  }),
  z.strictObject({
    kind: z.literal('transport-worker-request'),
    contractVersion: z.literal(transportWorkerContractVersion),
    requestId,
    operation: z.literal('send-command'),
    payload: transportCommandEnvelope,
  }),
  z.strictObject({
    kind: z.literal('transport-worker-request'),
    contractVersion: z.literal(transportWorkerContractVersion),
    requestId,
    operation: z.literal('synchronize'),
    payload: foundationSynchronizationRequestSchema,
  }),
  z.strictObject({
    kind: z.literal('transport-worker-request'),
    contractVersion: z.literal(transportWorkerContractVersion),
    requestId,
    operation: z.literal('export-snapshot'),
    payload: z.null(),
  }),
  z.strictObject({
    kind: z.literal('transport-worker-request'),
    contractVersion: z.literal(transportWorkerContractVersion),
    requestId,
    operation: z.literal('close'),
    payload: z.null(),
  }),
]);

const result = z.strictObject({
  kind: z.literal('transport-worker-result'),
  contractVersion: z.literal(transportWorkerContractVersion),
  requestId,
  operation,
  payload: z.unknown(),
});
const failure = z.strictObject({
  kind: z.literal('transport-worker-failure'),
  contractVersion: z.literal(transportWorkerContractVersion),
  requestId: requestId.optional(),
  operation: operation.optional(),
  message: z.string().min(1),
});
const publication = z.discriminatedUnion('channel', [
  z.strictObject({
    kind: z.literal('transport-worker-publication'),
    contractVersion: z.literal(transportWorkerContractVersion),
    channel: z.literal('reliable'),
    payload: foundationStateUpdateSchema.extend({
      fleet: z.array(z.unknown()).readonly(),
    }),
  }),
  z.strictObject({
    kind: z.literal('transport-worker-publication'),
    contractVersion: z.literal(transportWorkerContractVersion),
    channel: z.literal('render'),
    payload: foundationRenderSnapshotSchema.extend({
      fleet: z.array(z.unknown()).readonly(),
    }),
  }),
]);
const response = z.union([result, failure, publication]);

export type TransportWorkerRequest = z.infer<
  typeof transportWorkerRequestSchema
>;
export type TransportWorkerResponse = z.infer<typeof response>;
const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

export function parseTransportSynchronizationResult(
  value: unknown,
): TransportSynchronizationResponse {
  const parsed = z
    .strictObject({
      kind: z.literal('transport-synchronization-response'),
      foundation: z.unknown(),
      scenario: coordinate,
      fleet: z.array(z.unknown()).readonly(),
    })
    .parse(value);
  return deepFreeze({
    ...parsed,
    foundation: parseFoundationSynchronizationResponse(parsed.foundation),
    fleet: parseVehicleFleetSnapshot(parsed.fleet),
  }) as TransportSynchronizationResponse;
}

export function parseTransportSnapshotExportResult(
  value: unknown,
): TransportSnapshotExport {
  const parsed = z
    .strictObject({
      kind: z.literal('transport-snapshot-export'),
      gameId: z.string(),
      timelineId: z.string(),
      commandRevision: z.number(),
      simulationTick: z.number(),
      streamOffset: z.number(),
      snapshot: z.unknown(),
    })
    .parse(value);
  return deepFreeze({
    ...parsed,
    gameId: parseGameId(parsed.gameId),
    timelineId: parseTimelineId(parsed.timelineId),
    commandRevision: parseCommandRevision(parsed.commandRevision),
    simulationTick: parseSimulationTick(parsed.simulationTick),
    streamOffset: parseStreamOffset(parsed.streamOffset),
    snapshot: parseTransportSimulationSnapshot(parsed.snapshot),
  });
}

export function parseTransportWorkerRequest(
  value: unknown,
): TransportWorkerRequest {
  const parsed = transportWorkerRequestSchema.parse(value);
  if (parsed.operation === 'connect') {
    const payload = parsed.payload;
    parseGameId(payload.gameId);
    parseTimelineId(payload.timelineId);
    if (payload.mode === 'new')
      parseSimulationTick(payload.initialSimulationTick);
    else parseTransportSimulationSnapshot(payload.snapshot);
  }
  return parsed;
}

export function parseTransportWorkerResponse(
  value: unknown,
): TransportWorkerResponse {
  const parsed = response.parse(value);
  if (parsed.kind === 'transport-worker-publication')
    return deepFreeze({
      ...parsed,
      payload: {
        ...parsed.payload,
        fleet: parseVehicleFleetSnapshot(parsed.payload.fleet),
      },
    }) as TransportWorkerResponse;
  if (parsed.kind !== 'transport-worker-result') return parsed;
  if (parsed.operation === 'connect' || parsed.operation === 'close') {
    if (parsed.payload !== null)
      throw new Error('Expected a null Worker result.');
  } else if (parsed.operation === 'send-command') {
    const host = parseFoundationHostMessage(parsed.payload);
    if (
      host.kind !== 'foundation-command-result' &&
      host.kind !== 'foundation-protocol-error'
    )
      throw new Error('Expected a command result.');
  } else if (parsed.operation === 'synchronize') {
    parseTransportSynchronizationResult(parsed.payload);
  } else {
    parseTransportSnapshotExportResult(parsed.payload);
  }
  return parsed;
}
