import { checkedAdd, checkedMultiply } from './authority-utils.js';

export interface PassengerDestinationPermutation {
  readonly phase: number;
  readonly stride: number;
}

const gcd = (left: number, right: number): number => {
  while (right !== 0) [left, right] = [right, left % right];
  return left;
};

const mix = (value: string, salt: number): number => {
  let hash = (2_166_136_261 ^ salt) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
};

export const addModulo = (left: number, right: number, modulus: number) => {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(modulus) ||
    modulus <= 0 ||
    left < 0 ||
    right < 0 ||
    left >= modulus ||
    right >= modulus
  )
    throw new Error('Invalid modular addition.');
  const distance = modulus - right;
  return left >= distance ? left - distance : left + right;
};

export const multiplyModulo = (
  multiplicand: number,
  multiplier: number,
  modulus: number,
) => {
  if (
    !Number.isSafeInteger(multiplier) ||
    multiplier < 0 ||
    !Number.isSafeInteger(multiplicand) ||
    multiplicand < 0 ||
    multiplicand >= modulus
  )
    throw new Error('Invalid modular multiplication.');
  let result = 0;
  let addend = multiplicand;
  let remaining = multiplier;
  while (remaining > 0) {
    if (remaining % 2 === 1) result = addModulo(result, addend, modulus);
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) addend = addModulo(addend, addend, modulus);
  }
  return result;
};

export const derivePassengerDestinationPermutation = (
  demandModelContentHash: string,
  originStopPlaceId: string,
  totalWeight: number,
): PassengerDestinationPermutation => {
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0)
    throw new Error('Invalid destination permutation weight.');
  const key = `${demandModelContentHash}:${originStopPlaceId}`;
  const phase = mix(key, 0x9e3779b9) % totalWeight;
  if (totalWeight === 1) return Object.freeze({ phase: 0, stride: 0 });
  if (totalWeight > 0xffff_ffff) return Object.freeze({ phase, stride: 1 });
  let stride = (mix(key, 0x85ebca6b) % (totalWeight - 1)) + 1;
  while (gcd(stride, totalWeight) !== 1) stride += 1;
  return Object.freeze({ phase, stride });
};

export const allocatePermutedDestinationCounts = (
  weights: readonly number[],
  cursor: number,
  passengerCount: number,
  permutation: PassengerDestinationPermutation,
  candidateAtWeightedPosition: (position: number) => number,
) => {
  const totalWeight = weights.reduce(
    (total, weight) =>
      checkedAdd(total, weight, 'destination candidate weight'),
    0,
  );
  if (totalWeight === 0)
    return Object.freeze({
      counts: Object.freeze([] as number[]),
      nextCursor: 0,
    });
  const counts = weights.map((weight) =>
    checkedMultiply(
      Math.floor(passengerCount / totalWeight),
      weight,
      'destination allocation',
    ),
  );
  const remainder = passengerCount % totalWeight;
  if (permutation.stride === 1) {
    const start = addModulo(permutation.phase, cursor, totalWeight);
    const distanceToEnd = totalWeight - start;
    const wraps = remainder >= distanceToEnd;
    const firstEnd = wraps ? totalWeight : start + remainder;
    const wrappedEnd = wraps ? remainder - distanceToEnd : 0;
    let intervalStart = 0;
    for (let index = 0; index < weights.length; index += 1) {
      const intervalEnd = checkedAdd(
        intervalStart,
        weights[index]!,
        'destination interval',
      );
      const overlap = (left: number, right: number) =>
        Math.max(
          0,
          Math.min(intervalEnd, right) - Math.max(intervalStart, left),
        );
      counts[index] = checkedAdd(
        counts[index]!,
        overlap(start, firstEnd) + overlap(0, wrappedEnd),
        'destination allocation',
      );
      intervalStart = intervalEnd;
    }
    return Object.freeze({
      counts: Object.freeze(counts),
      nextCursor: addModulo(cursor, remainder, totalWeight),
    });
  }
  let position = addModulo(
    permutation.phase,
    multiplyModulo(cursor, permutation.stride, totalWeight),
    totalWeight,
  );
  for (let index = 0; index < remainder; index += 1) {
    const candidateIndex = candidateAtWeightedPosition(position);
    counts[candidateIndex] = checkedAdd(
      counts[candidateIndex]!,
      1,
      'destination allocation',
    );
    position = addModulo(position, permutation.stride, totalWeight);
  }
  const cursorRemainder = passengerCount % totalWeight;
  const nextCursor = addModulo(cursor, cursorRemainder, totalWeight);
  return Object.freeze({ counts: Object.freeze(counts), nextCursor });
};
