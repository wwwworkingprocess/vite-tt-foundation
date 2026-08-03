import { describe, expect, it } from 'vitest';

import {
  GAME_MILLISECONDS_PER_TICK,
  GAME_SECONDS_PER_TICK,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_GAME_MINUTE,
  advanceTicks,
  createFoundationState,
  deriveGameTime,
  parseGenesisUtcMs,
  parseSimulationTick,
  parseTickAdvancement,
  tickToUtcMs,
  utcMsToTick,
} from './index.js';

describe('simulation time', () => {
  it('uses exact five-second tick relationships', () => {
    expect(GAME_SECONDS_PER_TICK).toBe(5);
    expect(GAME_MILLISECONDS_PER_TICK).toBe(5_000);
    expect(TICKS_PER_GAME_MINUTE).toBe(12);
    expect(TICKS_PER_GAME_HOUR).toBe(TICKS_PER_GAME_MINUTE * 60);
    expect(TICKS_PER_GAME_DAY).toBe(TICKS_PER_GAME_HOUR * 24);
  });

  it.each([
    [0, { dayIndex: 0, tickOfDay: 0, hour: 0, minute: 0, second: 0 }],
    [12, { dayIndex: 0, tickOfDay: 12, hour: 0, minute: 1, second: 0 }],
    [720, { dayIndex: 0, tickOfDay: 720, hour: 1, minute: 0, second: 0 }],
    [
      17_279,
      { dayIndex: 0, tickOfDay: 17_279, hour: 23, minute: 59, second: 55 },
    ],
    [17_280, { dayIndex: 1, tickOfDay: 0, hour: 0, minute: 0, second: 0 }],
    [34_573, { dayIndex: 2, tickOfDay: 13, hour: 0, minute: 1, second: 5 }],
  ])('derives exact game time for tick %i', (value, expected) => {
    expect(deriveGameTime(parseSimulationTick(value))).toEqual(expected);
  });

  it('rejects an unparsed tick that cannot map to a canonical game second', () => {
    expect(() => deriveGameTime(0.5 as never)).toThrow(
      /five-second tick boundary/i,
    );
  });

  it('maps ticks and aligned UTC instants exactly in both directions', () => {
    const genesis = parseGenesisUtcMs(1_767_225_600_000);
    for (const value of [0, 1, 720, 17_280, 51_847]) {
      const tick = parseSimulationTick(value);
      const instant = tickToUtcMs(tick, genesis);
      expect(instant).toBe(1_767_225_600_000 + value * 5_000);
      expect(utcMsToTick(instant, genesis)).toBe(tick);
    }
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
    null,
  ])('rejects invalid tick value %s', (value) => {
    expect(() => parseSimulationTick(value)).toThrow();
    expect(() => parseTickAdvancement(value)).toThrow();
  });

  it('rejects invalid genesis and reverse conversions', () => {
    expect(() => parseGenesisUtcMs(-1_000)).toThrow();
    expect(() => parseGenesisUtcMs(1_000.5)).toThrow();
    expect(() => parseGenesisUtcMs(Number.NaN)).toThrow();
    expect(() => parseGenesisUtcMs(Number.MAX_SAFE_INTEGER + 1)).toThrow();

    const genesis = parseGenesisUtcMs(10_000);
    expect(() => utcMsToTick(9_999, genesis)).toThrow(/before genesis/i);
    expect(() => utcMsToTick(15_001, genesis)).toThrow(/aligned/i);
    expect(() => utcMsToTick(Number.POSITIVE_INFINITY, genesis)).toThrow();
  });

  it('rejects an unsafe UTC result', () => {
    const genesis = parseGenesisUtcMs(9_007_199_254_740_000);
    expect(() => tickToUtcMs(parseSimulationTick(1), genesis)).toThrow(
      /safe integer/i,
    );
  });
});

describe('foundation advancement', () => {
  it('supports zero and equivalent batched advancement without mutation or command revision', () => {
    const initial = createFoundationState(parseSimulationTick(7));
    const unchanged = advanceTicks(initial, parseTickAdvancement(0));
    const batched = advanceTicks(initial, parseTickAdvancement(9));
    const incremental = advanceTicks(
      advanceTicks(initial, parseTickAdvancement(4)),
      parseTickAdvancement(5),
    );

    expect(unchanged).toEqual(initial);
    expect(unchanged).not.toBe(initial);
    expect(batched).toEqual(incremental);
    expect(initial.tick).toBe(7);
    expect(Object.keys(initial)).toEqual(['tick']);
  });

  it('rejects advancement beyond the safe integer range', () => {
    const state = createFoundationState(
      parseSimulationTick(Number.MAX_SAFE_INTEGER),
    );
    expect(() => advanceTicks(state, parseTickAdvancement(1))).toThrow(
      /safe integer/i,
    );
  });
});
