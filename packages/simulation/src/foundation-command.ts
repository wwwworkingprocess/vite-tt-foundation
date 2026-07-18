import { z } from 'zod';

import { advanceTicks, type FoundationState } from './foundation-state.js';
import { parseTickAdvancement } from './time.js';

const foundationCommandSchema = z.strictObject({
  type: z.literal('foundation.advance-ticks'),
  count: z.number().int().nonnegative().safe(),
});

export interface AdvanceFoundationTicksCommand {
  readonly type: 'foundation.advance-ticks';
  readonly count: ReturnType<typeof parseTickAdvancement>;
}

export type FoundationCommand = AdvanceFoundationTicksCommand;

export function parseFoundationCommand(value: unknown): FoundationCommand {
  const parsed = foundationCommandSchema.parse(value);
  return Object.freeze({
    type: parsed.type,
    count: parseTickAdvancement(parsed.count),
  });
}

export function applyFoundationCommand(
  state: FoundationState,
  command: FoundationCommand,
): FoundationState {
  return advanceTicks(state, command.count);
}
