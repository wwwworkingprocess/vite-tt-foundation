import { describe, expect, it } from 'vitest';

import {
  parseFoundationCommandEnvelope,
  parseFoundationAppliedCommandResult,
  parseFoundationFullBaseline,
  parseFoundationHostMessage,
  parseFoundationProtocolError,
  parseFoundationRejectedCommandResult,
  parseFoundationRenderSnapshot,
  parseFoundationStateUpdate,
  parseFoundationSynchronizationRequest,
  parseFoundationSynchronizationResponse,
  parseGameId,
  parseCommandId,
  parseClientId,
  parseCorrelationId,
  parseSessionId,
} from './index.js';

const command = {
  kind: 'foundation-command',
  gameId: 'game-1',
  timelineId: 'timeline-1',
  commandId: 'command-1',
  correlationId: 'correlation-1',
  clientId: 'client-1',
  sessionId: 'session-1',
  expectedCommandRevision: 0,
  sentAt: 'diagnostic-only',
  command: { type: 'foundation.advance-ticks', count: 2 },
};

describe('foundation protocol contracts', () => {
  it('validates IDs and command envelopes through JSON', () => {
    expect(parseGameId('game-1')).toBe('game-1');
    expect(parseCommandId('command-1')).toBe('command-1');
    expect(parseCorrelationId('correlation-1')).toBe('correlation-1');
    expect(parseClientId('client-1')).toBe('client-1');
    expect(parseSessionId('session-1')).toBe('session-1');
    expect(
      parseFoundationCommandEnvelope(JSON.parse(JSON.stringify(command))),
    ).toEqual(command);
  });

  it('validates reliable updates, render snapshots, and terminal results', () => {
    const messages = [
      {
        kind: 'foundation-state-update',
        gameId: 'game-1',
        timelineId: 'timeline-1',
        streamOffset: 1,
        commandRevision: 1,
        simulationTick: 2,
      },
      {
        kind: 'foundation-render-snapshot',
        gameId: 'game-1',
        timelineId: 'timeline-1',
        sequence: 1,
        commandRevision: 1,
        simulationTick: 2,
      },
      {
        kind: 'foundation-command-result',
        gameId: 'game-1',
        timelineId: 'timeline-1',
        commandId: 'command-1',
        correlationId: 'correlation-1',
        status: 'applied',
        appliedAtTick: 0,
        resultingSimulationTick: 2,
        appliedCommandRevision: 1,
        duplicate: false,
      },
    ];

    for (const message of messages) {
      expect(
        parseFoundationHostMessage(JSON.parse(JSON.stringify(message))),
      ).toEqual(message);
    }
    expect(parseFoundationStateUpdate(messages[0])).toEqual(messages[0]);
    expect(parseFoundationRenderSnapshot(messages[1])).toEqual(messages[1]);
    expect(parseFoundationAppliedCommandResult(messages[2])).toEqual(
      messages[2],
    );
    expect(
      parseFoundationRejectedCommandResult({
        kind: 'foundation-command-result',
        gameId: 'game-1',
        timelineId: 'timeline-1',
        commandId: 'command-2',
        correlationId: 'correlation-2',
        status: 'rejected',
        currentCommandRevision: 1,
        rejection: {
          code: 'stale-command-revision',
          expectedCommandRevision: 0,
          currentCommandRevision: 1,
        },
        duplicate: false,
      }),
    ).toMatchObject({ status: 'rejected' });
    expect(
      parseFoundationProtocolError({
        kind: 'foundation-protocol-error',
        gameId: 'game-1',
        commandId: 'command-1',
        code: 'command-id-conflict',
        message: 'conflict',
      }),
    ).toMatchObject({ code: 'command-id-conflict' });
  });

  it('validates synchronization requests', () => {
    expect(
      parseFoundationSynchronizationRequest({
        kind: 'foundation-synchronization-request',
        gameId: 'game-1',
        timelineId: 'timeline-1',
        lastAppliedStreamOffset: 0,
      }),
    ).toMatchObject({ lastAppliedStreamOffset: 0 });
    const baseline = {
      kind: 'foundation-full-baseline',
      gameId: 'game-1',
      timelineId: 'timeline-1',
      commandRevision: 0,
      simulationTick: 0,
      lastIncludedStreamOffset: 0,
      readModel: { tick: 0 },
    };
    expect(parseFoundationFullBaseline(baseline)).toEqual(baseline);
    expect(
      parseFoundationSynchronizationResponse({
        kind: 'foundation-synchronization-response',
        mode: 'full',
        reason: 'no-baseline',
        baseline,
      }),
    ).toMatchObject({ mode: 'full' });
    expect(
      parseFoundationSynchronizationResponse(
        JSON.parse(
          JSON.stringify({
            kind: 'foundation-synchronization-response',
            mode: 'delta',
            gameId: 'game-1',
            timelineId: 'timeline-1',
            fromExclusiveStreamOffset: 0,
            throughStreamOffset: 0,
            throughCommandRevision: 0,
            simulationTick: 0,
            updates: [],
          }),
        ),
      ),
    ).toMatchObject({ mode: 'delta', updates: [] });
    expect(
      parseFoundationSynchronizationResponse({
        kind: 'foundation-synchronization-identity-mismatch',
        code: 'identity-mismatch',
        gameId: 'other-game',
      }),
    ).toEqual({
      kind: 'foundation-synchronization-identity-mismatch',
      code: 'identity-mismatch',
      gameId: 'other-game',
    });
  });

  it.each([
    { ...command, gameId: '' },
    { ...command, expectedCommandRevision: -1 },
    { ...command, command: { ...command.command, count: 1.5 } },
    { ...command, command: { ...command.command, count: Number.NaN } },
    { ...command, command: { ...command.command, count: 2 ** 53 } },
    { ...command, unexpected: undefined },
  ])('rejects malformed or non-JSON-safe wire values', (value) =>
    expect(() => parseFoundationCommandEnvelope(value)).toThrow(),
  );

  it('rejects incompatible message discriminators', () => {
    expect(() =>
      parseFoundationHostMessage({ kind: 'unknown-message' }),
    ).toThrow();
  });
});
