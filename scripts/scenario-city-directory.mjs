export function scenarioCityDirectory(primarySettlementName) {
  const stem = primarySettlementName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(' ', '_');
  if (!/^[a-z_]+$/.test(stem))
    throw new Error(
      `Primary settlement ${JSON.stringify(primarySettlementName)} contains unsupported filesystem characters after city-directory normalization.`,
    );
  return `${stem}-v1`;
}

export function validateScenarioCityDirectory({
  scenarioId,
  primarySettlementName,
  manifestPath,
}) {
  const actual = manifestPath.split('/')[0];
  const expected = scenarioCityDirectory(primarySettlementName);
  if (actual !== expected)
    throw new Error(
      `${scenarioId} expected scenario city directory ${expected} for ${primarySettlementName}, received ${actual}.`,
    );
  return expected;
}
