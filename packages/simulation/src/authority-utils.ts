export const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  ))
    if ('value' in descriptor) deepFreeze(descriptor.value);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

export const freezeTrustedAuthority = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  ))
    if ('value' in descriptor) freezeTrustedAuthority(descriptor.value);
  return Object.freeze(value);
};

export const checkedAdd = (
  left: number,
  right: number,
  context: string,
): number => {
  if (right < 0 || left > Number.MAX_SAFE_INTEGER - right)
    throw new Error(`${context} overflow.`);
  return left + right;
};

export const checkedMultiply = (
  left: number,
  right: number,
  context: string,
): number => {
  if (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
    throw new Error(`${context} overflow.`);
  return left * right;
};

export const lexical = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
import { z } from 'zod';

export const positiveSafeInteger = z.number().int().positive().safe();
export const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
