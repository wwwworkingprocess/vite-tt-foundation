export type RepresentationMode = 'mini' | 'normal';

export const representationCadence = (mode: RepresentationMode) =>
  Object.freeze({
    mode,
    targetFramesPerSecond: mode === 'mini' ? 5 : 60,
    intervalMilliseconds: mode === 'mini' ? 200 : 1000 / 60,
  });

export interface LatestRepresentationThrottle<T> {
  publish(value: T): void;
  setMode(mode: RepresentationMode): void;
  close(): void;
}

export interface RepresentationFrameDriver {
  setMode(mode: RepresentationMode): void;
  close(): void;
}

export function createRepresentationFrameDriver(input: {
  readonly mode: RepresentationMode;
  readonly now: () => number;
  readonly setTimer: (callback: () => void, delay: number) => unknown;
  readonly cancel: (handle: unknown) => void;
  readonly frame: (time: number) => void;
}): RepresentationFrameDriver {
  let mode = input.mode;
  let timer: unknown;
  let closed = false;
  const requestNextFrame = () => {
    if (closed) return;
    const interval = representationCadence(mode).intervalMilliseconds;
    timer = input.setTimer(() => {
      timer = undefined;
      if (closed) return;
      input.frame(input.now());
      requestNextFrame();
    }, interval);
  };
  requestNextFrame();
  return Object.freeze({
    setMode(next: RepresentationMode) {
      if (closed || next === mode) return;
      mode = next;
      if (timer !== undefined) input.cancel(timer);
      timer = undefined;
      requestNextFrame();
    },
    close() {
      closed = true;
      if (timer !== undefined) input.cancel(timer);
      timer = undefined;
    },
  });
}

export function createLatestRepresentationThrottle<T>(input: {
  readonly mode: RepresentationMode;
  readonly now: () => number;
  readonly setTimer: (callback: () => void, delay: number) => unknown;
  readonly cancel: (handle: unknown) => void;
  readonly commit: (value: T) => void;
}): LatestRepresentationThrottle<T> {
  let mode = input.mode;
  let lastCommit: number | undefined;
  let pending: T | undefined;
  let timer: unknown;
  let closed = false;
  const flush = () => {
    timer = undefined;
    if (closed || pending === undefined) return;
    const value = pending;
    pending = undefined;
    lastCommit = input.now();
    input.commit(value);
  };
  const requestCommit = () => {
    if (timer !== undefined || pending === undefined) return;
    const interval = representationCadence(mode).intervalMilliseconds;
    const elapsed =
      lastCommit === undefined ? interval : input.now() - lastCommit;
    if (elapsed >= interval) flush();
    else timer = input.setTimer(flush, interval - elapsed);
  };
  return Object.freeze({
    publish(value: T) {
      if (closed) return;
      pending = value;
      requestCommit();
    },
    setMode(next: RepresentationMode) {
      if (closed || next === mode) return;
      mode = next;
      if (timer !== undefined) {
        input.cancel(timer);
        timer = undefined;
      }
      requestCommit();
    },
    close() {
      closed = true;
      pending = undefined;
      if (timer !== undefined) input.cancel(timer);
      timer = undefined;
    },
  });
}
