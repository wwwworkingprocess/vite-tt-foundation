import { z } from 'zod';
import {
  createFoundationState,
  type FoundationState,
} from './foundation-state.js';
import { parseSimulationTick, type SimulationTick } from './time.js';

const schema = z.strictObject({
  kind: z.literal('foundation-simulation-snapshot'),
  schemaVersion: z.literal(1),
  simulationVersion: z.literal('foundation-1'),
  state: z.strictObject({ tick: z.number().int().nonnegative().safe() }),
});

export interface FoundationSimulationSnapshot {
  readonly kind: 'foundation-simulation-snapshot';
  readonly schemaVersion: 1;
  readonly simulationVersion: 'foundation-1';
  readonly state: Readonly<{ readonly tick: SimulationTick }>;
}

export function parseFoundationSimulationSnapshot(
  value: unknown,
): FoundationSimulationSnapshot {
  const parsed = schema.parse(value);
  const state = Object.freeze({ tick: parseSimulationTick(parsed.state.tick) });
  return Object.freeze({ ...parsed, state });
}

export function createFoundationSimulationSnapshot(
  state: FoundationState,
): FoundationSimulationSnapshot {
  return parseFoundationSimulationSnapshot({
    kind: 'foundation-simulation-snapshot',
    schemaVersion: 1,
    simulationVersion: 'foundation-1',
    state: { tick: state.tick },
  });
}

export function restoreFoundationState(
  snapshot: FoundationSimulationSnapshot,
): FoundationState {
  return createFoundationState(
    parseFoundationSimulationSnapshot(snapshot).state.tick,
  );
}
