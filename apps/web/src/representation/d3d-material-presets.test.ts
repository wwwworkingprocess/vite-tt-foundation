import { expect, it } from 'vitest';
import {
  d3dMaterialPresets,
  resolveTerrainMaterials,
  resolveSiteSurfacePresentation,
  resolveSiteMaterial,
} from './d3d-material-presets.js';
it('keeps Torrevieja lagoon/sea/sand colors independently configurable at the material boundary', () => {
  expect(d3dMaterialPresets.torrevieja.lagunaRosa).toBe('#B7A2A7');
  expect(d3dMaterialPresets.torrevieja.lagunaLaMata).toBe('#408E89');
  expect(resolveTerrainMaterials('es-torrevieja').water).toBe('#527F96');
  expect(d3dMaterialPresets.torrevieja.shallowCoastalWater).toBe('#43B8C6');
  expect(
    resolveSiteMaterial(
      'es-torrevieja',
      'salt-lagoon-pink-v0',
      'ua-site-es-torrevieja-laguna-rosa',
    ),
  ).toBe('#B7A2A7');
  expect(
    resolveSiteMaterial(
      'es-torrevieja',
      'harbor-water-v0',
      'ua-site-es-torrevieja-laguna-mata',
    ),
  ).toBe('#408E89');
  expect(resolveSiteMaterial('es-torrevieja', 'beach-sand-v0', 'beach')).toBe(
    '#E6D8B5',
  );
  expect(resolveSiteMaterial('es-torrevieja', 'salt-flat-v0', 'salt')).toBe(
    '#E6D8B5',
  );
  expect(resolveSiteMaterial('es-alicante', 'beach-sand-v0', 'beach')).toBe(
    '#e1cda0',
  );
  expect(resolveTerrainMaterials('es-alicante').water).toBe('#729ea5');
  expect(resolveSiteMaterial('es-torrevieja', 'park-ground-v0', 'park')).toBe(
    '#769c63',
  );
});

it('keeps suppression and tone policy city-local while retaining the reserved La Mata color', () => {
  const marina = 'ua-site-es-torrevieja-marina-internacional';
  expect(
    resolveSiteSurfacePresentation('es-torrevieja', 'harbor-water-v0', marina),
  ).toEqual({ visible: false, tonalVariation: 0 });
  expect(
    resolveSiteSurfacePresentation('es-alicante', 'harbor-water-v0', marina),
  ).toEqual({ visible: true, tonalVariation: 0 });
  expect(
    resolveSiteSurfacePresentation(
      'es-torrevieja',
      'salt-lagoon-pink-v0',
      'lagoon',
    ),
  ).toEqual({ visible: true, tonalVariation: 0.045 });
  expect(
    resolveSiteSurfacePresentation(
      'es-torrevieja',
      'harbor-water-v0',
      'ua-site-es-torrevieja-laguna-mata',
    ),
  ).toEqual({ visible: true, tonalVariation: 0 });
  expect(d3dMaterialPresets.torrevieja.lagunaLaMata).toBe('#408E89');
});
