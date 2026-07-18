import {
  parseGameId,
  parseTimelineId,
  type FoundationClientLifecycle,
  type FoundationSimulationClient,
} from '@torrevieja-tycoon/protocol';
import {
  createFoundationState,
  parseSimulationTick,
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

  function track<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const registration = { reject };
      pending.add(registration);
      operation.then(
        (value) => {
          if (pending.delete(registration)) resolve(value);
        },
        (error: unknown) => {
          if (pending.delete(registration))
            reject(
              error instanceof Error ? error : new Error('Operation failed.'),
            );
        },
      );
    });
  }

  const client: FoundationSimulationClient = {
    connect(request) {
      if (lifecycle.state !== 'idle')
        return Promise.reject(
          new Error('Foundation client can connect only from idle.'),
        );
      let gameId;
      let timelineId;
      let initialSimulationTick;
      try {
        gameId = parseGameId(request.gameId);
        timelineId = parseTimelineId(request.timelineId);
        initialSimulationTick = parseSimulationTick(
          request.initialSimulationTick,
        );
      } catch (error) {
        return Promise.reject(
          error instanceof Error
            ? error
            : new Error('Invalid foundation connect request.'),
        );
      }
      publishLifecycle({ state: 'connecting' });
      host = createInMemorySimulationHost({
        gameId,
        timelineId,
        initialState: createFoundationState(initialSimulationTick),
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
      return Promise.resolve();
    },
    sendCommand(envelope) {
      try {
        return track(requireReady().sendCommand(envelope));
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error('Command failed.'),
        );
      }
    },
    synchronize(request) {
      try {
        return track(Promise.resolve(requireReady().synchronize(request)));
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error('Synchronization failed.'),
        );
      }
    },
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
