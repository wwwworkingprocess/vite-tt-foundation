import { describe, expect, it } from 'vitest';
import {
  planPacing,
  defaultPlaybackProfile,
  resolveEffectiveRate,
} from './pacing-plan.js';

const input = (
  rate: 'normal' | 'fast' | 'maximum',
  elapsed = 1_000_000,
  bonus = 0,
) => ({
  simulationTick: 0,
  elapsedPacingMicroseconds: elapsed,
  creditGameMicroseconds: 0,
  mode: rate,
  profile: defaultPlaybackProfile,
  remainingDoubleSpeedBonusTicks: bonus,
});
describe('pure pacing planner', () => {
  it('resolves quiet and bonus effective rates exactly', () => {
    const rate = (simulationTick: number, bonus: number) =>
      resolveEffectiveRate({
        mode: 'normal',
        simulationTick,
        profile: defaultPlaybackProfile,
        remainingDoubleSpeedBonusTicks: bonus,
      });
    expect(rate(1440, 0)).toBe(60);
    expect(rate(1440, 1)).toBe(120);
    expect(rate(3600, 0)).toBe(20);
    expect(rate(3600, 1)).toBe(40);
  });
  it.each([
    ['normal', 4],
    ['fast', 10],
    ['maximum', 12],
  ] as const)('%s advances whole ticks', (mode, ticks) => {
    const plan = planPacing(input(mode));
    expect(plan.advancedTicks).toBe(ticks);
    expect(plan.bonusTicksAdvanced + plan.regularTicksAdvanced).toBe(ticks);
  });
  it('handles 120x bonus and exact mid-interval expiry', () => {
    expect(planPacing(input('maximum', 1_000_000, 100)).advancedTicks).toBe(24);
    expect(planPacing(input('normal', 1_000_000, 2))).toMatchObject({
      advancedTicks: 5,
      bonusTicksAdvanced: 2,
      regularTicksAdvanced: 3,
      remainingDoubleSpeedBonusTicks: 0,
    });
  });
  it('preserves partial credit and pause and is partition equivalent', () => {
    const first = planPacing(input('normal', 100_000));
    const second = planPacing({
      ...input('normal', 900_000),
      simulationTick: first.nextSimulationTick,
      creditGameMicroseconds: first.nextCreditGameMicroseconds,
    });
    expect(first.advancedTicks + second.advancedTicks).toBe(4);
    expect(
      planPacing({
        ...input('normal'),
        mode: 'paused',
        creditGameMicroseconds: 123,
      }),
    ).toMatchObject({ advancedTicks: 0, nextCreditGameMicroseconds: 123 });
  });
  it('applies quiet normal rate at exact boundaries including wrapping windows', () => {
    const quiet = {
      ...defaultPlaybackProfile,
      quietStartTickOfDay: 1,
      quietEndTickOfDay: 100,
    };
    expect(
      planPacing({ ...input('normal'), simulationTick: 1, profile: quiet })
        .advancedTicks,
    ).toBe(12);
    const wrapping = {
      ...quiet,
      quietStartTickOfDay: 17_000,
      quietEndTickOfDay: 10,
    };
    expect(
      planPacing({
        ...input('normal'),
        simulationTick: 17_279,
        profile: wrapping,
      }).advancedTicks,
    ).toBeGreaterThan(4);
    expect(
      planPacing({ ...input('normal'), simulationTick: 100, profile: wrapping })
        .advancedTicks,
    ).toBe(4);
  });
  it('rejects unsafe and invalid inputs', () => {
    expect(() =>
      planPacing({ ...input('normal'), elapsedPacingMicroseconds: -1 }),
    ).toThrow();
    expect(() =>
      planPacing({ ...input('normal'), creditGameMicroseconds: 5_000_000 }),
    ).toThrow();
    expect(() =>
      planPacing({
        ...input('normal'),
        simulationTick: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow();
    expect(() =>
      planPacing({
        ...input('normal'),
        profile: { ...defaultPlaybackProfile, normalRate: 0 },
      }),
    ).toThrow();
    expect(() =>
      planPacing({ ...input('normal'), remainingDoubleSpeedBonusTicks: -1 }),
    ).toThrow();
    expect(() =>
      planPacing({
        ...input('normal'),
        profile: { ...defaultPlaybackProfile, quietEndTickOfDay: 17_280 },
      }),
    ).toThrow();
    expect(() =>
      planPacing({
        ...input('normal'),
        profile: {
          ...defaultPlaybackProfile,
          maximumRate: Number.MAX_SAFE_INTEGER,
        },
      }),
    ).toThrow();
    expect(() =>
      planPacing({
        ...input('normal'),
        elapsedPacingMicroseconds: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow();
  });
});
