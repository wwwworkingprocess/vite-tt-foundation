import { expect, it } from 'vitest';
import { foundationWorkerAdapterContractVersion } from './worker-wire.js';
it('exports the Worker adapter contract version', () =>
  expect(foundationWorkerAdapterContractVersion).toBe(1));
