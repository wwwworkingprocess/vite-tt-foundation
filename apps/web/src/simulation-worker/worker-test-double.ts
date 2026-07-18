import {
  startFoundationWorkerRuntime,
  type WorkerRuntimeEndpoint,
} from './worker-runtime.js';
import type { FoundationWorkerLike } from './worker-client.js';

type EventType = 'message' | 'error' | 'messageerror';
type Listener = (event: { readonly data?: unknown }) => void;

class TestWorker implements FoundationWorkerLike {
  readonly postedMessages: unknown[] = [];
  terminateCount = 0;
  private readonly listeners = new Map<EventType, Set<Listener>>([
    ['message', new Set()],
    ['error', new Set()],
    ['messageerror', new Set()],
  ]);
  onPost?: (message: unknown) => void;
  onTerminate?: () => void;
  private nextPostError: Error | undefined;

  postMessage(message: unknown): void {
    if (this.nextPostError !== undefined) {
      const error = this.nextPostError;
      this.nextPostError = undefined;
      throw error;
    }
    this.postedMessages.push(structuredClone(message));
    this.onPost?.(structuredClone(message));
  }
  addEventListener(type: EventType, listener: Listener): void {
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: EventType, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  terminate(): void {
    this.terminateCount += 1;
    this.onTerminate?.();
  }
  emitMessage(data: unknown): void {
    for (const listener of [...(this.listeners.get('message') ?? [])])
      listener({ data: structuredClone(data) });
  }
  emitFailure(type: 'error' | 'messageerror'): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({});
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0,
    );
  }
  failNextPost(error = new Error('postMessage failed')): void {
    this.nextPostError = error;
  }
}

export function createControllableWorker(): TestWorker {
  return new TestWorker();
}

export function createStructuredCloneLoopbackWorker(): FoundationWorkerLike {
  const client = new TestWorker();
  const runtimeListeners = new Set<
    (event: { readonly data: unknown }) => void
  >();
  const endpoint: WorkerRuntimeEndpoint = {
    postMessage(message) {
      queueMicrotask(() => client.emitMessage(structuredClone(message)));
    },
    addEventListener(_type, listener) {
      runtimeListeners.add(listener);
    },
    removeEventListener(_type, listener) {
      runtimeListeners.delete(listener);
    },
  };
  const stop = startFoundationWorkerRuntime(endpoint);
  client.onPost = (message) =>
    queueMicrotask(() => {
      for (const listener of [...runtimeListeners])
        listener({ data: structuredClone(message) });
    });
  client.onTerminate = stop;
  return client;
}
