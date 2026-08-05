import { expect, it } from 'vitest';
import { createBrowserPacingDriver } from './browser-pacing-driver.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

it('drives one pulse at a time, resets hidden time, caps elapsed, and closes', async () => {
  let callback: FrameRequestCallback | undefined;
  let now = 0;
  let hidden = false;
  let visibility: (() => void) | undefined;
  const elapsed: number[] = [];
  const driver = createBrowserPacingDriver({
    requestFrame: (next) => {
      callback = next;
      return 1;
    },
    cancelFrame: () => {
      callback = undefined;
    },
    now: () => now,
    isHidden: () => hidden,
    addVisibilityListener: (next) => {
      visibility = next;
    },
    removeVisibilityListener: () => {
      visibility = undefined;
    },
    maxPulseMicroseconds: 500_000,
  });
  driver.start(async (value) => {
    elapsed.push(value);
  });
  callback?.(0);
  now = 100;
  callback?.(100);
  await Promise.resolve();
  await Promise.resolve();
  expect(elapsed).toEqual([100_000]);
  const staleFrame = callback;
  hidden = true;
  visibility?.();
  staleFrame?.(100);
  now = 10_000;
  hidden = false;
  visibility?.();
  callback?.(10_000);
  expect(elapsed).toHaveLength(1);
  now = 20_000;
  callback?.(20_000);
  await Promise.resolve();
  await Promise.resolve();
  expect(elapsed.at(-1)).toBe(500_000);
  driver.close();
  driver.close();
  expect(visibility).toBeUndefined();
  expect(() => driver.start(async () => undefined)).toThrow('closed');
});

it('stops and restarts without duplicate loops', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = 0;
  let visibility: (() => void) | undefined;
  const driver = createBrowserPacingDriver({
    requestFrame: (cb) => {
      const next = ++id;
      frames.set(next, cb);
      return next;
    },
    cancelFrame: (next) => {
      frames.delete(next);
    },
    now: () => now,
    isHidden: () => false,
    addVisibilityListener: (cb) => {
      visibility = cb;
    },
    removeVisibilityListener: () => {
      visibility = undefined;
    },
    maxPulseMicroseconds: 1_000_000,
  });
  const values: number[] = [];
  driver.start(async (value) => {
    values.push(value);
  });
  expect(frames.size).toBe(1);
  driver.stop();
  expect(frames.size).toBe(0);
  driver.start(async (value) => {
    values.push(value);
  });
  const first = [...frames.values()][0];
  first?.(0);
  now = 10;
  [...frames.values()][0]?.(10);
  await Promise.resolve();
  expect(values).toEqual([10_000]);
  driver.close();
  expect(visibility).toBeUndefined();
});

it('validates its cap, stays dormant while hidden, and recovers from pulse failures', async () => {
  const base = {
    cancelFrame: () => undefined,
    now: () => 0,
    isHidden: () => true,
    addVisibilityListener: () => undefined,
    removeVisibilityListener: () => undefined,
  };
  expect(() =>
    createBrowserPacingDriver({
      ...base,
      requestFrame: () => 1,
      maxPulseMicroseconds: 0,
    }),
  ).toThrow('positive safe integer');
  let scheduled = 0;
  const hidden = createBrowserPacingDriver({
    ...base,
    requestFrame: () => ++scheduled,
    maxPulseMicroseconds: 1,
  });
  hidden.start(async () => undefined);
  expect(scheduled).toBe(0);
  hidden.close();

  let callback: FrameRequestCallback | undefined;
  let now = 0;
  const driver = createBrowserPacingDriver({
    ...base,
    isHidden: () => false,
    now: () => now,
    requestFrame: (next) => {
      callback = next;
      return 1;
    },
    maxPulseMicroseconds: 1_000_000,
  });
  driver.start(() => {
    throw new Error('sync');
  });
  callback?.(0);
  now = 1;
  callback?.(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(callback).toBeDefined();
  driver.start(async () => {
    throw new Error('async');
  });
  callback?.(2);
  now = 3;
  callback?.(3);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(callback).toBeDefined();
  driver.close();
});

it('preserves capped active foreground time while a pulse is pending', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = 0;
  const pending = deferred();
  const values: number[] = [];
  const runFrame = (timestamp: number) => {
    const entry = [...frames.entries()][0];
    if (entry) {
      frames.delete(entry[0]);
      entry[1](timestamp);
    }
  };
  const driver = createBrowserPacingDriver({
    requestFrame: (callback) => {
      const next = ++id;
      frames.set(next, callback);
      return next;
    },
    cancelFrame: (frame) => {
      frames.delete(frame);
    },
    now: () => now,
    isHidden: () => false,
    addVisibilityListener: () => undefined,
    removeVisibilityListener: () => undefined,
    maxPulseMicroseconds: 250_000,
  });
  driver.start((elapsed) => {
    values.push(elapsed);
    return values.length === 1 ? pending.promise : Promise.resolve();
  });
  runFrame(0);
  now = 100;
  runFrame(100);
  expect(values).toEqual([100_000]);
  expect(frames.size).toBe(0);
  now = 500;
  expect(frames.size).toBe(0);
  pending.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(frames.size).toBe(1);
  runFrame(500);
  expect(values).toEqual([100_000, 250_000]);
  driver.close();
});

it('resets pending-pulse time across stop, hidden transitions, and close without duplicate loops', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = 0;
  let hidden = false;
  let visibility!: () => void;
  const first = deferred();
  const values: number[] = [];
  const runFrame = (timestamp: number) => {
    const entry = [...frames.entries()][0];
    if (entry) {
      frames.delete(entry[0]);
      entry[1](timestamp);
    }
  };
  const driver = createBrowserPacingDriver({
    requestFrame: (callback) => {
      const next = ++id;
      frames.set(next, callback);
      return next;
    },
    cancelFrame: (frame) => {
      frames.delete(frame);
    },
    now: () => now,
    isHidden: () => hidden,
    addVisibilityListener: (callback) => {
      visibility = callback;
    },
    removeVisibilityListener: () => undefined,
    maxPulseMicroseconds: 1_000_000,
  });
  driver.start((elapsed) => {
    values.push(elapsed);
    return first.promise;
  });
  runFrame(0);
  now = 10;
  runFrame(10);
  driver.stop();
  driver.start(async (elapsed) => {
    values.push(elapsed);
  });
  expect(frames.size).toBe(0);
  first.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(frames.size).toBe(1);
  now = 1000;
  runFrame(1000);
  now = 1010;
  runFrame(1010);
  expect(values).toEqual([10_000, 10_000]);

  const second = deferred();
  driver.start(() => second.promise);
  runFrame(1010);
  now = 1020;
  runFrame(1020);
  hidden = true;
  visibility();
  now = 5000;
  second.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(frames.size).toBe(0);
  hidden = false;
  visibility();
  expect(frames.size).toBe(1);
  runFrame(5000);
  now = 5010;
  runFrame(5010);
  expect(values.at(-1)).toBe(10_000);
  driver.close();
  await Promise.resolve();
  await Promise.resolve();
  expect(frames.size).toBe(0);
});

it('a pulse completing after close cannot recreate a frame loop', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = 0;
  const pending = deferred();
  const driver = createBrowserPacingDriver({
    requestFrame: (callback) => {
      const next = ++id;
      frames.set(next, callback);
      return next;
    },
    cancelFrame: (frame) => {
      frames.delete(frame);
    },
    now: () => now,
    isHidden: () => false,
    addVisibilityListener: () => undefined,
    removeVisibilityListener: () => undefined,
    maxPulseMicroseconds: 1_000_000,
  });
  const runFrame = (timestamp: number) => {
    const entry = [...frames.entries()][0];
    if (entry) {
      frames.delete(entry[0]);
      entry[1](timestamp);
    }
  };
  driver.start(() => pending.promise);
  runFrame(0);
  now = 10;
  runFrame(10);
  expect(frames.size).toBe(0);
  driver.close();
  pending.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(frames.size).toBe(0);
});

it('reschedules an exact-boundary frame without issuing a zero-duration pulse', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const now = 0;
  const elapsed: number[] = [];
  const driver = createBrowserPacingDriver({
    requestFrame: (callback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    now: () => now,
    isHidden: () => false,
    addVisibilityListener: () => undefined,
    removeVisibilityListener: () => undefined,
    maxPulseMicroseconds: 1_000_000,
  });
  const runFrame = () => {
    const entry = [...frames.entries()][0];
    expect(entry).toBeDefined();
    frames.delete(entry![0]);
    entry![1](now);
  };

  driver.start(async (value) => {
    elapsed.push(value);
  });
  runFrame();
  expect(frames.size).toBe(1);

  runFrame();
  expect(elapsed).toEqual([]);
  expect(frames.size).toBe(1);

  driver.close();
  expect(frames.size).toBe(0);
});
