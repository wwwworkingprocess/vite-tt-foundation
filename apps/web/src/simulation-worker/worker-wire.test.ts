import { expect, it } from 'vitest';
import { foundationWorkerWireSchemaVersion } from './worker-wire.js';
it('exports the Worker wire schema version', () =>
  expect(foundationWorkerWireSchemaVersion).toBe(1));
