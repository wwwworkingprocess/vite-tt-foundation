import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserFoundationWorker } from './browser-worker.js';

describe('browser Worker factory', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('forwards messages, listeners, removal, and termination', () => {
    const posted: unknown[] = [];
    const listeners = new Map<string, Set<EventListener>>();
    let terminated = false;
    class FakeWorker {
      constructor(
        readonly url: URL,
        readonly options: WorkerOptions,
      ) {}
      postMessage(message: unknown) {
        posted.push(message);
      }
      addEventListener(type: string, listener: EventListener) {
        const registrations = listeners.get(type) ?? new Set<EventListener>();
        registrations.add(listener);
        listeners.set(type, registrations);
      }
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      }
      terminate() {
        terminated = true;
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const worker = createBrowserFoundationWorker();
    const received: unknown[] = [];
    const listener = (event: { readonly data?: unknown }) =>
      received.push(event.data);

    worker.addEventListener('message', listener);
    worker.postMessage({ request: 1 });
    for (const registered of listeners.get('message') ?? [])
      registered(new MessageEvent('message', { data: { response: 1 } }));
    worker.removeEventListener('message', listener);
    worker.removeEventListener('message', listener);
    worker.terminate();

    expect(posted).toEqual([{ request: 1 }]);
    expect(received).toEqual([{ response: 1 }]);
    expect(listeners.get('message')).toHaveLength(0);
    expect(terminated).toBe(true);
  });
});
