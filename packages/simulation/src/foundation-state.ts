import {
  parseSimulationTick,
  type SimulationTick,
  type TickAdvancement,
} from './time.js';

export interface FoundationState {
  readonly tick: SimulationTick;
}

export function createFoundationState(tick: SimulationTick): FoundationState {
  return Object.freeze({ tick });
}

export function advanceTicks(
  state: FoundationState,
  count: TickAdvancement,
): FoundationState {
  return createFoundationState(parseSimulationTick(state.tick + count));
}
