import { validatePreparationResult } from './preparation-wire.js';
import { preparationBytes } from './preparation-bytes.js';
import {
  preparationProtocolVersion as version,
  record,
  type PreparationJob,
  type PreparationWorker,
} from './preparation-protocol.js';
/** One channel owns correlation and promise sharing. A crash invalidates the channel. */
export function createPreparationClient(
  worker: PreparationWorker,
  maxQueuedJobs: number,
  maxRetainedBytes = 64 * 1024 * 1024,
  maxJobMilliseconds = 60000,
) {
  let ready = false,
    closed = false,
    nextId = 0;
  const cache = new Map<string, Promise<unknown>>();
  const successful = new Map<string, number>();
  const jobs: {
    id: number;
    kind: string;
    key: string;
    milliseconds: number;
    bytes: number;
  }[] = [];
  let retainedBytes = 0;
  const pending = new Map<
    number,
    {
      key: string;
      job: PreparationJob;
      timer: ReturnType<typeof setTimeout>;
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
    }
  >();
  const close = (reason = 'City preparation worker closed') => {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const [name, listener] of events)
      worker.removeEventListener(name, listener);
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
    cache.clear();
    successful.clear();
    retainedBytes = 0;
    clearTimeout(handshakeTimer);
  };
  const handshakeTimer = setTimeout(
    () => close('City preparation worker handshake timed out'),
    10000,
  );
  const send = (id: number, p: { job: PreparationJob }) => {
    try {
      worker.postMessage({ version, id, job: p.job });
    } catch {
      close('City preparation worker send failed');
    }
  };
  const message: EventListener = (event) => {
    const data = (event as MessageEvent<unknown>).data;
    if (!record(data) || data.version !== version) {
      close('Invalid city preparation protocol');
      return;
    }
    if (data.kind === 'hello') {
      if (ready) {
        close('Duplicate city preparation handshake');
        return;
      }
      ready = true;
      clearTimeout(handshakeTimer);
      for (const [id, p] of pending) send(id, p);
      return;
    }
    if (!Number.isSafeInteger(data.id) || typeof data.ok !== 'boolean') {
      close('Invalid city preparation protocol');
      return;
    }
    const p = pending.get(data.id as number);
    if (!p) {
      close('Unknown city preparation response');
      return;
    }
    pending.delete(data.id as number);
    clearTimeout(p.timer);
    if (data.ok) {
      try {
        validatePreparationResult(p.job, data.value);
      } catch (error) {
        p.reject(
          new Error('Invalid city preparation result: ' + String(error)),
        );
        return;
      }
      const bytes = preparationBytes(data.value);
      jobs.push({
        id: data.id as number,
        kind: p.job.kind,
        key: p.key,
        milliseconds:
          typeof data.milliseconds === 'number' ? data.milliseconds : 0,
        bytes,
      });
      if (jobs.length > 32) jobs.shift();
      successful.set(p.key, bytes);
      retainedBytes += bytes;
      while (successful.size > 16 || retainedBytes > maxRetainedBytes) {
        const first = successful.keys().next().value!;
        retainedBytes -= successful.get(first)!;
        successful.delete(first);
        cache.delete(first);
      }
      p.resolve(data.value);
    } else if (typeof data.error === 'string') p.reject(new Error(data.error));
    else {
      p.reject(new Error('Invalid city preparation error'));
      close('Invalid city preparation protocol');
    }
  };
  const failed: EventListener = () =>
    close('City preparation worker crashed or message could not be decoded');
  const events: readonly (readonly [string, EventListener])[] = [
    ['message', message],
    ['error', failed],
    ['messageerror', failed],
  ];
  for (const [name, listener] of events)
    worker.addEventListener(name, listener);
  try {
    worker.postMessage({ version, kind: 'hello' });
  } catch {
    close('City preparation worker handshake failed');
  }
  return Object.freeze({
    request(key: string, job: PreparationJob): Promise<unknown> {
      if (closed)
        return Promise.reject(new Error('City preparation worker closed'));
      const old = cache.get(key);
      if (old) return old;
      if (pending.size >= maxQueuedJobs)
        return Promise.reject(
          new Error('City preparation queue capacity exceeded'),
        );
      const id = ++nextId;
      const promise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => close('City preparation job timed out; retry preparation'),
          maxJobMilliseconds,
        );
        const p = { key, job, timer, resolve, reject };
        pending.set(id, p);
        if (ready) send(id, p);
      });
      cache.set(key, promise);
      void promise.catch(() => cache.delete(key));
      return promise;
    },
    close,
    isClosed: () => closed,
    metrics: () =>
      Object.freeze({
        retainedBytes,
        pending: pending.size,
        retained: successful.size,
        jobs: [...jobs],
        active: [...pending.values()].map((p) => p.job.kind),
      }),
  });
}
