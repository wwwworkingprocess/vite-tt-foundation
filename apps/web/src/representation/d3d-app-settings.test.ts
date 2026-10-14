import { expect, it } from 'vitest';
import { d3dAppSettings, resolveD3dAppSettings } from './d3d-app-settings.js';
it('defaults to hidden outlines and fivefold relief with unchanged safety budgets', () => {
  for (const id of ['es-torrevieja', 'es-alicante', 'es-future-city']) {
    const s = resolveD3dAppSettings(id);
    expect(s.verticalExaggeration).toBe(5);
    expect(s.streetCells.showBoundaries).toBe(false);
    expect(s.streetCells.maxDisplaySegments).toBe(262144);
    expect(s.city.maxLotProposals).toBe(65536);
  }
  const settings = {
    ...d3dAppSettings,
    terrain: {
      ...d3dAppSettings.terrain,
      verticalExaggerationByCity: { 'es-alicante': 10 },
    },
    streetCells: { ...d3dAppSettings.streetCells, showBoundaries: true },
  };
  expect(
    resolveD3dAppSettings('es-alicante', settings).verticalExaggeration,
  ).toBe(10);
  expect(
    resolveD3dAppSettings('es-torrevieja', settings).verticalExaggeration,
  ).toBe(5);
  expect(
    resolveD3dAppSettings('es-alicante', settings).streetCells.showBoundaries,
  ).toBe(true);
});
it('rejects invalid scales, city overrides and presentation guards', () => {
  for (const value of [0, -1, NaN, Infinity, 51])
    expect(() =>
      resolveD3dAppSettings('es-test', {
        ...d3dAppSettings,
        terrain: {
          ...d3dAppSettings.terrain,
          defaultVerticalExaggeration: value,
        },
      }),
    ).toThrow('Invalid D3D settings');
  for (const overrides of [{ '../bad': 5 }, { 'es-test': 0 }])
    expect(() =>
      resolveD3dAppSettings('es-test', {
        ...d3dAppSettings,
        terrain: {
          ...d3dAppSettings.terrain,
          verticalExaggerationByCity: overrides,
        },
      }),
    ).toThrow('Invalid D3D settings');
  for (const value of [0, -1, 1.5, Infinity]) {
    expect(() =>
      resolveD3dAppSettings('es-test', {
        ...d3dAppSettings,
        city: { ...d3dAppSettings.city, maxLotProposals: value },
      }),
    ).toThrow('Invalid D3D settings');
    expect(() =>
      resolveD3dAppSettings('es-test', {
        ...d3dAppSettings,
        streetCells: {
          ...d3dAppSettings.streetCells,
          maxDisplaySegments: value,
        },
      }),
    ).toThrow('Invalid D3D settings');
  }
  expect(() =>
    resolveD3dAppSettings('es-test', {
      ...d3dAppSettings,
      streetCells: {
        ...d3dAppSettings.streetCells,
        lineSupportSpacingMetres: 0,
      },
    }),
  ).toThrow('Invalid D3D settings');
});

it('rejects non-finite line support independently of geometry budgets', () => {
  expect(() =>
    resolveD3dAppSettings('es-test', {
      ...d3dAppSettings,
      streetCells: {
        ...d3dAppSettings.streetCells,
        lineSupportSpacingMetres: Infinity,
      },
    }),
  ).toThrow('Invalid D3D settings: presentation limits');
});

it('uses the default for future IDs that coincide with object-prototype property names', () => {
  for (const city of ['constructor', 'toString', '__proto__'])
    expect(resolveD3dAppSettings(city).verticalExaggeration).toBe(5);
});

it('can disable shared near facade shading without changing source budgets', () => {
  expect(
    resolveD3dAppSettings('es-test', {
      ...d3dAppSettings,
      city: { ...d3dAppSettings.city, nearFacades: false },
    }).city.nearFacades,
  ).toBe(false);
  expect(d3dAppSettings.city.nearFacades).toBe(true);
});
