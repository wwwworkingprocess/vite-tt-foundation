import { expect, it, vi } from 'vitest';
import { createD3dDirtyFrameDriver } from './d3d-dirty-frame.js';
it('coalesces dirty requests, respects cadence and schedules nothing while idle', () => {
  vi.useFakeTimers();
  const frame = vi.fn();
  const driver = createD3dDirtyFrameDriver({
    mode: 'normal',
    now: () => Date.now(),
    setTimer: (cb, delay) => setTimeout(cb, delay),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    frame,
  });
  expect(vi.getTimerCount()).toBe(0);
  driver.request();
  driver.request();
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(17);
  expect(frame).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(frame).toHaveBeenCalledTimes(1);
  driver.request();
  vi.advanceTimersByTime(1);
  expect(frame).toHaveBeenCalledTimes(2);
  driver.request();
  driver.close();
  driver.request();
  vi.advanceTimersByTime(1000);
  expect(frame).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
it('uses the mini ceiling and rejects a cancelled late timer without drawing', () => {
  let callback = () => {};
  const frame = vi.fn(),
    cancel = vi.fn();
  const driver = createD3dDirtyFrameDriver({
    mode: 'mini',
    now: () => 10,
    setTimer: (cb, delay) => {
      callback = cb;
      expect(delay).toBe(200);
      return 1;
    },
    cancel,
    frame,
  });
  driver.request();
  driver.close();
  callback();
  expect(cancel).toHaveBeenCalledWith(1);
  expect(frame).not.toHaveBeenCalled();
});
