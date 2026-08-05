export type PlaybackMode = 'paused' | 'normal' | 'fast' | 'maximum';
export interface PlaybackProfile {
  readonly normalRate: number;
  readonly fastRate: number;
  readonly maximumRate: number;
  readonly quietNormalRate: number;
  readonly quietStartTickOfDay: number;
  readonly quietEndTickOfDay: number;
}
export const defaultPlaybackProfile: PlaybackProfile = Object.freeze({
  normalRate: 20,
  fastRate: 50,
  maximumRate: 60,
  quietNormalRate: 60,
  quietStartTickOfDay: 1440,
  quietEndTickOfDay: 3600,
});
const tickCredit = 5_000_000,
  ticksPerDay = 17_280;
const integer = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative safe integer.`);
  return value;
};
function quiet(tick: number, p: PlaybackProfile) {
  const value = tick % ticksPerDay;
  return p.quietStartTickOfDay <= p.quietEndTickOfDay
    ? value >= p.quietStartTickOfDay && value < p.quietEndTickOfDay
    : value >= p.quietStartTickOfDay || value < p.quietEndTickOfDay;
}
function validateProfile(p: PlaybackProfile) {
  for (const value of [
    p.normalRate,
    p.fastRate,
    p.maximumRate,
    p.quietNormalRate,
  ])
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      !Number.isSafeInteger(value * 2)
    )
      throw new Error(
        'Playback rates must be positive safe integers with safe doubled rates.',
      );
  for (const value of [p.quietStartTickOfDay, p.quietEndTickOfDay])
    if (!Number.isSafeInteger(value) || value < 0 || value >= ticksPerDay)
      throw new Error('Quiet-period boundaries must be within the game day.');
}
export function resolveEffectiveRate(input: {
  readonly mode: PlaybackMode;
  readonly simulationTick: number;
  readonly profile: PlaybackProfile;
  readonly remainingDoubleSpeedBonusTicks: number;
}) {
  validateProfile(input.profile);
  integer(input.simulationTick, 'simulationTick');
  integer(input.remainingDoubleSpeedBonusTicks, 'bonus');
  const { mode, simulationTick: tick, profile: p } = input;
  if (mode === 'paused') return 0;
  const selected =
    mode === 'fast'
      ? p.fastRate
      : mode === 'maximum'
        ? p.maximumRate
        : quiet(tick, p)
          ? p.quietNormalRate
          : p.normalRate;
  return selected * (input.remainingDoubleSpeedBonusTicks > 0 ? 2 : 1);
}
export function planPacing(input: {
  readonly simulationTick: number;
  readonly elapsedPacingMicroseconds: number;
  readonly creditGameMicroseconds: number;
  readonly mode: PlaybackMode;
  readonly profile: PlaybackProfile;
  readonly remainingDoubleSpeedBonusTicks: number;
}) {
  let tick = integer(input.simulationTick, 'simulationTick');
  let elapsed = integer(input.elapsedPacingMicroseconds, 'elapsed');
  let credit = integer(input.creditGameMicroseconds, 'credit');
  let bonus = integer(input.remainingDoubleSpeedBonusTicks, 'bonus');
  if (credit >= tickCredit) throw new Error('credit must be below one tick.');
  validateProfile(input.profile);
  const maximumEffectiveRate =
    Math.max(
      input.profile.normalRate,
      input.profile.fastRate,
      input.profile.maximumRate,
      input.profile.quietNormalRate,
    ) * 2;
  if (!Number.isSafeInteger(elapsed * maximumEffectiveRate))
    throw new Error('Pacing multiplication would overflow.');
  let bonusAdvanced = 0,
    regularAdvanced = 0;
  while (elapsed > 0 && input.mode !== 'paused') {
    const effective = resolveEffectiveRate({
      mode: input.mode,
      simulationTick: tick,
      profile: input.profile,
      remainingDoubleSpeedBonusTicks: bonus,
    });
    const needed = Math.ceil((tickCredit - credit) / effective);
    if (needed > elapsed) {
      credit += elapsed * effective;
      break;
    }
    credit += needed * effective - tickCredit;
    elapsed -= needed;
    tick += 1;
    if (bonus > 0) {
      bonus -= 1;
      bonusAdvanced += 1;
    } else regularAdvanced += 1;
    if (
      !Number.isSafeInteger(tick) ||
      !Number.isSafeInteger(credit) ||
      credit < 0 ||
      credit >= tickCredit
    )
      throw new Error('Pacing overflow.');
  }
  const advancedTicks = bonusAdvanced + regularAdvanced;
  return Object.freeze({
    advancedTicks,
    bonusTicksAdvanced: bonusAdvanced,
    regularTicksAdvanced: regularAdvanced,
    nextSimulationTick: tick,
    nextCreditGameMicroseconds: credit,
    remainingDoubleSpeedBonusTicks: bonus,
  });
}
