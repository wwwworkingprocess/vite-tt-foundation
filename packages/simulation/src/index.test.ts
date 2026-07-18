import { describe, expect, it } from 'vitest';
import {
  foundationSimulationSnapshotSchemaVersion,
  simulationFoundationLabel,
} from './index.js';

describe('simulation foundation', () => {
  it('has no runtime platform requirements', () =>
    expect(simulationFoundationLabel).toBe('standalone simulation package'));
  it('exports the snapshot schema version', () =>
    expect(foundationSimulationSnapshotSchemaVersion).toBe(1));
});
