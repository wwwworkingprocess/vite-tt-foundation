/** Checked-in application presentation policy; edit and rebuild, never saved game state. */
export type D3dAppSettings = Readonly<{
  streetCells: Readonly<{
    showBoundaries: boolean;
    lineSupportSpacingMetres: number;
    maxDisplaySegments: number;
  }>;
  terrain: Readonly<{
    defaultVerticalExaggeration: number;
    verticalExaggerationByCity: Readonly<Record<string, number>>;
  }>;
  city: Readonly<{ maxLotProposals: number }>;
}>;
export const d3dAppSettings: D3dAppSettings = Object.freeze({
  streetCells: Object.freeze({
    showBoundaries: false,
    lineSupportSpacingMetres: 12.5,
    maxDisplaySegments: 262_144,
  }),
  terrain: Object.freeze({
    defaultVerticalExaggeration: 5,
    verticalExaggerationByCity: Object.freeze({}),
  }),
  city: Object.freeze({ maxLotProposals: 65_536 }),
});
export function validateD3dVerticalExaggeration(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 50)
    throw new Error(
      'Invalid D3D settings: vertical exaggeration must be in (0, 50]',
    );
  return value;
}
export function resolveD3dAppSettings(
  settlementId: string,
  settings: D3dAppSettings = d3dAppSettings,
) {
  let verticalExaggeration = validateD3dVerticalExaggeration(
    settings.terrain.defaultVerticalExaggeration,
  );
  for (const [city, value] of Object.entries(
    settings.terrain.verticalExaggerationByCity,
  )) {
    if (!/^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city))
      throw new Error('Invalid D3D settings: city override');
    validateD3dVerticalExaggeration(value);
    if (city === settlementId) verticalExaggeration = value;
  }
  if (
    !Number.isFinite(settings.streetCells.lineSupportSpacingMetres) ||
    settings.streetCells.lineSupportSpacingMetres <= 0 ||
    !Number.isSafeInteger(settings.streetCells.maxDisplaySegments) ||
    settings.streetCells.maxDisplaySegments <= 0 ||
    !Number.isSafeInteger(settings.city.maxLotProposals) ||
    settings.city.maxLotProposals <= 0
  )
    throw new Error('Invalid D3D settings: presentation limits');
  return Object.freeze({
    ...settings,
    verticalExaggeration,
  });
}
