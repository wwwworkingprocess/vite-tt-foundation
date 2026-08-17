import { describe, expect, it, vi } from 'vitest';
import {
  createRepresentationFrameDriver,
  createLatestRepresentationThrottle,
  representationCadence,
} from './representation-cadence.js';

describe('shared representation cadence', () => {
  const scheduler = () => {
    let now = 0;
    let sequence = 0;
    const tasks = new Map<
      number,
      Readonly<{ at: number; callback: () => void }>
    >();
    return {
      now: () => now,
      setTimer(callback: () => void, delay: number) {
        const handle = ++sequence;
        tasks.set(handle, { at: now + delay, callback });
        return handle;
      },
      cancel: (handle: unknown) => tasks.delete(handle as number),
      advanceTo(target: number) {
        while (true) {
          const next = [...tasks.entries()].sort(
            ([leftId, left], [rightId, right]) =>
              left.at - right.at || leftId - rightId,
          )[0];
          if (!next || next[1].at > target) break;
          tasks.delete(next[0]);
          now = next[1].at;
          next[1].callback();
        }
        now = target;
      },
    };
  };
  it('defines the exact mini and normal target rates', () => {
    expect(representationCadence('mini')).toEqual({
      mode: 'mini',
      targetFramesPerSecond: 5,
      intervalMilliseconds: 200,
    });
    expect(representationCadence('normal')).toEqual({
      mode: 'normal',
      targetFramesPerSecond: 60,
      intervalMilliseconds: 1000 / 60,
    });
  });

  it('coalesces pending publications and always commits the latest value', () => {
    vi.useFakeTimers();
    const commits: string[] = [];
    const throttle = createLatestRepresentationThrottle<string>({
      mode: 'mini',
      now: () => Date.now(),
      setTimer: (callback, delay) => setTimeout(callback, delay),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      commit: (value) => commits.push(value),
    });
    throttle.publish('A');
    throttle.publish('B');
    throttle.publish('C');
    expect(commits).toEqual(['A']);
    vi.advanceTimersByTime(200);
    expect(commits).toEqual(['A', 'C']);
    throttle.setMode('normal');
    throttle.publish('D');
    vi.advanceTimersByTime(17);
    expect(commits.at(-1)).toBe('D');
    throttle.close();
    vi.useRealTimers();
  });

  it('does not exceed the configured mini cadence', () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const throttle = createLatestRepresentationThrottle<number>({
      mode: 'mini',
      now: () => Date.now(),
      setTimer: (callback, delay) => setTimeout(callback, delay),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      commit: (value) => commits.push(value),
    });
    throttle.publish(1);
    throttle.publish(2);
    vi.advanceTimersByTime(199);
    expect(commits).toEqual([1]);
    throttle.publish(3);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([1, 3]);
    throttle.close();
    vi.useRealTimers();
  });

  it('reduces the allowed cadence when switching from normal to mini', () => {
    vi.useFakeTimers();
    const commits: string[] = [];
    const throttle = createLatestRepresentationThrottle<string>({
      mode: 'normal',
      now: () => Date.now(),
      setTimer: (callback, delay) => setTimeout(callback, delay),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      commit: (value) => commits.push(value),
    });
    throttle.publish('A');
    vi.advanceTimersByTime(17);
    throttle.publish('B');
    expect(commits).toEqual(['A', 'B']);
    throttle.setMode('mini');
    throttle.publish('C');
    vi.advanceTimersByTime(199);
    expect(commits).toEqual(['A', 'B']);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual(['A', 'B', 'C']);
    throttle.close();
    vi.useRealTimers();
  });

  it.each([
    ['mini', 200, 5],
    ['normal', 1000 / 60, 60],
  ] as const)(
    'drives R3F %s frames at the shared ceiling',
    (mode, interval, expectedFrames) => {
      const clock = scheduler();
      const frames: number[] = [];
      const driver = createRepresentationFrameDriver({
        mode,
        now: clock.now,
        setTimer: clock.setTimer,
        cancel: clock.cancel,
        frame: (time) => frames.push(time),
      });
      clock.advanceTo(interval * expectedFrames - 0.000_001);
      expect(frames).toHaveLength(expectedFrames - 1);
      clock.advanceTo(interval * expectedFrames + 0.000_001);
      expect(frames).toHaveLength(expectedFrames);
      expect(frames.at(-1)).toBeCloseTo(1000, 8);
      driver.close();
      clock.advanceTo(2000);
      expect(frames).toHaveLength(expectedFrames);
    },
  );

  it('changes only the R3F frame cadence when its mode changes', () => {
    const clock = scheduler();
    const frames: number[] = [];
    const driver = createRepresentationFrameDriver({
      mode: 'mini',
      now: clock.now,
      setTimer: clock.setTimer,
      cancel: clock.cancel,
      frame: (time) => frames.push(time),
    });
    clock.advanceTo(200);
    expect(frames).toEqual([200]);
    driver.setMode('normal');
    clock.advanceTo(216);
    expect(frames).toEqual([200]);
    clock.advanceTo(217);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toBeCloseTo(216.666_666_667, 8);
    driver.close();
  });

  it('handles mode changes and closure from inside a requested frame', () => {
    const clock = scheduler();
    const frames: number[] = [];
    const driver = createRepresentationFrameDriver({
      mode: 'mini',
      now: clock.now,
      setTimer: clock.setTimer,
      cancel: clock.cancel,
      frame: (time) => {
        frames.push(time);
        if (frames.length === 1) driver.setMode('normal');
        else driver.close();
      },
    });
    driver.setMode('mini');
    clock.advanceTo(217);
    expect(frames).toHaveLength(2);
    driver.setMode('mini');
    clock.advanceTo(1000);
    expect(frames).toHaveLength(2);
  });

  it('ignores a defensively delivered frame after cancellation', () => {
    let callback: () => void = () => undefined;
    const frames: number[] = [];
    const driver = createRepresentationFrameDriver({
      mode: 'mini',
      now: () => 200,
      setTimer: (next) => {
        callback = next;
        return 1;
      },
      cancel: () => undefined,
      frame: (time) => frames.push(time),
    });
    driver.close();
    callback();
    expect(frames).toEqual([]);
  });

  it('cancels a pending latest-state publication during a mode change', () => {
    const clock = scheduler();
    const commits: string[] = [];
    const throttle = createLatestRepresentationThrottle({
      mode: 'mini',
      now: clock.now,
      setTimer: clock.setTimer,
      cancel: clock.cancel,
      commit: (value: string) => commits.push(value),
    });
    throttle.publish('A');
    throttle.publish('B');
    throttle.setMode('normal');
    clock.advanceTo(17);
    expect(commits).toEqual(['A', 'B']);
    throttle.close();
    throttle.publish('C');
    throttle.setMode('mini');
    expect(commits).toEqual(['A', 'B']);
  });

  it('ignores a defensively delivered publication after closure', () => {
    let callback: () => void = () => undefined;
    const commits: string[] = [];
    const throttle = createLatestRepresentationThrottle({
      mode: 'mini',
      now: () => 0,
      setTimer: (next) => {
        callback = next;
        return 1;
      },
      cancel: () => undefined,
      commit: (value: string) => commits.push(value),
    });
    throttle.publish('A');
    throttle.publish('B');
    throttle.close();
    callback();
    expect(commits).toEqual(['A']);
  });
});
