export const representationProfilePrefix = 'torrevieja.representation.';

export type RepresentationProfileDetail = Readonly<Record<string, unknown>>;

export interface RepresentationProfileToken {
  readonly name: string;
  readonly startedAt: number;
}

let enabled = false;

export function configureRepresentationProfiling(value: boolean): void {
  enabled = value;
}

export const representationProfilingEnabled = () => enabled;

export function beginRepresentationProfile(
  name: string,
): RepresentationProfileToken | undefined {
  return enabled
    ? Object.freeze({ name, startedAt: performance.now() })
    : undefined;
}

export function finishRepresentationProfile(
  token: RepresentationProfileToken | undefined,
  detail?: RepresentationProfileDetail,
): void {
  if (!token || !enabled) return;
  performance.measure(`${representationProfilePrefix}${token.name}`, {
    start: token.startedAt,
    end: performance.now(),
    detail,
  });
}

export function recordRepresentationProfile(
  name: string,
  detail?: RepresentationProfileDetail,
): void {
  if (!enabled) return;
  performance.mark(`${representationProfilePrefix}${name}`, { detail });
}

export function clearRepresentationProfiles(): void {
  for (const entry of performance.getEntriesByType('mark'))
    if (entry.name.startsWith(representationProfilePrefix))
      performance.clearMarks(entry.name);
  for (const entry of performance.getEntriesByType('measure'))
    if (entry.name.startsWith(representationProfilePrefix))
      performance.clearMeasures(entry.name);
}

export function summarizeDurations(values: readonly number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const count = ordered.length;
  const middle = Math.floor(count / 2);
  return Object.freeze({
    count,
    totalMs: ordered.reduce((total, value) => total + value, 0),
    minMs: count === 0 ? 0 : ordered[0]!,
    medianMs:
      count === 0
        ? 0
        : count % 2 === 1
          ? ordered[middle]!
          : (ordered[middle - 1]! + ordered[middle]!) / 2,
    maxMs: count === 0 ? 0 : ordered[count - 1]!,
  });
}
