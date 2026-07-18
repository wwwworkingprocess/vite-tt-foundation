export interface BrowserPacingPrimitives {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  now(): number;
  isHidden(): boolean;
  addVisibilityListener(callback: () => void): void;
  removeVisibilityListener(callback: () => void): void;
  maxPulseMicroseconds: number;
}
export function createBrowserPacingDriver(api: BrowserPacingPrimitives) {
  if (
    !Number.isSafeInteger(api.maxPulseMicroseconds) ||
    api.maxPulseMicroseconds <= 0
  )
    throw new Error('maxPulseMicroseconds must be a positive safe integer.');
  let active = false,
    closed = false,
    frame: number | undefined,
    baseline: number | undefined,
    inFlight = false;
  let pulse: ((elapsed: number) => Promise<void>) | undefined;
  const schedule = () => {
    if (
      active &&
      !closed &&
      !api.isHidden() &&
      !inFlight &&
      frame === undefined
    )
      frame = api.requestFrame(onFrame);
  };
  const onFrame = () => {
    frame = undefined;
    if (!active || closed || api.isHidden()) {
      baseline = undefined;
      return;
    }
    const now = api.now();
    if (baseline === undefined) {
      baseline = now;
      schedule();
      return;
    }
    const elapsed = Math.min(
      api.maxPulseMicroseconds,
      Math.max(0, Math.floor((now - baseline) * 1000)),
    );
    baseline = now;
    if (elapsed > 0 && !inFlight && pulse) {
      inFlight = true;
      let operation: Promise<void>;
      try {
        operation = pulse(elapsed);
      } catch {
        operation = Promise.resolve();
      }
      void operation
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          schedule();
        });
    } else schedule();
  };
  const visibility = () => {
    baseline = undefined;
    if (api.isHidden() && frame !== undefined) {
      api.cancelFrame(frame);
      frame = undefined;
    }
    schedule();
  };
  api.addVisibilityListener(visibility);
  return Object.freeze({
    start(next: (elapsed: number) => Promise<void>) {
      if (closed) throw new Error('Driver is closed.');
      pulse = next;
      active = true;
      baseline = undefined;
      schedule();
    },
    stop() {
      active = false;
      baseline = undefined;
      if (frame !== undefined) {
        api.cancelFrame(frame);
        frame = undefined;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      active = false;
      if (frame !== undefined) api.cancelFrame(frame);
      frame = undefined;
      api.removeVisibilityListener(visibility);
    },
  });
}
export function createDefaultBrowserPacingDriver() {
  return createBrowserPacingDriver({
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
    isHidden: () => document.hidden,
    addVisibilityListener: (callback) =>
      document.addEventListener('visibilitychange', callback),
    removeVisibilityListener: (callback) =>
      document.removeEventListener('visibilitychange', callback),
    maxPulseMicroseconds: 250_000,
  });
}
