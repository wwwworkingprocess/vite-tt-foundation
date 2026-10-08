import {
  representationCadence,
  type RepresentationMode,
} from './representation-cadence.js';
/** Renderer lifecycle only. A request coalesces until the cadence ceiling permits
 * a frame. No timer remains after a clean frame; simulation is never advanced. */
export function createD3dDirtyFrameDriver(
  input: Readonly<{
    mode: RepresentationMode;
    now: () => number;
    setTimer: (callback: () => void, delay: number) => unknown;
    cancel: (handle: unknown) => void;
    frame: (time: number) => void;
  }>,
) {
  let timer: unknown;
  let closed = false;
  let lastFrame: number | undefined;
  return Object.freeze({
    request() {
      if (closed || timer !== undefined) return;
      const interval = representationCadence(input.mode).intervalMilliseconds;
      const delay =
        lastFrame === undefined
          ? interval
          : Math.max(0, interval - (input.now() - lastFrame));
      timer = input.setTimer(() => {
        timer = undefined;
        if (closed) return;
        lastFrame = input.now();
        input.frame(lastFrame);
      }, delay);
    },
    close() {
      closed = true;
      if (timer !== undefined) input.cancel(timer);
      timer = undefined;
    },
  });
}
