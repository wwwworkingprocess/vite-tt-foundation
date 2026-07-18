import { z } from 'zod';

export const GAME_SECONDS_PER_TICK = 5 as const;
export const GAME_MILLISECONDS_PER_TICK = 5_000 as const;
export const TICKS_PER_GAME_MINUTE = 12 as const;
export const TICKS_PER_GAME_HOUR = 720 as const;
export const TICKS_PER_GAME_DAY = 17_280 as const;

const simulationTickSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .brand<'SimulationTick'>();
const tickAdvancementSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .brand<'TickAdvancement'>();
const genesisUtcMsSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .refine(
    (value) => value % 1_000 === 0,
    'Genesis UTC milliseconds must align to an exact second.',
  )
  .brand<'GenesisUtcMs'>();
const utcInstantSchema = z.number().int().safe();

export type SimulationTick = z.infer<typeof simulationTickSchema>;
export type TickAdvancement = z.infer<typeof tickAdvancementSchema>;
export type GenesisUtcMs = z.infer<typeof genesisUtcMsSchema>;
export type GameSecond =
  0 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55;

export interface DerivedGameTime {
  readonly dayIndex: number;
  readonly tickOfDay: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: GameSecond;
}

export function parseSimulationTick(value: unknown): SimulationTick {
  return simulationTickSchema.parse(value);
}

export function parseTickAdvancement(value: unknown): TickAdvancement {
  return tickAdvancementSchema.parse(value);
}

export function parseGenesisUtcMs(value: unknown): GenesisUtcMs {
  return genesisUtcMsSchema.parse(value);
}

export function deriveGameTime(tick: SimulationTick): DerivedGameTime {
  const tickOfDay = tick % TICKS_PER_GAME_DAY;
  const tickOfHour = tickOfDay % TICKS_PER_GAME_HOUR;
  const tickOfMinute = tickOfHour % TICKS_PER_GAME_MINUTE;

  return {
    dayIndex: Math.floor(tick / TICKS_PER_GAME_DAY),
    tickOfDay,
    hour: Math.floor(tickOfDay / TICKS_PER_GAME_HOUR),
    minute: Math.floor(tickOfHour / TICKS_PER_GAME_MINUTE),
    second: toGameSecond(tickOfMinute * GAME_SECONDS_PER_TICK),
  };
}

export function tickToUtcMs(
  tick: SimulationTick,
  genesisUtcMs: GenesisUtcMs,
): number {
  return utcInstantSchema.parse(
    genesisUtcMs + tick * GAME_MILLISECONDS_PER_TICK,
  );
}

export function utcMsToTick(
  utcMs: unknown,
  genesisUtcMs: GenesisUtcMs,
): SimulationTick {
  const instant = utcInstantSchema.parse(utcMs);
  const difference = instant - genesisUtcMs;

  if (difference < 0) {
    throw new RangeError('UTC instant must not be before genesis.');
  }
  if (difference % GAME_MILLISECONDS_PER_TICK !== 0) {
    throw new RangeError(
      'UTC instant must be aligned to a five-second tick boundary.',
    );
  }

  return parseSimulationTick(difference / GAME_MILLISECONDS_PER_TICK);
}

function toGameSecond(value: number): GameSecond {
  switch (value) {
    case 0:
    case 5:
    case 10:
    case 15:
    case 20:
    case 25:
    case 30:
    case 35:
    case 40:
    case 45:
    case 50:
    case 55:
      return value;
    default:
      throw new RangeError(
        'Derived seconds must align to the five-second tick boundary.',
      );
  }
}
