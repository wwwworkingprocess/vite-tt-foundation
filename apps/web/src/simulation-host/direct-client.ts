import {
  parseGameId,
  parseTimelineId,
  type FoundationClientLifecycle,
  type FoundationSimulationClient,
} from '@torrevieja-tycoon/protocol';
import {
  createFoundationState,
  parseSimulationTick,
  parseFoundationSimulationSnapshot,
  restoreFoundationState,
} from '@torrevieja-tycoon/simulation';

import {
  createInMemorySimulationHost,
  type InMemorySimulationHost,
} from './in-memory-host.js';

export function createDirectFoundationClient(): FoundationSimulationClient {
  let lifecycle: FoundationClientLifecycle = Object.freeze({ state: 'idle' });
  let host: InMemorySimulationHost | undefined;
  const lifecycleListeners = new Set<{
    readonly listener: (state: FoundationClientLifecycle) => void;
  }>();
  interface HostRegistration<T> {
    readonly listener: (value: T) => void;
    cleanup?: () => void;
  }
  const reliableListeners = new Set<
    HostRegistration<
      Parameters<
        Parameters<InMemorySimulationHost['subscribeReliableUpdates']>[0]
      >[0]
    >
  >();
  const renderListeners = new Set<
    HostRegistration<
      Parameters<
        Parameters<InMemorySimulationHost['subscribeRenderSnapshots']>[0]
      >[0]
    >
  >();
  const pending = new Set<{ readonly reject: (error: Error) => void }>();

  function publishLifecycle(next: FoundationClientLifecycle): void {
    lifecycle = Object.freeze(next);
    for (const registration of [...lifecycleListeners]) {
      try {
        registration.listener(lifecycle);
      } catch {
        // Application listeners are isolated from client state.
      }
    }
  }

  function requireReady(): InMemorySimulationHost {
    if (lifecycle.state !== 'ready' || host === undefined)
      throw new Error('Foundation client is not ready.');
    return host;
  }

  function independentSubscription<T>(
    registrations: Set<HostRegistration<T>>,
    subscribe: (listener: (value: T) => void) => () => void,
    listener: (value: T) => void,
  ): () => void {
    const registration: HostRegistration<T> = { listener };
    if (host !== undefined && lifecycle.state === 'ready')
      registration.cleanup = subscribe(listener);
    registrations.add(registration);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      registration.cleanup?.();
      registrations.delete(registration);
    };
  }

  function fromSynchronous<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve) => {
      resolve(operation());
    });
  }

  function track<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const registration = { reject };
      pending.add(registration);
      operation.then(
        (value) => {
          if (pending.delete(registration)) resolve(value);
        },
        (error: Error) => {
          if (pending.delete(registration)) reject(error);
        },
      );
    });
  }

  const client: FoundationSimulationClient = {
    connect(request) {
      return fromSynchronous(() => {
        if (lifecycle.state !== 'idle')
          throw new Error('Foundation client can connect only from idle.');
        const gameId = parseGameId(request.gameId);
        const timelineId = parseTimelineId(request.timelineId);
        const initialState =
          request.mode === 'new'
            ? createFoundationState(
                parseSimulationTick(request.initialSimulationTick),
              )
            : restoreFoundationState(
                parseFoundationSimulationSnapshot(request.snapshot),
              );
        publishLifecycle({ state: 'connecting' });
        host = createInMemorySimulationHost({
          gameId,
          timelineId,
          initialState,
        });
        publishLifecycle({ state: 'ready', gameId, timelineId });
        for (const registration of reliableListeners)
          registration.cleanup = host.subscribeReliableUpdates(
            registration.listener,
          );
        for (const registration of renderListeners)
          registration.cleanup = host.subscribeRenderSnapshots(
            registration.listener,
          );
      });
    },
    sendCommand: (envelope) =>
      fromSynchronous(() => track(requireReady().sendCommand(envelope))),
    synchronize: (request) =>
      fromSynchronous(() =>
        track(Promise.resolve(requireReady().synchronize(request))),
      ),
    exportSnapshot: () =>
      fromSynchronous(() => track(requireReady().exportSnapshot())),
    subscribeReliableUpdates(listener) {
      if (lifecycle.state === 'closed')
        throw new Error('Foundation client is closed.');
      return independentSubscription(
        reliableListeners,
        (next) => requireReady().subscribeReliableUpdates(next),
        listener,
      );
    },
    subscribeRenderSnapshots(listener) {
      if (lifecycle.state === 'closed')
        throw new Error('Foundation client is closed.');
      return independentSubscription(
        renderListeners,
        (next) => requireReady().subscribeRenderSnapshots(next),
        listener,
      );
    },
    getLifecycle: () => lifecycle,
    subscribeLifecycle(listener) {
      if (lifecycle.state === 'closed')
        throw new Error('Foundation client is closed.');
      const registration = Object.freeze({ listener });
      lifecycleListeners.add(registration);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        lifecycleListeners.delete(registration);
      };
    },
    close() {
      if (lifecycle.state === 'closed') return Promise.resolve();
      const closed = new Error('Foundation client closed.');
      for (const operation of pending) operation.reject(closed);
      pending.clear();
      for (const registration of [...reliableListeners])
        registration.cleanup?.();
      for (const registration of [...renderListeners]) registration.cleanup?.();
      reliableListeners.clear();
      renderListeners.clear();
      host = undefined;
      publishLifecycle({ state: 'closed' });
      lifecycleListeners.clear();
      return Promise.resolve();
    },
  };
  return Object.freeze(client);
}
