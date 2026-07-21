export const normalizeCoveragePath = (value) => value.replaceAll('\\', '/');

export function findCoverageEntry(coverage, requiredRelativePath) {
  const relative = normalizeCoveragePath(requiredRelativePath).replace(
    /^\.\//,
    '',
  );
  const suffix = `/${relative}`;
  const matches = Object.entries(coverage).filter(([candidate]) => {
    const normalized = normalizeCoveragePath(candidate);
    return normalized === relative || normalized.endsWith(suffix);
  });
  if (matches.length > 1)
    throw new Error(
      `${relative}: ambiguous coverage entries: ${matches.map(([path]) => path).join(', ')}`,
    );
  return matches[0]?.[1];
}
