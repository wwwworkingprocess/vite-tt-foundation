import {
  applyFoundationCommand,
  createFoundationSimulationSnapshot,
  parseFoundationCommand,
  type FoundationState,
} from '@torrevieja-tycoon/simulation';
import {
  parseCommandRevision,
  parseFoundationAppliedCommandResult,
  parseFoundationCommandEnvelope,
  parseFoundationFullBaseline,
  parseFoundationProtocolError,
  parseFoundationRejectedCommandResult,
  parseFoundationRenderSnapshot,
  parseFoundationStateUpdate,
  parseFoundationSynchronizationRequest,
  parseFoundationSynchronizationResponse,
  parseFoundationSnapshotExport,
  parseRenderSnapshotSequence,
  parseStreamOffset,
  type CommandRevision,
  type FoundationCommandEnvelope,
  type FoundationCommandResult,
  type FoundationFullBaseline,
  type FoundationRenderSnapshot,
  type FoundationStateUpdate,
  type FoundationSynchronizationResponse,
  type FoundationSnapshotExport,
  type GameId,
  type RenderSnapshotSequence,
  type StreamOffset,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';

export interface HostDiagnostic {
  readonly kind: 'listener-failure';
  readonly channel: 'reliable-update' | 'render-snapshot';
  readonly error: unknown;
}

interface StoredCommandResult {
  readonly fingerprint: string;
  readonly result: Exclude<
    FoundationCommandResult,
    { kind: 'foundation-protocol-error' }
  >;
}

export interface InMemorySimulationHost {
  sendCommand(value: unknown): Promise<FoundationCommandResult>;
  exportSnapshot(): Promise<FoundationSnapshotExport>;
  synchronize(value: unknown): FoundationSynchronizationResponse;
  subscribeReliableUpdates(
    listener: (update: FoundationStateUpdate) => void,
  ): () => void;
  subscribeRenderSnapshots(
    listener: (snapshot: FoundationRenderSnapshot) => void,
  ): () => void;
  getCoordinates(): Readonly<{
    commandRevision: CommandRevision;
    simulationTick: number;
    streamOffset: StreamOffset;
    renderSnapshotSequence: RenderSnapshotSequence;
  }>;
}

export function createInMemorySimulationHost(input: {
  readonly gameId: GameId;
  readonly timelineId: TimelineId;
  readonly initialState: FoundationState;
  readonly onDiagnostic?: (diagnostic: HostDiagnostic) => void;
}): InMemorySimulationHost {
  let state = input.initialState;
  let commandRevision = parseCommandRevision(0);
  let streamOffset = parseStreamOffset(0);
  let renderSnapshotSequence = parseRenderSnapshotSequence(0);
  const retainedResults = new Map<string, StoredCommandResult>();
  const reliableHistory: FoundationStateUpdate[] = [];
  const reliableListeners = new Set<{
    readonly listener: (update: FoundationStateUpdate) => void;
  }>();
  const renderListeners = new Set<{
    readonly listener: (snapshot: FoundationRenderSnapshot) => void;
  }>();
  let commandQueue: Promise<void> = Promise.resolve();

  const continueQueue = <T>(result: Promise<T>): Promise<void> =>
    result.then(
      () => undefined,
      () => undefined,
    );

  function fingerprint(envelope: FoundationCommandEnvelope): string {
    return JSON.stringify({
      gameId: envelope.gameId,
      timelineId: envelope.timelineId,
      type: envelope.command.type,
      count: envelope.command.count,
      expectedCommandRevision: envelope.expectedCommandRevision,
    });
  }

  function publish<T>(
    channel: HostDiagnostic['channel'],
    listeners: ReadonlySet<{ readonly listener: (message: T) => void }>,
    message: T,
  ): void {
    for (const registration of [...listeners]) {
      try {
        registration.listener(message);
      } catch (error) {
        try {
          input.onDiagnostic?.(
            Object.freeze({ kind: 'listener-failure', channel, error }),
          );
        } catch {
          // Diagnostic reporting is observational and cannot affect the host.
        }
      }
    }
  }

  function protocolError(
    envelope: FoundationCommandEnvelope,
    code: 'command-id-conflict' | 'identity-mismatch',
    message: string,
  ): FoundationCommandResult {
    return Object.freeze(
      parseFoundationProtocolError({
        kind: 'foundation-protocol-error',
        gameId: envelope.gameId,
        commandId: envelope.commandId,
        correlationId: envelope.correlationId,
        code,
        message,
      }),
    );
  }

  function processCommand(value: unknown): FoundationCommandResult {
    const envelope = parseFoundationCommandEnvelope(value);
    if (
      envelope.gameId !== input.gameId ||
      envelope.timelineId !== input.timelineId
    ) {
      return protocolError(
        envelope,
        'identity-mismatch',
        'Host identity does not match the command.',
      );
    }

    const intentFingerprint = fingerprint(envelope);
    const stored = retainedResults.get(envelope.commandId);
    if (stored !== undefined) {
      if (stored.fingerprint !== intentFingerprint) {
        return protocolError(
          envelope,
          'command-id-conflict',
          'Command ID was reused with different stable intent.',
        );
      }
      return Object.freeze({ ...stored.result, duplicate: true });
    }

    if (
      envelope.expectedCommandRevision !== undefined &&
      envelope.expectedCommandRevision !== commandRevision
    ) {
      const rejected = Object.freeze(
        parseFoundationRejectedCommandResult({
          kind: 'foundation-command-result',
          gameId: input.gameId,
          timelineId: input.timelineId,
          commandId: envelope.commandId,
          correlationId: envelope.correlationId,
          status: 'rejected',
          currentCommandRevision: commandRevision,
          rejection: {
            code: 'stale-command-revision',
            expectedCommandRevision: envelope.expectedCommandRevision,
            currentCommandRevision: commandRevision,
          },
          duplicate: false,
        }),
      );
      Object.freeze(rejected.rejection);
      retainedResults.set(envelope.commandId, {
        fingerprint: intentFingerprint,
        result: rejected,
      });
      return rejected;
    }

    const appliedAtTick = state.tick;
    state = applyFoundationCommand(
      state,
      parseFoundationCommand(envelope.command),
    );
    commandRevision = parseCommandRevision(commandRevision + 1);
    streamOffset = parseStreamOffset(streamOffset + 1);
    renderSnapshotSequence = parseRenderSnapshotSequence(
      renderSnapshotSequence + 1,
    );

    const applied = Object.freeze(
      parseFoundationAppliedCommandResult({
        kind: 'foundation-command-result',
        gameId: input.gameId,
        timelineId: input.timelineId,
        commandId: envelope.commandId,
        correlationId: envelope.correlationId,
        status: 'applied',
        appliedAtTick,
        resultingSimulationTick: state.tick,
        appliedCommandRevision: commandRevision,
        duplicate: false,
      }),
    );
    retainedResults.set(envelope.commandId, {
      fingerprint: intentFingerprint,
      result: applied,
    });

    const update = Object.freeze(
      parseFoundationStateUpdate({
        kind: 'foundation-state-update',
        gameId: input.gameId,
        timelineId: input.timelineId,
        streamOffset,
        commandRevision,
        simulationTick: state.tick,
      }),
    );
    const snapshot = Object.freeze(
      parseFoundationRenderSnapshot({
        kind: 'foundation-render-snapshot',
        gameId: input.gameId,
        timelineId: input.timelineId,
        sequence: renderSnapshotSequence,
        commandRevision,
        simulationTick: state.tick,
      }),
    );
    reliableHistory.push(update);
    publish('reliable-update', reliableListeners, update);
    publish('render-snapshot', renderListeners, snapshot);
    return applied;
  }

  function sendCommand(value: unknown): Promise<FoundationCommandResult> {
    const result = commandQueue.then(() => processCommand(value));
    commandQueue = continueQueue(result);
    return result;
  }

  function exportSnapshot(): Promise<FoundationSnapshotExport> {
    const result = commandQueue.then(() => {
      const snapshot = createFoundationSimulationSnapshot(state);
      const exported = parseFoundationSnapshotExport({
        kind: 'foundation-snapshot-export',
        gameId: input.gameId,
        timelineId: input.timelineId,
        commandRevision,
        simulationTick: state.tick,
        streamOffset,
        snapshot,
      });
      Object.freeze(exported.snapshot.state);
      Object.freeze(exported.snapshot);
      return Object.freeze(exported);
    });
    commandQueue = continueQueue(result);
    return result;
  }

  function fullBaseline(): FoundationFullBaseline {
    const baseline = parseFoundationFullBaseline({
      kind: 'foundation-full-baseline',
      gameId: input.gameId,
      timelineId: input.timelineId,
      commandRevision,
      simulationTick: state.tick,
      lastIncludedStreamOffset: streamOffset,
      readModel: { tick: state.tick },
    });
    Object.freeze(baseline.readModel);
    return Object.freeze(baseline);
  }

  function freezeSynchronizationResponse(
    response: FoundationSynchronizationResponse,
  ): FoundationSynchronizationResponse {
    if (response.kind === 'foundation-synchronization-identity-mismatch') {
      return Object.freeze(response);
    }
    if (response.mode === 'full') {
      Object.freeze(response.baseline.readModel);
      Object.freeze(response.baseline);
    } else {
      for (const update of response.updates) Object.freeze(update);
      Object.freeze(response.updates);
    }
    return Object.freeze(response);
  }

  function synchronize(value: unknown): FoundationSynchronizationResponse {
    const request = parseFoundationSynchronizationRequest(value);
    if (request.gameId !== input.gameId) {
      return freezeSynchronizationResponse(
        parseFoundationSynchronizationResponse({
          kind: 'foundation-synchronization-identity-mismatch',
          code: 'identity-mismatch',
          gameId: request.gameId,
        }),
      );
    }
    const baseline = fullBaseline();
    const reason =
      request.timelineId === undefined ||
      request.lastAppliedStreamOffset === undefined
        ? 'no-baseline'
        : request.timelineId !== input.timelineId
          ? 'timeline-mismatch'
          : request.lastAppliedStreamOffset > streamOffset
            ? 'client-ahead'
            : undefined;
    if (reason !== undefined) {
      return freezeSynchronizationResponse(
        parseFoundationSynchronizationResponse({
          kind: 'foundation-synchronization-response',
          mode: 'full',
          reason,
          baseline,
        }),
      );
    }

    const updates = reliableHistory.slice(request.lastAppliedStreamOffset);
    return freezeSynchronizationResponse(
      parseFoundationSynchronizationResponse({
        kind: 'foundation-synchronization-response',
        mode: 'delta',
        gameId: input.gameId,
        timelineId: input.timelineId,
        fromExclusiveStreamOffset: request.lastAppliedStreamOffset,
        throughStreamOffset: streamOffset,
        throughCommandRevision: commandRevision,
        simulationTick: state.tick,
        updates,
      }),
    );
  }

  function subscribe<T>(
    listeners: Set<{ readonly listener: (message: T) => void }>,
    listener: (message: T) => void,
  ): () => void {
    const registration = Object.freeze({ listener });
    listeners.add(registration);
    let subscribed = true;
    return () => {
      if (subscribed) {
        subscribed = false;
        listeners.delete(registration);
      }
    };
  }

  return Object.freeze({
    sendCommand,
    exportSnapshot,
    synchronize,
    subscribeReliableUpdates: (
      listener: (update: FoundationStateUpdate) => void,
    ) => subscribe(reliableListeners, listener),
    subscribeRenderSnapshots: (
      listener: (snapshot: FoundationRenderSnapshot) => void,
    ) => subscribe(renderListeners, listener),
    getCoordinates: () =>
      Object.freeze({
        commandRevision,
        simulationTick: state.tick,
        streamOffset,
        renderSnapshotSequence,
      }),
  });
}
