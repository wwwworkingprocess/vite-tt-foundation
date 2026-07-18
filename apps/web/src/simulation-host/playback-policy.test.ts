import { describe, expect, it } from 'vitest';

import {
  NORMAL_PLAYBACK_RATE,
  SPEED_BONUS_MULTIPLIER,
  calculatePlaybackDecision,
  consumeSpeedBonusForAdvancedTicks,
  durationSeconds,
  parseRemainingSimulationTicks,
} from './playback-policy.js';
import {
  advanceTicks,
  createFoundationState,
  parseSimulationTick,
  parseTickAdvancement,
} from '@torrevieja-tycoon/simulation';

describe('playback decisions', () => {
  it('distinguishes paused, normal, and configurable quiet-period playback', () => {
    expect(calculatePlaybackDecision({ paused: true })).toMatchObject({
      baseRate: NORMAL_PLAYBACK_RATE,
      effectiveRate: 0,
      reason: 'paused',
    });
    expect(calculatePlaybackDecision({ paused: false })).toMatchObject({
      baseRate: 20,
      effectiveRate: 20,
      reason: 'selected-mode',
    });
    expect(
      calculatePlaybackDecision({ paused: false, quietPeriodRate: 50 }),
    ).toMatchObject({
      baseRate: 50,
      effectiveRate: 50,
      reason: 'quiet-period',
    });
    expect(
      calculatePlaybackDecision({ paused: false, quietPeriodRate: 60 }),
    ).toMatchObject({
      baseRate: 60,
      effectiveRate: 60,
      reason: 'quiet-period',
    });
  });

  it('applies a temporary 2x multiplier only while bonus ticks remain', () => {
    expect(SPEED_BONUS_MULTIPLIER).toBe(2);
    expect(
      calculatePlaybackDecision({
        paused: false,
        bonus: {
          multiplier: 2,
          remainingSimulationTicks: parseRemainingSimulationTicks(720),
        },
      }),
    ).toMatchObject({
      baseRate: 20,
      multiplier: 2,
      effectiveRate: 40,
      reason: 'temporary-speed-bonus',
    });
    expect(
      calculatePlaybackDecision({
        paused: false,
        quietPeriodRate: 60,
        bonus: {
          multiplier: 2,
          remainingSimulationTicks: parseRemainingSimulationTicks(1),
        },
      }),
    ).toMatchObject({ baseRate: 60, multiplier: 2, effectiveRate: 120 });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid active playback rate %s', (rate) =>
    expect(() =>
      calculatePlaybackDecision({ paused: false, quietPeriodRate: rate }),
    ).toThrow(),
  );
});

describe('speed bonus advancement', () => {
  it('preserves the remaining bonus when zero ticks were advanced', () => {
    const result = consumeSpeedBonusForAdvancedTicks({
      advancedTicks: parseTickAdvancement(0),
      bonus: {
        multiplier: 2,
        remainingSimulationTicks: parseRemainingSimulationTicks(6),
      },
    });
    expect(result).toEqual({
      bonusTicksAdvanced: 0,
      regularTicksAdvanced: 0,
      remainingSimulationTicks: 6,
    });
  });

  it('fully classifies non-zero advanced ticks across bonus expiry', () => {
    const withinBonus = consumeSpeedBonusForAdvancedTicks({
      advancedTicks: parseTickAdvancement(4),
      bonus: {
        multiplier: 2,
        remainingSimulationTicks: parseRemainingSimulationTicks(6),
      },
    });
    expect(withinBonus).toEqual({
      bonusTicksAdvanced: 4,
      regularTicksAdvanced: 0,
      remainingSimulationTicks: 2,
    });
    expect(
      withinBonus.bonusTicksAdvanced + withinBonus.regularTicksAdvanced,
    ).toBe(4);

    const acrossExpiry = consumeSpeedBonusForAdvancedTicks({
      advancedTicks: parseTickAdvancement(10),
      bonus: {
        multiplier: 2,
        remainingSimulationTicks: parseRemainingSimulationTicks(6),
      },
    });
    expect(acrossExpiry).toEqual({
      bonusTicksAdvanced: 6,
      regularTicksAdvanced: 4,
      remainingSimulationTicks: 0,
    });
    expect(
      acrossExpiry.bonusTicksAdvanced + acrossExpiry.regularTicksAdvanced,
    ).toBe(10);
  });

  it('advances all requested ticks normally without an active bonus', () => {
    expect(
      consumeSpeedBonusForAdvancedTicks({
        advancedTicks: parseTickAdvancement(7),
      }),
    ).toEqual({
      bonusTicksAdvanced: 0,
      regularTicksAdvanced: 7,
      remainingSimulationTicks: 0,
    });
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid remaining tick count %s', (value) =>
    expect(() => parseRemainingSimulationTicks(value)).toThrow(),
  );
});

describe('bonus duration', () => {
  it.each([
    [720, 20, 180],
    [720, 40, 90],
    [1_440, 40, 180],
  ])('%i ticks at %ix lasts %i seconds', (ticks, rate, expected) => {
    expect(durationSeconds(parseRemainingSimulationTicks(ticks), rate)).toBe(
      expected,
    );
  });

  it('cannot alter authoritative foundation results', () => {
    const initial = createFoundationState(parseSimulationTick(0));
    const ticks = parseTickAdvancement(20);
    const withoutPlayback = advanceTicks(initial, ticks);

    calculatePlaybackDecision({ paused: false, quietPeriodRate: 60 });
    consumeSpeedBonusForAdvancedTicks({
      advancedTicks: ticks,
      bonus: {
        multiplier: 2,
        remainingSimulationTicks: parseRemainingSimulationTicks(5),
      },
    });

    expect(advanceTicks(initial, ticks)).toEqual(withoutPlayback);
  });
});
