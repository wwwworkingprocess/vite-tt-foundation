import { describe, expect, it } from 'vitest';
import {
  createFoundationSimulationSnapshot,
  createFoundationState,
  parseFoundationSimulationSnapshot,
  parseSimulationTick,
  restoreFoundationState,
} from './index.js';

describe('foundation simulation snapshot', () => {
  it('round-trips exact state through JSON as deeply immutable data', () => {
    const snapshot = createFoundationSimulationSnapshot(
      createFoundationState(parseSimulationTick(42)),
    );
    const parsed = parseFoundationSimulationSnapshot(
      JSON.parse(JSON.stringify(snapshot)),
    );
    expect(parsed).toEqual(snapshot);
    expect(restoreFoundationState(parsed)).toEqual({ tick: 42 });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.state)).toBe(true);
  });

  it.each([
    {},
    {
      kind: 'foundation-simulation-snapshot',
      schemaVersion: 2,
      simulationVersion: 'foundation-1',
      state: { tick: 0 },
    },
    {
      kind: 'foundation-simulation-snapshot',
      schemaVersion: 1,
      simulationVersion: 'other',
      state: { tick: 0 },
    },
    {
      kind: 'foundation-simulation-snapshot',
      schemaVersion: 1,
      simulationVersion: 'foundation-1',
      state: { tick: -1 },
    },
    {
      kind: 'foundation-simulation-snapshot',
      schemaVersion: 1,
      simulationVersion: 'foundation-1',
      state: { tick: Number.MAX_SAFE_INTEGER + 1 },
    },
  ])('rejects malformed or unsupported snapshots', (value) => {
    expect(() => parseFoundationSimulationSnapshot(value)).toThrow();
  });
});
