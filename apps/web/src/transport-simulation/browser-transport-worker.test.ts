import { afterEach, expect, it, vi } from 'vitest';
import {
  createBrowserTransportWorker,
  isBrowserTransportWorkerAvailable,
} from './browser-transport-worker.js';

afterEach(() => vi.unstubAllGlobals());

it('constructs the dedicated transport Worker and reports availability', () => {
  const worker = { postMessage: vi.fn() };
  const Worker = vi.fn(function () {
    return worker;
  });
  vi.stubGlobal('Worker', Worker);
  expect(isBrowserTransportWorkerAvailable()).toBe(true);
  expect(createBrowserTransportWorker()).toBe(worker);
  expect(Worker).toHaveBeenCalledWith(expect.any(URL), {
    type: 'module',
    name: 'transport-simulation',
  });
  vi.unstubAllGlobals();
  expect(isBrowserTransportWorkerAvailable()).toBe(false);
});
