import { freezeSettlement } from '../settlement/settlement-metadata.js';
import type { MaterializationRecipe } from './city-materialization.js';
import type { SiteKit } from './d3d-materialization.js';
import { streetCellMaskRegistry } from './street-cell-masks.js';
export type SiteSurfacePreset = Extract<
  MaterializationRecipe,
  { kind: 'surface' }
>['preset'];
/** Checked-in presentation materials only. No geographic, DEM or water authority.
 * La Mata and shallow-water presets are reserved until verified geometry is installed;
 * this file does not create masks, bands, gradients or texture acquisition. */
export const d3dMaterialPresets = freezeSettlement({
  // Instance colors multiply a single shared white Lambert material. These muted
  // trunk/foliage palettes are independent of all placement/style seeds.
  landscape: {
    palm: {
      trunk: ['#887c63', '#95866b', '#7e745f'],
      foliage: ['#73876a', '#7f906f', '#697e62'],
    },
    olive: {
      trunk: ['#8c897a', '#999181', '#807f73'],
      foliage: ['#97a58c', '#a1ad96', '#8d9d85'],
    },
    carob: {
      trunk: ['#81745f', '#8c7d66', '#776e5c'],
      foliage: ['#687b59', '#728363', '#5e7255'],
    },
    succulent: {
      trunk: ['#889b7c', '#96a58a', '#7f9276'],
      foliage: ['#889b7c', '#96a58a', '#7f9276'],
    },
    scrub: {
      trunk: ['#929c7a', '#a0a889', '#87936f'],
      foliage: ['#929c7a', '#a0a889', '#87936f'],
    },
  },
  typedLandCovers: {
    'inland water': '#7e999b',
    woods: '#89977b',
    park: '#9eaf8c',
    garden: '#adb99a',
    grass: '#a8b596',
    'recreation ground': '#bab29b',
  },
  terrain: { land: '#a7b88d', water: '#729ea5' },
  surfaces: {
    'salt-lagoon-pink-v0': '#cb889f',
    'beach-sand-v0': '#e1cda0',
    'park-ground-v0': '#769c63',
    'market-ground-v0': '#b8a78e',
    'harbor-water-v0': '#679caa',
    'salt-flat-v0': '#e1dbd0',
    'civic-stone-v0': '#b5aaa0',
  },
  torrevieja: {
    lagunaRosa: '#B7A2A7',
    lagunaLaMata: '#408E89',
    mediterranean: '#527F96',
    shallowCoastalWater: '#43B8C6',
    sandAndMineral: '#E6D8B5',
    lagoonRegionalToneStrength: 0.045,
    hiddenSurfaceSites: ['ua-site-es-torrevieja-marina-internacional'],
  },
  kits: {
    'market-canopy-v0': ['#8d826e', '#dfd8ba'],
    'beach-umbrella-v0': ['#baaa88', '#d8775a'],
    'park-tree-v0': ['#887458', '#588158'],
    'small-boat-v0': ['#e6e1d1', '#8fa8b2'],
    'salt-stack-v0': ['#e5dfd5', '#f0e9dc'],
    'tower-proxy-v0': ['#b29573', '#9d805c'],
    'civic-proxy-v0': ['#d4c7a9', '#937f69'],
  },
} as const);
export function resolveTypedLandCoverMaterial(type: number): string {
  const entry = streetCellMaskRegistry.find((entry) => entry.t === type);
  if (!entry) throw new Error('Unknown typed land cover registry entry');
  return d3dMaterialPresets.typedLandCovers[entry.name];
}
export function resolveTerrainMaterials(settlementId: string) {
  return Object.freeze({
    land: d3dMaterialPresets.terrain.land,
    water:
      settlementId === 'es-torrevieja'
        ? d3dMaterialPresets.torrevieja.mediterranean
        : d3dMaterialPresets.terrain.water,
  });
}
export function resolveSiteMaterial(
  settlementId: string,
  preset: SiteSurfacePreset,
  siteId: string,
): string {
  if (settlementId === 'es-torrevieja') {
    if (siteId === 'ua-site-es-torrevieja-laguna-rosa')
      return d3dMaterialPresets.torrevieja.lagunaRosa;
    if (siteId === 'ua-site-es-torrevieja-laguna-mata')
      return d3dMaterialPresets.torrevieja.lagunaLaMata;
    if (preset === 'beach-sand-v0' || preset === 'salt-flat-v0')
      return d3dMaterialPresets.torrevieja.sandAndMineral;
  }
  return d3dMaterialPresets.surfaces[preset];
}
export function resolveKitMaterials(kit: SiteKit) {
  return d3dMaterialPresets.kits[kit];
}

/** Visual policy only: a marina extent is not a verified water-surface boundary. */
export function resolveSiteSurfacePresentation(
  settlementId: string,
  preset: SiteSurfacePreset,
  siteId: string,
) {
  return Object.freeze({
    visible:
      settlementId !== 'es-torrevieja' ||
      !d3dMaterialPresets.torrevieja.hiddenSurfaceSites.some(
        (id) => id === siteId,
      ),
    tonalVariation:
      settlementId === 'es-torrevieja' && preset === 'salt-lagoon-pink-v0'
        ? d3dMaterialPresets.torrevieja.lagoonRegionalToneStrength
        : 0,
  });
}
