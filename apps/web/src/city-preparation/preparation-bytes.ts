/** Estimated retained DTO payload, excluding JS/driver overhead; counts shared records once. */
export function preparationBytes(
  value: unknown,
  seen = new Set<object>(),
): number {
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'boolean') return 4;
  if (value === null || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return Object.values(value).reduce<number>(
    (sum, child) => sum + preparationBytes(child, seen),
    0,
  );
}
