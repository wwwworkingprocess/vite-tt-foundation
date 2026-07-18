import {
  GAME_SECONDS_PER_TICK,
  parseTickAdvancement,
  type TickAdvancement,
} from '@torrevieja-tycoon/simulation';
import { z } from 'zod';

export const NORMAL_PLAYBACK_RATE = 20 as const;
export const SPEED_BONUS_MULTIPLIER = 2 as const;

const playbackRateSchema = z.number().int().positive().safe();
const remainingSimulationTicksSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .brand<'RemainingSimulationTicks'>();

export type RemainingSimulationTicks = z.infer<
  typeof remainingSimulationTicksSchema
>;

export interface SpeedBonusState {
  readonly multiplier: typeof SPEED_BONUS_MULTIPLIER;
  readonly remainingSimulationTicks: RemainingSimulationTicks;
}

export interface PlaybackDecision {
  readonly baseRate: number;
  readonly multiplier: 1 | typeof SPEED_BONUS_MULTIPLIER;
  readonly effectiveRate: number;
  readonly reason:
    'paused' | 'selected-mode' | 'quiet-period' | 'temporary-speed-bonus';
}

export interface SpeedBonusConsumption {
  readonly bonusTicksAdvanced: TickAdvancement;
  readonly regularTicksAdvanced: TickAdvancement;
  readonly remainingSimulationTicks: RemainingSimulationTicks;
}

export function parseRemainingSimulationTicks(
  value: unknown,
): RemainingSimulationTicks {
  return remainingSimulationTicksSchema.parse(value);
}

export function calculatePlaybackDecision(input: {
  readonly paused: boolean;
  readonly quietPeriodRate?: number;
  readonly bonus?: SpeedBonusState;
}): PlaybackDecision {
  const baseRate =
    input.quietPeriodRate === undefined
      ? NORMAL_PLAYBACK_RATE
      : playbackRateSchema.parse(input.quietPeriodRate);

  if (input.paused) {
    return { baseRate, multiplier: 1, effectiveRate: 0, reason: 'paused' };
  }

  const hasBonus =
    input.bonus !== undefined && input.bonus.remainingSimulationTicks > 0;
  const multiplier = hasBonus ? SPEED_BONUS_MULTIPLIER : 1;
  const reason = hasBonus
    ? 'temporary-speed-bonus'
    : input.quietPeriodRate === undefined
      ? 'selected-mode'
      : 'quiet-period';

  return { baseRate, multiplier, effectiveRate: baseRate * multiplier, reason };
}

/**
 * Classifies whole simulation ticks that have already been advanced and
 * consumes the active bonus budget. This does not calculate how many ticks
 * are due during a pacing-clock interval.
 */
export function consumeSpeedBonusForAdvancedTicks(input: {
  readonly advancedTicks: TickAdvancement;
  readonly bonus?: SpeedBonusState;
}): SpeedBonusConsumption {
  const remaining =
    input.bonus?.remainingSimulationTicks ?? parseRemainingSimulationTicks(0);
  const bonusTicksAdvanced = parseTickAdvancement(
    Math.min(input.advancedTicks, remaining),
  );
  const regularTicksAdvanced = parseTickAdvancement(
    input.advancedTicks - bonusTicksAdvanced,
  );
  return {
    bonusTicksAdvanced,
    regularTicksAdvanced,
    remainingSimulationTicks: parseRemainingSimulationTicks(
      remaining - bonusTicksAdvanced,
    ),
  };
}

export function durationSeconds(
  bonusTicks: RemainingSimulationTicks,
  effectiveRate: number,
): number {
  const validatedRate = playbackRateSchema.parse(effectiveRate);
  return (bonusTicks * GAME_SECONDS_PER_TICK) / validatedRate;
}
