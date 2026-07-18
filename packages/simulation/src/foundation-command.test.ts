import { describe, expect, it } from 'vitest';

import {
  applyFoundationCommand,
  createFoundationState,
  parseFoundationCommand,
  parseSimulationTick,
} from './index.js';

describe('foundation command', () => {
  it('parses and immutably applies whole-tick advancement', () => {
    const initial = createFoundationState(parseSimulationTick(7));
    const command = parseFoundationCommand({
      type: 'foundation.advance-ticks',
      count: 5,
    });

    const result = applyFoundationCommand(initial, command);

    expect(result).toEqual({ tick: 12 });
    expect(result).not.toBe(initial);
    expect(initial).toEqual({ tick: 7 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('accepts zero advancement without changing the immutable value', () => {
    const initial = createFoundationState(parseSimulationTick(3));
    const result = applyFoundationCommand(
      initial,
      parseFoundationCommand({ type: 'foundation.advance-ticks', count: 0 }),
    );

    expect(result).toEqual(initial);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects invalid advancement %s',
    (count) =>
      expect(() =>
        parseFoundationCommand({
          type: 'foundation.advance-ticks',
          count,
        }),
      ).toThrow(),
  );

  it('rejects advancement that would overflow the simulation tick', () => {
    const initial = createFoundationState(
      parseSimulationTick(Number.MAX_SAFE_INTEGER),
    );

    expect(() =>
      applyFoundationCommand(
        initial,
        parseFoundationCommand({ type: 'foundation.advance-ticks', count: 1 }),
      ),
    ).toThrow();
  });

  it('is deterministic for equivalent batching', () => {
    const initial = createFoundationState(parseSimulationTick(0));
    const once = applyFoundationCommand(
      initial,
      parseFoundationCommand({ type: 'foundation.advance-ticks', count: 8 }),
    );
    const twice = applyFoundationCommand(
      applyFoundationCommand(
        initial,
        parseFoundationCommand({ type: 'foundation.advance-ticks', count: 3 }),
      ),
      parseFoundationCommand({ type: 'foundation.advance-ticks', count: 5 }),
    );

    expect(twice).toEqual(once);
  });
});
